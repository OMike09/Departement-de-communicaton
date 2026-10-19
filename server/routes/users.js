import express from 'express';
import { query, one } from '../db.js';
import { requireAuth, requireCsrf, requirePermission, hashPassword, createPasswordReset } from '../auth.js';
import { hasPermission } from '../permissions.js';
import { audit } from '../audit.js';
import { ah } from './util.js';
import { str, phone as vphone, password6, email as vemail, intId, oneOf, pagination, bool } from '../validation.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { config } from '../config.js';

const router = express.Router();

const USER_SELECT = `
  SELECT u.id, u.phone, u.full_name, u.email, u.matricule, u.role_id, u.level_id, u.parcours_id,
         u.group_name, u.status, u.note, u.must_change_pw, u.failed_attempts, u.locked_until,
         u.last_login_at, u.created_at, u.approved_at,
         r.slug AS role_slug, r.name AS role_name,
         l.name AS level_name, p.name AS parcours_name
  FROM users u
  JOIN roles r ON r.id = u.role_id
  LEFT JOIN levels l ON l.id = u.level_id
  LEFT JOIN parcours p ON p.id = u.parcours_id`;

async function loadScopes(userId) {
  const rows = await query(
    `SELECT us.scope_type, us.scope_id,
            CASE WHEN us.scope_type = 'level' THEN (SELECT name FROM levels WHERE id = us.scope_id)
                 WHEN us.scope_type = 'parcours' THEN (SELECT name FROM parcours WHERE id = us.scope_id)
                 WHEN us.scope_type = 'group' THEN (SELECT name FROM groups WHERE id = us.scope_id)
            END AS label
     FROM user_scopes us WHERE us.user_id = $1`,
    [userId]
  );
  return rows;
}

