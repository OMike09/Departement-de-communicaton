import express from 'express';
import { one, query } from '../db.js';
import { getSettings, publicSettings } from '../settings.js';
import {
  hashPassword, verifyPassword, createSession, setSessionCookie, clearSessionCookie,
  destroySession, rateLimit, recordLoginAttempt, requireAuth, requireCsrf,
  createPasswordReset, findValidReset, consumeReset,
} from '../auth.js';
import { audit } from '../audit.js';
import { ah, publicUser } from './util.js';
import { str, phone as vphone, password6, email as vemail, intId, bool } from '../validation.js';
import { badRequest, conflict, forbidden, unauthorized } from '../errors.js';
import { localReference } from '../validation.js';

const router = express.Router();

async function metaPayload(req) {
  const settings = await publicSettings();
  return {
    user: req.user ? publicUser(req.user) : null,
    csrf_token: req.user ? req.csrfToken : null,
    settings,
    permissions: req.user?.permissions || [],
  };
}

router.get('/me', ah(async (req, res) => {
  if (req.inactiveUser) {
    return res.status(401).json({
      error: req.inactiveUser.status === 'pending'
        ? "Votre compte est en attente de validation par l'administration."
        : req.inactiveUser.status === 'rejected'
          ? "Votre demande d'inscription n'a pas été validée. Contactez le secrétariat."
          : 'Votre compte est suspendu. Contactez le secrétariat.',
      code: req.inactiveUser.status === 'pending'
        ? 'account_pending'
        : req.inactiveUser.status === 'rejected'
          ? 'account_rejected'
          : 'account_suspended',
      user: null,
      settings: await publicSettings(),
    });
  }
  res.json(await metaPayload(req));
}));

