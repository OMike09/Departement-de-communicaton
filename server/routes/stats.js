import express from 'express';
import { query, one } from '../db.js';
import { requireAuth, requirePermission } from '../auth.js';
import { hasPermission } from '../permissions.js';
import { ah } from './util.js';

const router = express.Router();

router.get('/stats/overview', requireAuth, requirePermission('stats.view'), ah(async (req, res) => {
  const byRole = await query(
    `SELECT r.name, r.slug, COUNT(u.id) FILTER (WHERE u.status = 'active')::int AS active,
            COUNT(u.id) FILTER (WHERE u.status = 'pending')::int AS pending
     FROM roles r LEFT JOIN users u ON u.role_id = r.id
     GROUP BY r.id ORDER BY r.is_system DESC, r.name`
  );
  const byStatus = await one(
    `SELECT COUNT(*) FILTER (WHERE status='active')::int AS active,
            COUNT(*) FILTER (WHERE status='pending')::int AS pending,
            COUNT(*) FILTER (WHERE status='suspended')::int AS suspended,
            COUNT(*) FILTER (WHERE status='rejected')::int AS rejected,
            COUNT(*)::int AS total FROM users`
  );
  const byLevel = await query(
    `SELECT l.name, COUNT(u.id)::int AS n FROM levels l LEFT JOIN users u ON u.level_id=l.id AND u.status='active'
     GROUP BY l.id ORDER BY l.order_index, l.name`
  );
  const byParcours = await query(
    `SELECT p.name, COUNT(u.id)::int AS n FROM parcours p LEFT JOIN users u ON u.parcours_id=p.id AND u.status='active'
     GROUP BY p.id ORDER BY p.order_index, p.name`
  );
  const publications = await one(
    `SELECT COUNT(*) FILTER (WHERE status='published')::int AS published,
            COUNT(*) FILTER (WHERE status='draft')::int AS draft,
            COUNT(*) FILTER (WHERE status='scheduled')::int AS scheduled,
            COUNT(*) FILTER (WHERE status='archived')::int AS archived,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE published_at > now() - interval '30 days')::int AS last30
     FROM publications`
  );
  const documents = await one(
    `SELECT COUNT(*) FILTER (WHERE archived = FALSE)::int AS active, COUNT(*)::int AS total FROM documents`
  );
  const files = await one(
    `SELECT COUNT(*)::int AS total, COALESCE(SUM(size),0)::bigint AS bytes FROM files`
  );
  const notifications = await one(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE read_at IS NOT NULL)::int AS read,
            COUNT(*) FILTER (WHERE opened_at IS NOT NULL)::int AS opened
     FROM notifications`
  );
  const views = await one('SELECT COUNT(*)::int AS total FROM publication_views');
  const requests = await one(
    `SELECT COUNT(*) FILTER (WHERE status='recue')::int AS recue,
            COUNT(*) FILTER (WHERE status='en_cours')::int AS en_cours,
            COUNT(*) FILTER (WHERE status='traitee')::int AS traitee,
            COUNT(*) FILTER (WHERE status='rejetee')::int AS rejetee,
            COUNT(*)::int AS total FROM requests`
  );
  const results = await one(
    `SELECT COUNT(*) FILTER (WHERE status='published')::int AS published,
            COUNT(*) FILTER (WHERE status='draft')::int AS draft,
            COUNT(*)::int AS total FROM results`
  );
  const activity = await query(
    `SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
       (SELECT COUNT(*)::int FROM publications p WHERE p.published_at::date = d.day) AS publications,
       (SELECT COUNT(*)::int FROM publication_views v WHERE v.first_viewed_at::date = d.day) AS views,
       (SELECT COUNT(*)::int FROM users u WHERE u.created_at::date = d.day) AS inscriptions,
       (SELECT COUNT(*)::int FROM requests r WHERE r.created_at::date = d.day) AS demandes
     FROM generate_series(current_date - interval '13 days', current_date, interval '1 day') AS d(day)
     ORDER BY d.day`
  );
  res.json({
    byRole, byStatus, byLevel, byParcours,
    publications, documents, files, notifications, views, requests, results,
    activity,
    generated_at: new Date().toISOString(),
  });
}));

router.get('/stats/mine', requireAuth, ah(async (req, res) => {
  if (!hasPermission(req.user, 'stats.personal') && !hasPermission(req.user, 'publications.create')) {
    return res.json({ publications: [], totals: { publications: 0, views: 0, read: 0, notifications: 0 } });
  }
  const rows = await query(
    `SELECT p.id, p.title, p.status, p.created_at, p.published_at,
            (SELECT COUNT(*)::int FROM publication_views v WHERE v.publication_id = p.id) AS views,
            (SELECT COUNT(*)::int FROM notifications n WHERE n.publication_id = p.id) AS notifications,
            (SELECT COUNT(*)::int FROM notifications n WHERE n.publication_id = p.id AND n.read_at IS NOT NULL) AS read_count
     FROM publications p WHERE p.created_by = $1
     ORDER BY COALESCE(p.published_at, p.created_at) DESC LIMIT 100`,
    [req.user.id]
  );
  const totals = rows.reduce(
    (acc, r) => ({
      publications: acc.publications + 1,
      views: acc.views + r.views,
      notifications: acc.notifications + r.notifications,
      read: acc.read + r.read_count,
    }),
    { publications: 0, views: 0, notifications: 0, read: 0 }
  );
  res.json({ publications: rows, totals });
}));

export default router;