router.get('/admin/users', requireAuth, requirePermission('users.view'), ah(async (req, res) => {
  const { page, limit, offset } = pagination(req.query, 25);
  const where = [];
  const params = [];
  const push = (sql, value) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (req.query.status) push('u.status = ?', oneOf(req.query.status, ['pending', 'active', 'suspended', 'rejected'], { field: 'Statut' }));
  if (req.query.role) push('r.slug = ?', str(req.query.role, { max: 60 }));
  if (req.query.level) push('u.level_id = ?', intId(req.query.level));
  if (req.query.parcours) push('u.parcours_id = ?', intId(req.query.parcours));
  if (req.query.q) {
    const q = `%${String(req.query.q).trim().slice(0, 80)}%`;
    params.push(q);
    const i = params.length;
    where.push(`(u.full_name ILIKE $${i} OR u.phone ILIKE $${i} OR u.email ILIKE $${i} OR u.matricule ILIKE $${i})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const countRow = await one(
    `SELECT COUNT(*)::int AS n FROM users u JOIN roles r ON r.id = u.role_id ${whereSql}`,
    params
  );
  const rows = await query(
    `${USER_SELECT} ${whereSql} ORDER BY
       CASE u.status WHEN 'pending' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,
       u.created_at DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  res.json({ users: rows, total: countRow.n, page, limit });
}));

router.get('/admin/users/:id', requireAuth, requirePermission('users.view'), ah(async (req, res) => {
  const id = intId(req.params.id);
  const user = await one(`${USER_SELECT} WHERE u.id = $1`, [id]);
  if (!user) throw notFound('Compte introuvable.');
  const scopes = await loadScopes(id);
  const stats = await one(
    `SELECT
       (SELECT COUNT(*)::int FROM publications WHERE created_by = $1) AS publications,
       (SELECT COUNT(*)::int FROM documents WHERE uploaded_by = $1) AS documents,
       (SELECT COUNT(*)::int FROM requests WHERE user_id = $1) AS requests`,
    [id]
  );
  res.json({ user, scopes, stats });
}));

router.post('/admin/users', requireAuth, requireCsrf, requirePermission('users.manage'), ah(async (req, res) => {
  const fullName = str(req.body.full_name, { required: true, min: 3, max: 120, field: 'Le nom complet' });
  const phone = vphone(req.body.phone);
  const roleId = intId(req.body.role_id, { field: 'Le rôle' });
  const role = await one('SELECT * FROM roles WHERE id = $1', [roleId]);
  if (!role) throw badRequest('Rôle introuvable.');
  if (role.slug === 'chef' && req.user.role_slug !== 'chef') {
    throw forbidden('Seul le chef de département peut attribuer ce rôle.');
  }
  const pwd = password6(req.body.password);
  const mail = vemail(req.body.email);
  const matricule = str(req.body.matricule, { max: 40 });
  const groupName = str(req.body.group_name, { max: 80 });
  const levelId = intId(req.body.level_id, { required: false });
  const parcoursId = intId(req.body.parcours_id, { required: false });
  const status = oneOf(req.body.status || 'active', ['pending', 'active', 'suspended'], { field: 'Statut' });
  const note = str(req.body.note, { max: 1000 });
  if (await one('SELECT id FROM users WHERE phone = $1', [phone])) {
    throw conflict('Un compte existe déjà avec ce numéro de téléphone.', 'phone_taken');
  }
  const row = await one(
    `INSERT INTO users (phone, password_hash, full_name, email, matricule, role_id, level_id, parcours_id, group_name, status, note, approved_at, approved_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
    [phone, hashPassword(pwd), fullName, mail, matricule, roleId, levelId, parcoursId, groupName, status, note,
     status === 'active' ? new Date() : null, status === 'active' ? req.user.id : null]
  );
  if (Array.isArray(req.body.scopes)) await saveScopes(row.id, req.body.scopes);
  await audit(req, 'user.create', 'user', row.id, { phone, role: role.slug, status });
  res.status(201).json({ message: 'Compte créé.', id: row.id });
}));

async function saveScopes(userId, scopes) {
  await query('DELETE FROM user_scopes WHERE user_id = $1', [userId]);
  if (!Array.isArray(scopes)) return;
  for (const s of scopes) {
    const type = oneOf(s?.type, ['level', 'parcours', 'group'], { field: 'Périmètre' });
    const id = intId(s?.id, { field: 'Périmètre' });
    await query(
      'INSERT INTO user_scopes (user_id, scope_type, scope_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [userId, type, id]
    );
  }
}

router.put('/admin/users/:id', requireAuth, requireCsrf, requirePermission('users.manage'), ah(async (req, res) => {
  const id = intId(req.params.id);
  const target = await one('SELECT u.*, r.slug AS role_slug FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1', [id]);
  if (!target) throw notFound('Compte introuvable.');
  if (target.role_slug === 'chef' && req.user.id !== id && req.user.role_slug !== 'chef') {
    throw forbidden('Seul un chef de département peut modifier ce compte.');
  }
  if (target.id === req.user.id && req.body.role_id && Number(req.body.role_id) !== target.role_id) {
    throw forbidden('Vous ne pouvez pas modifier votre propre rôle.');
  }
  const fullName = str(req.body.full_name ?? target.full_name, { required: true, min: 3, max: 120, field: 'Le nom complet' });
  const phone = req.body.phone === undefined ? target.phone : vphone(req.body.phone);
  if (phone !== target.phone) {
    if (await one('SELECT id FROM users WHERE phone = $1 AND id <> $2', [phone, id])) {
      throw conflict('Un autre compte utilise déjà ce numéro de téléphone.', 'phone_taken');
    }
  }
  let roleId = target.role_id;
  if (req.body.role_id !== undefined) {
    roleId = intId(req.body.role_id, { field: 'Le rôle' });
    const role = await one('SELECT * FROM roles WHERE id = $1', [roleId]);
    if (!role) throw badRequest('Rôle introuvable.');
    if ((role.slug === 'chef' || target.role_slug === 'chef') && req.user.role_slug !== 'chef') {
      throw forbidden('Seul le chef de département peut gérer le rôle de chef.');
    }
  }
  const mail = req.body.email === undefined ? target.email : vemail(req.body.email);
  const matricule = str(req.body.matricule ?? target.matricule, { max: 40 });
  const groupName = str(req.body.group_name ?? target.group_name, { max: 80 });
  const levelId = req.body.level_id === undefined ? target.level_id : intId(req.body.level_id, { required: false });
  const parcoursId = req.body.parcours_id === undefined ? target.parcours_id : intId(req.body.parcours_id, { required: false });
  let status = target.status;
  if (req.body.status !== undefined) {
    status = oneOf(req.body.status, ['pending', 'active', 'suspended', 'rejected'], { field: 'Statut' });
    if (id === req.user.id && status !== 'active') throw forbidden('Vous ne pouvez pas désactiver votre propre compte.');
  }
  const note = str(req.body.note ?? target.note, { max: 1000 });
  let passwordHash = target.password_hash;
  if (req.body.password) {
    passwordHash = hashPassword(password6(req.body.password));
  }
  await query(
    `UPDATE users SET full_name=$1, phone=$2, email=$3, matricule=$4, role_id=$5, level_id=$6,
       parcours_id=$7, group_name=$8, status=$9, note=$10, password_hash=$11, updated_at=now(),
       approved_at = CASE WHEN $9 = 'active' AND approved_at IS NULL THEN now() ELSE approved_at END,
       approved_by = CASE WHEN $9 = 'active' AND approved_by IS NULL THEN $12 ELSE approved_by END
     WHERE id=$13`,
    [fullName, phone, mail, matricule, roleId, levelId, parcoursId, groupName, status, note, passwordHash, req.user.id, id]
  );
  if (req.body.scopes !== undefined) await saveScopes(id, req.body.scopes);
  if (req.body.password) await query('DELETE FROM sessions WHERE user_id = $1', [id]);
  if (status === 'suspended' && target.status === 'active') await query('DELETE FROM sessions WHERE user_id = $1', [id]);
  await audit(req, 'user.update', 'user', id, { status, role_id: roleId, password_changed: Boolean(req.body.password) });
  res.json({ message: 'Compte mis à jour.' });
}));

router.post('/admin/users/:id/approve', requireAuth, requireCsrf, requirePermission('users.approve'), ah(async (req, res) => {
  const id = intId(req.params.id);
  const user = await one('SELECT * FROM users WHERE id = $1', [id]);
  if (!user) throw notFound('Compte introuvable.');
  await query("UPDATE users SET status='active', approved_at=now(), approved_by=$1 WHERE id=$2", [req.user.id, id]);
  await query(
    "INSERT INTO notifications (user_id, type, title, body) VALUES ($1,'account','Compte approuvé','Votre compte a été validé. Vous pouvez désormais accéder à votre espace.')",
    [id]
  );
  await audit(req, 'user.approve', 'user', id, {});
  res.json({ message: 'Compte approuvé.' });
}));

router.post('/admin/users/:id/reject', requireAuth, requireCsrf, requirePermission('users.approve'), ah(async (req, res) => {
  const id = intId(req.params.id);
  const user = await one('SELECT * FROM users WHERE id = $1', [id]);
  if (!user) throw notFound('Compte introuvable.');
  if (user.id === req.user.id) throw forbidden('Vous ne pouvez pas rejeter votre propre compte.');
  await query("UPDATE users SET status='rejected' WHERE id=$1", [id]);
  await query('DELETE FROM sessions WHERE user_id = $1', [id]);
  await audit(req, 'user.reject', 'user', id, {});
  res.json({ message: 'Inscription rejetée.' });
}));

router.post('/admin/users/:id/status', requireAuth, requireCsrf, requirePermission('users.manage'), ah(async (req, res) => {
  const id = intId(req.params.id);
  const status = oneOf(req.body.status, ['active', 'suspended'], { field: 'Statut' });
  if (id === req.user.id) throw forbidden('Vous ne pouvez pas modifier le statut de votre propre compte.');
  const target = await one('SELECT u.*, r.slug AS role_slug FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=$1', [id]);
  if (!target) throw notFound('Compte introuvable.');
  if (target.role_slug === 'chef' && req.user.role_slug !== 'chef') throw forbidden('Action réservée au chef de département.');
  await query('UPDATE users SET status=$1, updated_at=now() WHERE id=$2', [status, id]);
  if (status === 'suspended') await query('DELETE FROM sessions WHERE user_id = $1', [id]);
  await audit(req, status === 'active' ? 'user.activate' : 'user.suspend', 'user', id, {});
  res.json({ message: status === 'active' ? 'Compte activé.' : 'Compte suspendu.' });
}));

router.post('/admin/users/:id/reset-link', requireAuth, requireCsrf, requirePermission('users.manage'), ah(async (req, res) => {
  const id = intId(req.params.id);
  const user = await one('SELECT id, phone, full_name FROM users WHERE id = $1', [id]);
  if (!user) throw notFound('Compte introuvable.');
  const { token, expiresAt } = await createPasswordReset(id, req.user.id);
  const base = config.appUrl || `${req.protocol}://${req.get('host')}`;
  await audit(req, 'user.reset_link', 'user', id, {});
  res.json({
    message:
      'Lien de réinitialisation généré. Transmettez-le à la personne par un canal sûr : il expire dans 1 heure et ne doit pas être publié.',
    url: `${base}/#/reinitialisation/${token}`,
    expires_at: expiresAt,
  });
}));

router.get('/admin/pending-count', requireAuth, requirePermission('users.approve'), ah(async (req, res) => {
  const row = await one("SELECT COUNT(*)::int AS n FROM users WHERE status = 'pending'");
  res.json({ pending: row.n });
}));

export default router;