router.post('/register', ah(async (req, res) => {
  const settings = await getSettings();
  if (settings.registration_open !== '1') {
    throw forbidden('Les inscriptions sont temporairement fermées. Contactez le secrétariat.', 'registration_closed');
  }
  if (!rateLimit(`register:${req.ip}`, { max: 12, windowMs: 60 * 60 * 1000 })) {
    throw badRequest("Trop de tentatives d'inscription. Réessayez plus tard.");
  }
  const fullName = str(req.body.full_name, { required: true, min: 3, max: 120, field: 'Le nom complet' });
  const phone = vphone(req.body.phone);
  const pwd = password6(req.body.password);
  const confirm = String(req.body.password_confirm ?? '');
  if (pwd !== confirm) throw badRequest('Les mots de passe ne correspondent pas.', 'password_mismatch');
  const mail = vemail(req.body.email);
  const matricule = str(req.body.matricule, { max: 40 });
  const groupName = str(req.body.group_name, { max: 80 });
  const requested = req.body.profile === 'enseignant' ? 'enseignant' : 'etudiant';

  const existing = await one('SELECT id FROM users WHERE phone = $1', [phone]);
  if (existing) throw conflict('Un compte existe déjà avec ce numéro de téléphone.', 'phone_taken');

  const levelId = intId(req.body.level_id, { required: false });
  const parcoursId = intId(req.body.parcours_id, { required: false });
  if (levelId) {
    const lvl = await one('SELECT id FROM levels WHERE id = $1 AND active = TRUE', [levelId]);
    if (!lvl) throw badRequest('Le niveau sélectionné est invalide.');
  }
  if (parcoursId) {
    const p = await one('SELECT id FROM parcours WHERE id = $1 AND active = TRUE', [parcoursId]);
    if (!p) throw badRequest('Le parcours sélectionné est invalide.');
  }
  if (requested === 'etudiant' && !levelId) {
    throw badRequest('Le niveau est obligatoire pour une inscription étudiante.');
  }

  const role = await one('SELECT id, slug FROM roles WHERE slug = $1', [requested]);
  if (!role) throw badRequest('Profil de compte indisponible.');

  const requireApproval = settings.require_approval === '1';
  const status = requireApproval ? 'pending' : 'active';
  const inserted = await one(
    `INSERT INTO users (phone, password_hash, full_name, email, matricule, role_id, level_id, parcours_id, group_name, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [phone, hashPassword(pwd), fullName, mail, matricule, role.id, levelId, parcoursId, groupName, status]
  );

  await audit(req, 'auth.register', 'user', inserted.id, { phone, requested, status });

  if (status === 'active') {
    await query('UPDATE users SET approved_at = now() WHERE id = $1', [inserted.id]);
    const session = await createSession(inserted.id, req);
    setSessionCookie(res, session.token, session.expiresAt);
    req.user = {
      id: inserted.id, phone, full_name: fullName, email: mail, matricule, role_id: role.id,
      role_slug: role.slug, role_name: '', permissions: [], level_id: levelId, parcours_id: parcoursId,
      group_name: groupName, status,
    };
    req.csrfToken = session.csrf;
    return res.status(201).json({
      message: 'Votre compte a été créé. Vous êtes connecté.',
      status,
      ...(await metaPayload(req)),
    });
  }

  res.status(201).json({
    message:
      "Votre demande de compte a bien été enregistrée. Elle doit être validée par l'administration du département avant la première connexion.",
    status: 'pending',
  });
}));

router.post('/login', ah(async (req, res) => {
  const phone = vphone(req.body.phone);
  const pwd = String(req.body.password ?? '');
  if (!/^\d{6}$/.test(pwd)) throw badRequest('Le mot de passe doit contenir exactement 6 chiffres.', 'password_rule');
  const ip = String(req.ip || '');
  if (!rateLimit(`login:${ip}`, { max: 20, windowMs: 15 * 60 * 1000 }) ||
      !rateLimit(`login:${phone}`, { max: 10, windowMs: 15 * 60 * 1000 })) {
    throw badRequest('Trop de tentatives de connexion. Réessayez dans quelques minutes.');
  }

  const user = await one(
    `SELECT u.*, r.slug AS role_slug, r.name AS role_name, r.permissions
     FROM users u JOIN roles r ON r.id = u.role_id WHERE u.phone = $1`,
    [phone]
  );
  if (!user) {
    await recordLoginAttempt(phone, ip, false);
    throw unauthorized('Numéro de téléphone ou mot de passe incorrect.', 'bad_credentials');
  }
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    const minutes = Math.max(1, Math.ceil((new Date(user.locked_until) - Date.now()) / 60000));
    throw forbidden(`Compte temporairement verrouillé après plusieurs échecs. Réessayez dans ${minutes} minute(s).`, 'locked');
  }
  if (!verifyPassword(pwd, user.password_hash)) {
    const attempts = Number(user.failed_attempts) + 1;
    const lock = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
    await query('UPDATE users SET failed_attempts = $1, locked_until = $2 WHERE id = $3', [attempts, lock, user.id]);
    await recordLoginAttempt(phone, ip, false);
    throw unauthorized('Numéro de téléphone ou mot de passe incorrect.', 'bad_credentials');
  }
  if (user.status === 'pending') {
    throw forbidden("Votre compte est en attente de validation par l'administration.", 'account_pending');
  }
  if (user.status === 'rejected') {
    throw forbidden("Votre demande de compte a été rejetée. Contactez le secrétariat.", 'account_rejected');
  }
  if (user.status !== 'active') {
    throw forbidden('Votre compte est suspendu. Contactez le secrétariat du département.', 'account_suspended');
  }

  await query(
    'UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1',
    [user.id]
  );
  await recordLoginAttempt(phone, ip, true);
  const session = await createSession(user.id, req);
  setSessionCookie(res, session.token, session.expiresAt);
  req.user = {
    ...user,
    permissions: typeof user.permissions === 'string' ? JSON.parse(user.permissions) : user.permissions,
  };
  req.csrfToken = session.csrf;
  await audit(req, 'auth.login', 'user', user.id, {});
  res.json({ message: 'Connexion réussie.', ...(await metaPayload(req)) });
}));

router.post('/logout', ah(async (req, res) => {
  if (req.sessionToken) await destroySession(req.sessionToken);
  clearSessionCookie(res);
  await audit(req, 'auth.logout', 'user', req.user?.id || null, {});
  res.json({ message: 'Vous êtes déconnecté.' });
}));

router.post('/change-password', requireAuth, requireCsrf, ah(async (req, res) => {
  const current = String(req.body.current_password ?? '');
  const pwd = password6(req.body.password);
  const confirm = String(req.body.password_confirm ?? '');
  if (pwd !== confirm) throw badRequest('Les mots de passe ne correspondent pas.', 'password_mismatch');
  const user = await one('SELECT id, password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!verifyPassword(current, user.password_hash)) throw badRequest('Le mot de passe actuel est incorrect.');
  await query('UPDATE users SET password_hash = $1, must_change_pw = FALSE, updated_at = now() WHERE id = $2', [
    hashPassword(pwd), req.user.id,
  ]);
  await query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [
    req.user.id, (await import('../auth.js')).sha256(req.sessionToken),
  ]);
  await audit(req, 'auth.change_password', 'user', req.user.id, {});
  res.json({ message: 'Mot de passe modifié avec succès.' });
}));

/* ------------- Mot de passe oublié : demande traitée par le secrétariat ------------- */
router.post('/forgot-password', ah(async (req, res) => {
  if (!rateLimit(`forgot:${req.ip}`, { max: 6, windowMs: 60 * 60 * 1000 })) {
    throw badRequest('Trop de demandes. Réessayez plus tard.');
  }
  const phone = vphone(req.body.phone);
  const user = await one('SELECT id, full_name FROM users WHERE phone = $1', [phone]);
  if (user) {
    const ref = localReference('REC');
    const request = await one(
      `INSERT INTO requests (reference, user_id, subject, category, message)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [
        ref, user.id, 'Récupération de compte', 'Récupération de compte',
        "L'utilisateur demande la réinitialisation de son mot de passe (demande envoyée depuis la page de connexion).",
      ]
    );
    await query('INSERT INTO request_events (request_id, status, comment) VALUES ($1,$2,$3)', [
      request.id, 'recue', 'Demande créée automatiquement.',
    ]);
    await audit(req, 'auth.forgot_password', 'request', request.id, { user_id: user.id });
  }
  res.json({
    message:
      "Si ce numéro correspond à un compte, une demande de récupération a été transmise au secrétariat. Présentez-vous avec une pièce d'identité pour obtenir un lien de réinitialisation.",
  });
}));

