import express from 'express';
import { query, one } from '../db.js';
import { requireAuth, requireCsrf, requirePermission } from '../auth.js';
import { hasPermission } from '../permissions.js';
import { audit } from '../audit.js';
import { ah } from './util.js';
import { str, intId, oneOf, pagination, localReference } from '../validation.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { notifyUsers } from '../services/notify.js';

const router = express.Router();

const STATUS_LABELS = {
  recue: 'Reçue',
  en_cours: 'En cours',
  traitee: 'Traitée',
  rejetee: 'Rejetée',
};

router.get('/requests', requireAuth, ah(async (req, res) => {
  const manager = hasPermission(req.user, 'requests.manage');
  const { page, limit, offset } = pagination(req.query, 30);
  const params = [];
  const where = [];
  if (!manager) {
    params.push(req.user.id);
    where.push(`r.user_id = $${params.length}`);
  }
  if (req.query.status) {
    params.push(oneOf(req.query.status, ['recue', 'en_cours', 'traitee', 'rejetee'], { field: 'Statut' }));
    where.push(`r.status = $${params.length}`);
  }
  if (req.query.q) {
    params.push(`%${String(req.query.q).trim().slice(0, 100)}%`);
    where.push(`(r.subject ILIKE $${params.length} OR r.reference ILIKE $${params.length} OR r.message ILIKE $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const count = await one(`SELECT COUNT(*)::int AS n FROM requests r ${whereSql}`, params);
  const rows = await query(
    `SELECT r.*, u.full_name AS author_name, u.role_id, ro.name AS author_role,
            a.full_name AS assignee_name
     FROM requests r JOIN users u ON u.id = r.user_id
     LEFT JOIN roles ro ON ro.id = u.role_id
     LEFT JOIN users a ON a.id = r.assigned_to
     ${whereSql}
     ORDER BY CASE r.status WHEN 'recue' THEN 0 WHEN 'en_cours' THEN 1 ELSE 2 END, r.created_at DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  const summary = await one(
    `SELECT
       COUNT(*) FILTER (WHERE status='recue')::int AS recue,
       COUNT(*) FILTER (WHERE status='en_cours')::int AS en_cours,
       COUNT(*) FILTER (WHERE status='traitee')::int AS traitee,
       COUNT(*) FILTER (WHERE status='rejetee')::int AS rejetee
     FROM requests ${manager ? '' : 'WHERE user_id = ' + Number(req.user.id)}`
  );
  res.json({ requests: rows, total: count.n, page, limit, summary, labels: STATUS_LABELS });
}));

router.get('/requests/:id', requireAuth, ah(async (req, res) => {
  const id = intId(req.params.id);
  const row = await one(
    `SELECT r.*, u.full_name AS author_name, u.phone AS author_phone, ro.name AS author_role,
            a.full_name AS assignee_name
     FROM requests r JOIN users u ON u.id=r.user_id
     LEFT JOIN roles ro ON ro.id=u.role_id
     LEFT JOIN users a ON a.id=r.assigned_to
     WHERE r.id=$1`,
    [id]
  );
  if (!row) throw notFound('Demande introuvable.');
  const manager = hasPermission(req.user, 'requests.manage');
  if (!manager && row.user_id !== req.user.id) throw notFound('Demande introuvable.');
  const history = await query(
    `SELECT e.*, u.full_name AS actor_name FROM request_events e LEFT JOIN users u ON u.id=e.actor_id
     WHERE e.request_id=$1 ORDER BY e.created_at ASC`,
    [id]
  );
  res.json({ request: row, history, labels: STATUS_LABELS });
}));

router.post('/requests', requireAuth, requireCsrf, ah(async (req, res) => {
  const subject = str(req.body.subject, { required: true, min: 3, max: 200, field: 'L’objet' });
  const category = str(req.body.category, { max: 80 }) || 'Renseignement';
  const message = str(req.body.message, { required: true, min: 5, max: 5000, field: 'Le message' });
  let reference = localReference('DEM');
  for (let i = 0; i < 5; i += 1) {
    const exists = await one('SELECT id FROM requests WHERE reference = $1', [reference]);
    if (!exists) break;
    reference = localReference('DEM');
  }
  const row = await one(
    'INSERT INTO requests (reference, user_id, subject, category, message) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [reference, req.user.id, subject, category, message]
  );
  await query('INSERT INTO request_events (request_id, status, comment, actor_id) VALUES ($1,$2,$3,$4)', [
    row.id, 'recue', 'Demande transmise.', req.user.id,
  ]);
  const staff = await query(
    `SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id
     WHERE u.status='active' AND u.id <> $1
       AND (r.slug IN ('chef','secretariat') OR r.permissions::text LIKE '%requests.manage%')`,
    [req.user.id]
  );
  await notifyUsers(staff.map((s) => s.id), {
    type: 'request',
    title: `Nouvelle demande administrative (${reference})`,
    body: subject,
  });
  await audit(req, 'request.create', 'request', row.id, { reference });
  res.status(201).json({ message: `Votre demande a été transmise. Référence : ${reference}.`, reference, id: row.id });
}));

router.put('/requests/:id', requireAuth, requireCsrf, requirePermission('requests.manage'), ah(async (req, res) => {
  const id = intId(req.params.id);
  const row = await one('SELECT * FROM requests WHERE id = $1', [id]);
  if (!row) throw notFound('Demande introuvable.');
  const status = oneOf(req.body.status ?? row.status, ['recue', 'en_cours', 'traitee', 'rejetee'], { field: 'Statut' });
  const response = str(req.body.response ?? row.response, { max: 5000 });
  let assignedTo = row.assigned_to;
  if (req.body.assigned_to !== undefined) {
    assignedTo = intId(req.body.assigned_to, { required: false });
    if (assignedTo) {
      const user = await one("SELECT id FROM users WHERE id=$1 AND status='active'", [assignedTo]);
      if (!user) throw badRequest('Responsable introuvable.');
    }
  }
  const comment = str(req.body.comment, { max: 1000 });
  await query(
    `UPDATE requests SET status=$1, response=$2, assigned_to=$3, updated_at=now(),
       closed_at = CASE WHEN $1 IN ('traitee','rejetee') THEN now() ELSE NULL END
     WHERE id=$4`,
    [status, response, assignedTo, id]
  );
  if (status !== row.status || assignedTo !== row.assigned_to) {
    await query('INSERT INTO request_events (request_id, status, comment, actor_id) VALUES ($1,$2,$3,$4)', [
      id, status, comment || (assignedTo !== row.assigned_to ? 'Demande réaffectée.' : `Statut : ${STATUS_LABELS[status]}`), req.user.id,
    ]);
  }
  if (status !== row.status) {
    await notifyUsers([row.user_id], {
      type: 'request',
      title: `Demande ${row.reference} — ${STATUS_LABELS[status]}`,
      body: response ? response.slice(0, 300) : 'Le statut de votre demande a été mis à jour.',
    });
  }
  await audit(req, 'request.update', 'request', id, { status });
  res.json({ message: 'Demande mise à jour.' });
}));

export default router;
