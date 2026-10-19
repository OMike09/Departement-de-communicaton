import express from 'express';
import { query, one } from '../db.js';
import { requireAuth, requireCsrf } from '../auth.js';
import { ah } from './util.js';
import { pagination, intId } from '../validation.js';
import { audit } from '../audit.js';

const router = express.Router();

router.get('/notifications', requireAuth, ah(async (req, res) => {
  const { page, limit, offset } = pagination(req.query, 30);
  const params = [req.user.id];
  let where = 'n.user_id = $1';
  if (req.query.unread === '1') where += ' AND n.read_at IS NULL';
  const count = await one(`SELECT COUNT(*)::int AS n FROM notifications n WHERE ${where}`, params);
  const rows = await query(
    `SELECT n.id, n.type, n.title, n.body, n.read_at, n.opened_at, n.created_at,
            n.publication_id,
            p.title AS publication_title, p.status AS publication_status,
            a.full_name AS author_name
     FROM notifications n
     LEFT JOIN publications p ON p.id = n.publication_id
     LEFT JOIN users a ON a.id = p.created_by
     WHERE ${where}
     ORDER BY n.created_at DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  res.json({ notifications: rows, total: count.n, page, limit });
}));

router.get('/notifications/count', requireAuth, ah(async (req, res) => {
  const row = await one(
    `SELECT COUNT(*) FILTER (WHERE read_at IS NULL)::int AS unread,
            COUNT(*)::int AS total,
            MAX(id) AS last_id
     FROM notifications WHERE user_id = $1`,
    [req.user.id]
  );
  res.json({ unread: row.unread, total: row.total, last_id: row.last_id });
}));

router.post('/notifications/:id/read', requireAuth, requireCsrf, ah(async (req, res) => {
  const id = intId(req.params.id);
  const notif = await one('SELECT * FROM notifications WHERE id = $1 AND user_id = $2', [id, req.user.id]);
  if (!notif) return res.status(404).json({ error: 'Notification introuvable.' });
  await query('UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1', [id]);
  res.json({ message: 'Notification marquée comme lue.' });
}));

router.post('/notifications/read-all', requireAuth, requireCsrf, ah(async (req, res) => {
  await query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [req.user.id]);
  await audit(req, 'notification.read_all', 'notification', null, {});
  res.json({ message: 'Toutes les notifications sont marquées comme lues.' });
}));

export default router;
