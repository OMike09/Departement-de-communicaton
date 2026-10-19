import express from 'express';
import { query, one } from '../db.js';
import { requireAuth, requireCsrf, requirePermission } from '../auth.js';
import { hasPermission } from '../permissions.js';
import { audit } from '../audit.js';
import { ah, assertScopeFor } from './util.js';
import { str, intId, oneOf, dateOnly, isoDate, pagination, bool } from '../validation.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { notifyUsers, studentIdsFor } from '../services/notify.js';
import { getSettings, moduleEnabled } from '../settings.js';

const router = express.Router();

/* ---------------------------- Emplois du temps ---------------------------- */
const scopeCondition = `(
  (t.level_id IS NULL OR t.level_id = $2 OR t.level_id IN (SELECT scope_id FROM user_scopes WHERE user_id = $1 AND scope_type = 'level'))
  AND (t.parcours_id IS NULL OR t.parcours_id = $3 OR t.parcours_id IN (SELECT scope_id FROM user_scopes WHERE user_id = $1 AND scope_type = 'parcours'))
  AND (t.group_name = '' OR t.group_name = $4)
)`;

router.get('/timetables', requireAuth, ah(async (req, res) => {
  const manager = hasPermission(req.user, 'timetables.manage');
  const params = [];
  const where = [];
  if (!manager) {
    params.push(req.user.id, req.user.level_id, req.user.parcours_id, req.user.group_name);
    where.push('t.archived = FALSE AND ' + scopeCondition);
  } else if (req.query.archived !== '1') {
    where.push('t.archived = FALSE');
  }
  if (req.query.level) {
    params.push(intId(req.query.level));
    where.push(`t.level_id = $${params.length}`);
  }
  if (req.query.parcours) {
    params.push(intId(req.query.parcours));
    where.push(`t.parcours_id = $${params.length}`);
  }
  const rows = await query(
    `SELECT t.*, l.name AS level_name, p.name AS parcours_name, u.full_name AS author_name,
            f.filename, f.mime, f.size
     FROM timetables t
     LEFT JOIN levels l ON l.id = t.level_id
     LEFT JOIN parcours p ON p.id = t.parcours_id
     LEFT JOIN users u ON u.id = t.created_by
     LEFT JOIN files f ON f.id = t.file_id
     WHERE ${where.join(' AND ')}
     ORDER BY t.created_at DESC LIMIT 100`,
    params
  );
  res.json({ timetables: rows });
}));

