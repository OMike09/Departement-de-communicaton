import express from 'express';
import { query, one } from '../db.js';
import { requireAuth, requireCsrf, requirePermission } from '../auth.js';
import { audit } from '../audit.js';
import { ah } from './util.js';
import { getSettings, moduleEnabled } from '../settings.js';
import { hasPermission } from '../permissions.js';
import { str, intId, oneOf, dateOnly, safeUrl } from '../validation.js';
import { badRequest, notFound } from '../errors.js';

const router = express.Router();

const CATEGORIES = [
  'recherche', 'publication_scientifique', 'conference', 'seminaire', 'atelier',
  'soutenance', 'partenariat', 'association', 'stage', 'opportunite', 'autre',
];

function enabledActivityCategories(settings, isManager) {
  let map = {};
  try { map = JSON.parse(settings.activity_categories || '{}'); } catch {}
  const enabled = CATEGORIES.filter((c) => map[c] !== false);
  return isManager ? CATEGORIES : enabled;
}

router.get('/activities', requireAuth, ah(async (req, res) => {
  const settings = await getSettings();
  if (!moduleEnabled(settings, 'activities')) return res.json({ activities: [], categories: [] });
  const manager = hasPermission(req.user, 'activities.manage');
  const allowed = enabledActivityCategories(settings, manager);
  const params = [];
  let where = 'a.active = TRUE';
  if (!manager) where += ` AND a.category IN (${allowed.map((c) => `'${c}'`).join(',') || "''"})`;
  if (req.query.category) {
    params.push(oneOf(req.query.category, CATEGORIES, { field: 'Catégorie' }));
    where += ` AND a.category = $${params.length}`;
  }
  const rows = await query(
    `SELECT a.*, u.full_name AS author_name FROM activities a LEFT JOIN users u ON u.id = a.created_by
     WHERE ${where} ORDER BY a.date_start DESC NULLS LAST, a.created_at DESC LIMIT 200`,
    params
  );
  res.json({ activities: rows, categories: allowed });
}));

router.post('/activities', requireAuth, requireCsrf, requirePermission('activities.manage'), ah(async (req, res) => {
  const title = str(req.body.title, { required: true, min: 2, max: 200, field: 'Le titre' });
  const description = str(req.body.description, { max: 5000 });
  const category = oneOf(req.body.category || 'autre', CATEGORIES, { field: 'Catégorie' });
  const dateStart = dateOnly(req.body.date_start);
  const dateEnd = dateOnly(req.body.date_end);
  if (dateStart && dateEnd && new Date(dateEnd) < new Date(dateStart)) throw badRequest('La date de fin précède la date de début.');
  const location = str(req.body.location, { max: 160 });
  const organizer = str(req.body.organizer, { max: 160 });
  const link = safeUrl(req.body.link);
  const row = await one(
    `INSERT INTO activities (title, description, category, date_start, date_end, location, organizer, link, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [title, description, category, dateStart, dateEnd, location, organizer, link, req.user.id]
  );
  await audit(req, 'activity.create', 'activity', row.id, { title, category });
  res.status(201).json({ message: 'Activité publiée.', id: row.id });
}));

router.put('/activities/:id', requireAuth, requireCsrf, requirePermission('activities.manage'), ah(async (req, res) => {
  const id = intId(req.params.id);
  const a = await one('SELECT * FROM activities WHERE id = $1', [id]);
  if (!a) throw notFound('Activité introuvable.');
  const title = str(req.body.title ?? a.title, { required: true, max: 200, field: 'Le titre' });
  const description = str(req.body.description ?? a.description, { max: 5000 });
  const category = oneOf(req.body.category ?? a.category, CATEGORIES, { field: 'Catégorie' });
  const dateStart = req.body.date_start === undefined ? a.date_start : dateOnly(req.body.date_start);
  const dateEnd = req.body.date_end === undefined ? a.date_end : dateOnly(req.body.date_end);
  const location = str(req.body.location ?? a.location, { max: 160 });
  const organizer = str(req.body.organizer ?? a.organizer, { max: 160 });
  const link = req.body.link === undefined ? a.link : safeUrl(req.body.link);
  const active = req.body.active === undefined ? a.active : Boolean(req.body.active);
  await query(
    `UPDATE activities SET title=$1, description=$2, category=$3, date_start=$4, date_end=$5, location=$6,
       organizer=$7, link=$8, active=$9 WHERE id=$10`,
    [title, description, category, dateStart, dateEnd, location, organizer, link, active, id]
  );
  await audit(req, 'activity.update', 'activity', id, { title });
  res.json({ message: 'Activité mise à jour.' });
}));

router.delete('/activities/:id', requireAuth, requireCsrf, requirePermission('activities.manage'), ah(async (req, res) => {
  const id = intId(req.params.id);
  const a = await one('SELECT id FROM activities WHERE id = $1', [id]);
  if (!a) throw notFound('Activité introuvable.');
  await query('DELETE FROM activities WHERE id = $1', [id]);
  await audit(req, 'activity.delete', 'activity', id, {});
  res.json({ message: 'Activité supprimée.' });
}));

router.get('/public/activities', ah(async (req, res) => {
  const settings = await getSettings();
  if (!moduleEnabled(settings, 'activities')) return res.json({ activities: [] });
  let map = {};
  try { map = JSON.parse(settings.activity_categories || '{}'); } catch {}
  const allowed = CATEGORIES.filter((c) => map[c] !== false);
  const rows = await query(
    `SELECT a.id, a.title, a.description, a.category, a.date_start, a.date_end, a.location, a.organizer, a.link
     FROM activities a
     WHERE a.active = TRUE AND a.category IN (${allowed.map((c) => `'${c}'`).join(',') || "''"})
     ORDER BY a.date_start DESC NULLS LAST, a.created_at DESC LIMIT 6`
  );
  res.json({ activities: rows });
}));

export default router;
