import crypto from 'node:crypto';
import { query, one } from './db.js';
import { config, COOKIE_NAME } from './config.js';
import { unauthorized, forbidden, tooMany } from './errors.js';
import { hasPermission } from './permissions.js';

/* ----------------------------- Mots de passe ----------------------------- */
const PBKDF2_ITERATIONS = 210_000;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(String(password), salt, PBKDF2_ITERATIONS, 32, 'sha256').toString('hex');
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  try {
    const [algo, iters, salt, hash] = String(stored || '').split('$');
    if (algo !== 'pbkdf2') return false;
    const computed = crypto.pbkdf2Sync(String(password), salt, Number(iters), 32, 'sha256');
    const expected = Buffer.from(hash, 'hex');
    return computed.length === expected.length && crypto.timingSafeEqual(computed, expected);
  } catch {
    return false;
  }
}

// Empreinte des jetons de session et de réinitialisation, poivrée avec SESSION_SECRET.
export const sha256 = (value) =>
  crypto.createHmac('sha256', config.sessionSecret || 'dev-local-only').update(String(value)).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

/* ----------------------------- Sessions ----------------------------- */
export async function createSession(userId, req) {
  const token = randomToken(32);
  const csrf = randomToken(24);
  const expiresAt = new Date(Date.now() + config.sessionTtlHours * 3600 * 1000);
  await query(
    `INSERT INTO sessions (token_hash, user_id, csrf_token, ip, user_agent, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [sha256(token), userId, csrf, String(req.ip || ''), String(req.headers['user-agent'] || '').slice(0, 300), expiresAt]
  );
  return { token, csrf, expiresAt };
}

export function setSessionCookie(res, token, expiresAt) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    expires: expiresAt,
    path: '/',
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

export async function destroySession(token) {
  if (!token) return;
  await query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
}

export async function purgeExpiredSessions() {
  await query('DELETE FROM sessions WHERE expires_at < now()');
}

/* ----------------------------- Middleware ----------------------------- */
export async function loadSession(req, res, next) {
  try {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) return next();
    const row = await one(
      `SELECT s.id AS session_id, s.csrf_token, s.expires_at,
              u.id, u.phone, u.full_name, u.email, u.matricule, u.role_id,
              u.level_id, u.parcours_id, u.group_name, u.status, u.must_change_pw,
              u.last_login_at, u.created_at, u.sound_pref, u.vibration, u.text_scale,
              r.slug AS role_slug, r.name AS role_name, r.permissions
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN roles r ON r.id = u.role_id
       WHERE s.token_hash = $1`,
      [sha256(token)]
    );
    if (!row) return next();
    if (new Date(row.expires_at) < new Date()) {
      await query('DELETE FROM sessions WHERE id = $1', [row.session_id]);
      return next();
    }
    if (row.status !== 'active') {
      req.inactiveUser = { status: row.status };
      return next();
    }
    req.sessionToken = token;
    req.csrfToken = row.csrf_token;
    req.user = {
      id: row.id,
      phone: row.phone,
      full_name: row.full_name,
      email: row.email,
      matricule: row.matricule,
      role_id: row.role_id,
      role_slug: row.role_slug,
      role_name: row.role_name,
      permissions: typeof row.permissions === 'string' ? JSON.parse(row.permissions) : row.permissions,
      level_id: row.level_id,
      parcours_id: row.parcours_id,
      group_name: row.group_name,
      must_change_pw: row.must_change_pw,
      created_at: row.created_at,
      last_login_at: row.last_login_at,
      sound_pref: row.sound_pref,
      vibration: row.vibration,
      text_scale: Number(row.text_scale),
    };
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(req, res, next) {
  if (req.user) return next();
  if (req.inactiveUser) {
    return next(
      forbidden(
        req.inactiveUser.status === 'pending'
          ? "Votre compte est en attente de validation par l'administration."
          : req.inactiveUser.status === 'rejected'
            ? "Votre demande d'inscription n'a pas été validée. Contactez le secrétariat."
            : 'Votre compte est suspendu. Contactez le secrétariat du département.',
        `account_${req.inactiveUser.status}`
      )
    );
  }
  next(unauthorized('Veuillez vous connecter pour accéder à cette page.', 'auth_required'));
}

export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) return next(unauthorized('Veuillez vous connecter.', 'auth_required'));
    if (!hasPermission(req.user, permission)) return next(forbidden(undefined, 'permission_denied'));
    next();
  };
}

/** Protection CSRF : en-tête X-CSRF-Token exigé pour toute mutation. */
export function requireCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!req.user) return next(unauthorized('Veuillez vous connecter.', 'auth_required'));
  const token = req.get('x-csrf-token') || '';
  if (!token || token !== req.csrfToken) {
    return next(forbidden('Jeton de sécurité invalide ou expiré. Rechargez la page.', 'csrf'));
  }
  next();
}

/** Vérification d'origine complémentaire pour les mutations. */
export function checkOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next();
  const host = req.get('host');
  let ok = false;
  try {
    const o = new URL(origin);
    ok = o.host === host || (config.appUrl && origin === config.appUrl);
  } catch {
    ok = false;
  }
  if (!ok) return next(forbidden("Origine de la requête non autorisée.", 'bad_origin'));
  next();
}

/* ----------------------------- Anti-abus ----------------------------- */
const buckets = new Map();

export function rateLimit(key, { max = 8, windowMs = 15 * 60 * 1000 } = {}) {
  const now = Date.now();
  const bucket = buckets.get(key) || [];
  const fresh = bucket.filter((t) => now - t < windowMs);
  if (fresh.length >= max) return false;
  fresh.push(now);
  buckets.set(key, fresh);
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (!v.some((t) => now - t < windowMs)) buckets.delete(k);
  }
  return true;
}

export async function recordLoginAttempt(phone, ip, success) {
  try {
    await query('INSERT INTO login_attempts (phone, ip, success) VALUES ($1,$2,$3)', [phone, ip, success]);
  } catch {
    /* la journalisation ne doit pas bloquer la connexion */
  }
}

/* ----------------------------- Récupération ----------------------------- */
export async function createPasswordReset(userId, createdBy = null) {
  const token = randomToken(24);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 heure
  await query(
    'INSERT INTO password_resets (user_id, token_hash, expires_at, created_by) VALUES ($1,$2,$3,$4)',
    [userId, sha256(token), expiresAt, createdBy]
  );
  return { token, expiresAt };
}

export async function findValidReset(token) {
  return one(
    `SELECT pr.id, pr.user_id, u.phone, u.full_name
     FROM password_resets pr JOIN users u ON u.id = pr.user_id
     WHERE pr.token_hash = $1 AND pr.used_at IS NULL AND pr.expires_at > now()`,
    [sha256(token)]
  );
}

export async function consumeReset(id) {
  await query('UPDATE password_resets SET used_at = now() WHERE id = $1', [id]);
}