router.post('/timetables', requireAuth, requireCsrf, requirePermission('timetables.manage'), ah(async (req, res) => {
  const title = str(req.body.title, { required: true, min: 2, max: 200, field: 'Le titre' });
  const levelId = intId(req.body.level_id, { required: false });
  const parcoursId = intId(req.body.parcours_id, { required: false });
  const groupName = str(req.body.group_name, { max: 80 });
  const year = str(req.body.academic_year, { max: 30 });
  const semester = str(req.body.semester, { max: 40 });
  const dateStart = dateOnly(req.body.date_start);
  const dateEnd = dateOnly(req.body.date_end);
  const note = str(req.body.note, { max: 2000 });
  const fileId = intId(req.body.file_id, { required: false });
  if (fileId && !(await one('SELECT id FROM files WHERE id = $1', [fileId]))) throw badRequest('Fichier introuvable.');
  await assertScopeFor(req.user, { levelId, parcoursId, groupName });
  const row = await one(
    `INSERT INTO timetables (title, level_id, parcours_id, group_name, academic_year, semester, date_start, date_end, note, file_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [title, levelId, parcoursId, groupName, year, semester, dateStart, dateEnd, note, fileId, req.user.id]
  );
  let notified = 0;
  if (bool(req.body.notify, false)) {
    const ids = await studentIdsFor(levelId, parcoursId);
    notified = await notifyUsers(ids, {
      type: 'timetable',
      title: `Emploi du temps : ${title}`,
      body: 'Un nouvel emploi du temps est disponible dans votre espace.',
    });
  }
  await audit(req, 'timetable.create', 'timetable', row.id, { title, notified });
  res.status(201).json({ message: `Emploi du temps publié.${notified ? ` ${notified} étudiant(s) notifié(s).` : ''}`, id: row.id });
}));

router.put('/timetables/:id', requireAuth, requireCsrf, requirePermission('timetables.manage'), ah(async (req, res) => {
  const id = intId(req.params.id);
  const tt = await one('SELECT * FROM timetables WHERE id = $1', [id]);
  if (!tt) throw notFound('Emploi du temps introuvable.');
  const title = str(req.body.title ?? tt.title, { required: true, max: 200, field: 'Le titre' });
  const levelId = req.body.level_id === undefined ? tt.level_id : intId(req.body.level_id, { required: false });
  const parcoursId = req.body.parcours_id === undefined ? tt.parcours_id : intId(req.body.parcours_id, { required: false });
  const groupName = str(req.body.group_name ?? tt.group_name, { max: 80 });
  const year = str(req.body.academic_year ?? tt.academic_year, { max: 30 });
  const semester = str(req.body.semester ?? tt.semester, { max: 40 });
  const dateStart = req.body.date_start === undefined ? tt.date_start : dateOnly(req.body.date_start);
  const dateEnd = req.body.date_end === undefined ? tt.date_end : dateOnly(req.body.date_end);
  const note = str(req.body.note ?? tt.note, { max: 2000 });
  const fileId = req.body.file_id === undefined ? tt.file_id : intId(req.body.file_id, { required: false });
  await assertScopeFor(req.user, { levelId, parcoursId, groupName });
  await query(
    `UPDATE timetables SET title=$1, level_id=$2, parcours_id=$3, group_name=$4, academic_year=$5, semester=$6,
       date_start=$7, date_end=$8, note=$9, file_id=$10 WHERE id=$11`,
    [title, levelId, parcoursId, groupName, year, semester, dateStart, dateEnd, note, fileId, id]
  );
  let notified = 0;
  if (bool(req.body.notify, false)) {
    const ids = await studentIdsFor(levelId, parcoursId);
    notified = await notifyUsers(ids, {
      type: 'timetable',
      title: `Emploi du temps modifié : ${title}`,
      body: 'Une modification de l’emploi du temps est disponible.',
    });
  }
  await audit(req, 'timetable.update', 'timetable', id, { title, notified });
  res.json({ message: `Emploi du temps mis à jour.${notified ? ` ${notified} étudiant(s) notifié(s).` : ''}` });
}));

router.post('/timetables/:id/archive', requireAuth, requireCsrf, requirePermission('timetables.manage'), ah(async (req, res) => {
  const id = intId(req.params.id);
  const tt = await one('SELECT * FROM timetables WHERE id = $1', [id]);
  if (!tt) throw notFound('Emploi du temps introuvable.');
  await assertScopeFor(req.user, { levelId: tt.level_id, parcoursId: tt.parcours_id, groupName: tt.group_name });
  const archived = bool(req.body.archived, true);
  await query('UPDATE timetables SET archived = $1 WHERE id = $2', [archived, id]);
  await audit(req, archived ? 'timetable.archive' : 'timetable.restore', 'timetable', id, {});
  res.json({ message: archived ? 'Emploi du temps archivé.' : 'Emploi du temps restauré.' });
}));

router.delete('/timetables/:id', requireAuth, requireCsrf, requirePermission('timetables.manage'), ah(async (req, res) => {
  const id = intId(req.params.id);
  const tt = await one('SELECT * FROM timetables WHERE id = $1', [id]);
  if (!tt) throw notFound('Emploi du temps introuvable.');
  await assertScopeFor(req.user, { levelId: tt.level_id, parcoursId: tt.parcours_id, groupName: tt.group_name });
  await query('DELETE FROM timetables WHERE id = $1', [id]);
  await audit(req, 'timetable.delete', 'timetable', id, {});
  res.json({ message: 'Emploi du temps supprimé.' });
}));

/* ------------------------------- Calendrier ------------------------------ */
function eventVisibility(req) {
  const params = [req.user.id, req.user.level_id, req.user.parcours_id, req.user.role_slug];
  return {
    params,
    sql: `e.active = TRUE
      AND (e.level_id IS NULL OR e.level_id = $2 OR e.level_id IN (SELECT scope_id FROM user_scopes WHERE user_id = $1 AND scope_type='level'))
      AND (e.parcours_id IS NULL OR e.parcours_id = $3 OR e.parcours_id IN (SELECT scope_id FROM user_scopes WHERE user_id = $1 AND scope_type='parcours'))
      AND (e.audience IN ('public','all')
           OR (e.audience = 'etudiant' AND $4 = 'etudiant')
           OR (e.audience = 'enseignant' AND $4 = 'enseignant')
           OR (e.audience = 'personnel' AND $4 <> 'etudiant'))`,
  };
}

router.get('/public/events', ah(async (req, res) => {
  const settings = await getSettings();
  if (!moduleEnabled(settings, 'timetables')) return res.json({ events: [] });
  const rows = await query(
    `SELECT e.id, e.title, e.description, e.type, e.starts_at, e.ends_at, e.location
     FROM schedule_events e
     WHERE e.active = TRUE AND e.audience = 'public' AND e.starts_at >= now() - interval '2 hours'
     ORDER BY e.starts_at ASC LIMIT 8`
  );
  res.json({ events: rows });
}));

router.get('/events', requireAuth, ah(async (req, res) => {
  const manager = hasPermission(req.user, 'timetables.manage');
  let where = 'e.active = TRUE';
  let params = [];
  if (!manager) {
    const vis = eventVisibility(req);
    where = vis.sql;
    params = vis.params;
  }
  if (req.query.from) {
    params.push(isoDate(req.query.from, { field: 'Date de début' }));
    where += ` AND e.starts_at >= $${params.length}`;
  }
  if (req.query.to) {
    params.push(isoDate(req.query.to, { field: 'Date de fin' }));
    where += ` AND e.starts_at <= $${params.length}`;
  }
  if (req.query.level) {
    params.push(intId(req.query.level));
    where += ` AND e.level_id = $${params.length}`;
  }
  if (req.query.parcours) {
    params.push(intId(req.query.parcours));
    where += ` AND e.parcours_id = $${params.length}`;
  }
  const rows = await query(
    `SELECT e.*, l.name AS level_name, p.name AS parcours_name, u.full_name AS author_name
     FROM schedule_events e
     LEFT JOIN levels l ON l.id = e.level_id
     LEFT JOIN parcours p ON p.id = e.parcours_id
     LEFT JOIN users u ON u.id = e.created_by
     WHERE ${where} ORDER BY e.starts_at ASC LIMIT 300`,
    params
  );
  res.json({ events: rows });
}));

router.post('/events', requireAuth, requireCsrf, requirePermission('timetables.manage'), ah(async (req, res) => {
  const title = str(req.body.title, { required: true, min: 2, max: 200, field: 'Le titre' });
  const description = str(req.body.description, { max: 3000 });
  const type = oneOf(req.body.type || 'autre', ['examen', 'soutenance', 'conference', 'atelier', 'reunion', 'autre'], { field: 'Type' });
  const startsAt = isoDate(req.body.starts_at, { required: true, field: 'La date de début' });
  const endsAt = isoDate(req.body.ends_at);
  if (endsAt && new Date(endsAt) < new Date(startsAt)) throw badRequest('La date de fin précède la date de début.');
  const location = str(req.body.location, { max: 160 });
  const levelId = intId(req.body.level_id, { required: false });
  const parcoursId = intId(req.body.parcours_id, { required: false });
  const audience = oneOf(req.body.audience || 'all', ['public', 'all', 'etudiant', 'enseignant', 'personnel'], { field: 'Audience' });
  await assertScopeFor(req.user, { levelId, parcoursId });
  const row = await one(
    `INSERT INTO schedule_events (title, description, type, starts_at, ends_at, location, level_id, parcours_id, audience, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [title, description, type, startsAt, endsAt, location, levelId, parcoursId, audience, req.user.id]
  );
  await audit(req, 'event.create', 'event', row.id, { title, type });
  res.status(201).json({ message: 'Événement ajouté au calendrier.', id: row.id });
}));

router.put('/events/:id', requireAuth, requireCsrf, requirePermission('timetables.manage'), ah(async (req, res) => {
  const id = intId(req.params.id);
  const ev = await one('SELECT * FROM schedule_events WHERE id = $1', [id]);
  if (!ev) throw notFound('Événement introuvable.');
  const title = str(req.body.title ?? ev.title, { required: true, max: 200, field: 'Le titre' });
  const description = str(req.body.description ?? ev.description, { max: 3000 });
  const type = oneOf(req.body.type ?? ev.type, ['examen', 'soutenance', 'conference', 'atelier', 'reunion', 'autre'], { field: 'Type' });
  const startsAt = req.body.starts_at === undefined ? ev.starts_at : isoDate(req.body.starts_at, { required: true, field: 'La date de début' });
  const endsAt = req.body.ends_at === undefined ? ev.ends_at : isoDate(req.body.ends_at);
  const location = str(req.body.location ?? ev.location, { max: 160 });
  const levelId = req.body.level_id === undefined ? ev.level_id : intId(req.body.level_id, { required: false });
  const parcoursId = req.body.parcours_id === undefined ? ev.parcours_id : intId(req.body.parcours_id, { required: false });
  const audience = oneOf(req.body.audience ?? ev.audience, ['public', 'all', 'etudiant', 'enseignant', 'personnel'], { field: 'Audience' });
  await assertScopeFor(req.user, { levelId, parcoursId });
  await query(
    `UPDATE schedule_events SET title=$1, description=$2, type=$3, starts_at=$4, ends_at=$5, location=$6,
       level_id=$7, parcours_id=$8, audience=$9 WHERE id=$10`,
    [title, description, type, startsAt, endsAt, location, levelId, parcoursId, audience, id]
  );
  await audit(req, 'event.update', 'event', id, { title });
  res.json({ message: 'Événement mis à jour.' });
}));

router.delete('/events/:id', requireAuth, requireCsrf, requirePermission('timetables.manage'), ah(async (req, res) => {
  const id = intId(req.params.id);
  const ev = await one('SELECT * FROM schedule_events WHERE id = $1', [id]);
  if (!ev) throw notFound('Événement introuvable.');
  await assertScopeFor(req.user, { levelId: ev.level_id, parcoursId: ev.parcours_id });
  await query('DELETE FROM schedule_events WHERE id = $1', [id]);
  await audit(req, 'event.delete', 'event', id, {});
  res.json({ message: 'Événement supprimé.' });
}));

export default router;