router.get('/reset/:token', ah(async (req, res) => {
  const reset = await findValidReset(req.params.token);
  if (!reset) throw badRequest('Ce lien de réinitialisation est invalide ou expiré.');
  res.json({ phone: reset.phone.replace(/(\d{2,4})\d+(\d{2})$/, '$1••••$2'), full_name: reset.full_name });
}));

router.post('/reset/:token', ah(async (req, res) => {
  if (!rateLimit(`reset:${req.ip}`, { max: 10, windowMs: 60 * 60 * 1000 })) {
    throw badRequest('Trop de tentatives. Réessayez plus tard.');
  }
  const reset = await findValidReset(req.params.token);
  if (!reset) throw badRequest('Ce lien de réinitialisation est invalide ou expiré.');
  const pwd = password6(req.body.password);
  const confirm = String(req.body.password_confirm ?? '');
  if (pwd !== confirm) throw badRequest('Les mots de passe ne correspondent pas.', 'password_mismatch');
  await consumeReset(reset.id);
  await query('UPDATE users SET password_hash = $1, failed_attempts = 0, locked_until = NULL, updated_at = now() WHERE id = $2', [
    hashPassword(pwd), reset.user_id,
  ]);
  await query('DELETE FROM sessions WHERE user_id = $1', [reset.user_id]);
  await audit(req, 'auth.reset_password', 'user', reset.user_id, {});
  res.json({ message: 'Mot de passe réinitialisé. Vous pouvez vous connecter.' });
}));

export default router;
