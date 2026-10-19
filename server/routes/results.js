import express from 'express';
import { query, one } from '../db.js';
import { requireAuth, requireCsrf, requirePermission } from '../auth.js';
import { hasPermission } from '../permissions.js';
import { audit } from '../audit.js';
import { ah, assertScopeFor } from './util.js';
import { str, intId, oneOf, pagination, bool } from '../validation.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { canManageResults } from '../services/access.js';
import { notifyUsers, studentIdsFor } from '../services/notify.js';

const router = express.Router();

async function history(resultId, actorId, action, details = '') {
  await query('INSERT INTO result_history (result_id, actor_id, action, details) VALUES ($1,$2,$3,$4)', [
    resultId, actorId, action, details,
  ]);
}

router.get('/results', requireAuth, ah(async (req, res) => {
  const manager = canManageResults(req.user);
  const params = [];
  let where = 'TRUE';
  if (manager) {
    if (req.query.status) {
      params.push(oneOf(req.query.status, ['draft', 'published', 'withdrawn'], { field: 'Statut' }));
      where += ` AND r.status = $${params.length}`;
    }
  } else {
    if (req.user.role_slug !== 'etudiant') {
      return res.json({ results: [], total: 0 });
    }
    params.push(req.user.level_id, req.user.parcours_id);
    where = `r.status = 'published'
      AND (r.level_id IS NULL OR r.level_id = $1)
      AND (r.parcours_id IS NULL OR r.parcours_id = $2)`;
  }
  if (req.query.level) {
    params.push(intId(req.query.level));
    where += ` AND r.level_id = $${params.length}`;
  }
  if (req.query.parcours) {
    params.push(intId(req.query.parcours));
    where += ` AND r.parcours_id = $${params.length}`;
  }
  const rows = await query(
    `SELECT r.*, l.name AS level_name, p.name AS parcours_name, f.filename, f.mime, f.size,
            u.full_name AS author_name, pu.full_name AS publisher_name,
            (SELECT COUNT(*)::int FROM result_views v WHERE v.result_id = r.id) AS view_count
     FROM results r
     LEFT JOIN levels l ON l.id = r.level_id
     LEFT JOIN parcours p ON p.id = r.parcours_id
     JOIN files f ON f.id = r.file_id
     LEFT JOIN users u ON u.id = r.created_by
     LEFT JOIN users pu ON pu.id = r.published_by
     WHERE ${where}
     ORDER BY COALESCE(r.published_at, r.created_at) DESC LIMIT 100`,
    params
  );
  res.json({ results: rows, total: rows.length });
}));

router.get('/results/:id', requireAuth, ah(async (req, res) => {
  const id = intId(req.params.id);
  const row = await one(
    `SELECT r.*, l.name AS level_name, p.name AS parcours_name, f.filename, f.mime, f.size,
            u.full_name AS author_name, pu.full_name AS publisher_name
     FROM results r LEFT JOIN levels l ON l.id=r.level_id LEFT JOIN parcours p ON p.id=r.parcours_id
     JOIN files f ON f.id=r.file_id LEFT JOIN users u ON u.id=r.created_by LEFT JOIN users pu ON pu.id=r.published_by
     WHERE r.id = $1`,
    [id]
  );
  if (!row) throw notFound('Résultat introuvable.');
  const manager = canManageResults(req.user);
  if (!manager) {
    if (row.status !== 'published' || req.user.role_slug !== 'etudiant') throw notFound('Résultat introuvable.');
    if (row.level_id && row.level_id !== req.user.level_id) throw notFound('Résultat introuvable.');
    if (row.parcours_id && row.parcours_id !== req.user.parcours_id) throw notFound('Résultat introuvable.');
  }
  const my = await one('SELECT first_viewed_at FROM result_views WHERE result_id = $1 AND user_id = $2', [id, req.user.id]);
  res.json({ result: row, my_view: my });
}));

router.post('/results', requireAuth, requireCsrf, requirePermission('results.manage'), ah(async (req, res) => {
  const title = str(req.body.title, { required: true, min: 2, max: 200, field: 'Le titre' });
  const levelId = intId(req.body.level_id, { field: 'Le niveau', required: true });
  const parcoursId = intId(req.body.parcours_id, { required: false });
  const session = str(req.body.session, { max: 80 });
  const period = str(req.body.period, { max: 80 });
  const fileId = intId(req.body.file_id, { field: 'Le fichier PDF' });
  const file = await one('SELECT id, mime FROM files WHERE id = $1', [fileId]);
  if (!file) throw badRequest('Fichier introuvable.');
  if (file.mime !== 'application/pdf') throw badRequest('Les résultats doivent être déposés au format PDF.');
  await assertScopeFor(req.user, { levelId, parcoursId });
  const row = await one(
    `INSERT INTO results (title, level_id, parcours_id, session, period, file_id, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,'draft',$7) RETURNING id`,
    [title, levelId, parcoursId, session, period, fileId, req.user.id]
  );
  await history(row.id, req.user.id, 'create', 'Dépôt du fichier de résultats');
  await audit(req, 'result.create', 'result', row.id, { title });
  res.status(201).json({ message: 'Résultats déposés en brouillon. Ils ne sont visibles qu’après publication.', id: row.id });
}));

router.put('/results/:id', requireAuth, requireCsrf, requirePermission('results.manage'), ah(async (req, res) => {
  const id = intId(req.params.id);
  const r = await one('SELECT * FROM results WHERE id = $1', [id]);
  if (!r) throw notFound('Résultat introuvable.');
  const title = str(req.body.title ?? r.title, { required: true, max: 200, field: 'Le titre' });
  const levelId = req.body.level_id === undefined ? r.level_id : intId(req.body.level_id, { required: false });
  const parcoursId = req.body.parcours_id === undefined ? r.parcours_id : intId(req.body.parcours_id, { required: false });
  const session = str(req.body.session ?? r.session, { max: 80 });
  const period = str(req.body.period ?? r.period, { max: 80 });
  await assertScopeFor(req.user, { levelId: r.level_id, parcoursId: r.parcours_id });
  let fileId = r.file_id;
  let replaced = false;
  if (req.body.file_id && Number(req.body.file_id) !== Number(r.file_id)) {
    fileId = intId(req.body.file_id);
    const file = await one('SELECT id, mime FROM files WHERE id = $1', [fileId]);
    if (!file) throw badRequest('Fichier introuvable.');
    if (file.mime !== 'application/pdf') throw badRequest('Les résultats doivent être au format PDF.');
    replaced = true;
  }
  await query(
    `UPDATE results SET title=$1, level_id=$2, parcours_id=$3, session=$4, period=$5, file_id=$6, updated_at=now() WHERE id=$7`,
    [title, levelId, parcoursId, session, period, fileId, id]
  );
  await history(id, req.user.id, replaced ? 'replace_file' : 'update', replaced ? 'Remplacement du fichier de résultats' : 'Mise à jour des informations');
  if (replaced && r.status === 'published') {
    await query("UPDATE results SET status='draft' WHERE id=$1", [id]);
    await history(id, req.user.id, 'status', 'Repassé en brouillon après remplacement du fichier');
  }
  await audit(req, 'result.update', 'result', id, { replaced });
  res.json({ message: replaced ? 'Fichier remplacé. Le résultat repasse en brouillon et doit être publié à nouveau.' : 'Résultat mis à jour.' });
}));

router.post('/results/:id/publish', requireAuth, requireCsrf, requirePermission('results.publish'), ah(async (req, res) => {
  const id = intId(req.params.id);
  const r = await one('SELECT * FROM results WHERE id = $1', [id]);
  if (!r) throw notFound('Résultat introuvable.');
  await assertScopeFor(req.user, { levelId: r.level_id, parcoursId: r.parcours_id });
  if (r.status === 'published') throw badRequest('Ce résultat est déjà publié.');
  await query("UPDATE results SET status='published', published_by=$1, published_at=now(), updated_at=now() WHERE id=$2", [req.user.id, id]);
  await history(id, req.user.id, 'publish', 'Publication des résultats');
  const ids = await studentIdsFor(r.level_id, r.parcours_id);
  const notified = await notifyUsers(ids, {
    type: 'result',
    title: `Résultats publiés : ${r.title}`,
    body: 'Des résultats sont désormais disponibles dans votre espace.',
  });
  await audit(req, 'result.publish', 'result', id, { notified });
  res.json({ message: `Résultats publiés. ${notified} étudiant(s) notifié(s).` });
}));

router.post('/results/:id/withdraw', requireAuth, requireCsrf, requirePermission('results.manage'), ah(async (req, res) => {
  const id = intId(req.params.id);
  const r = await one('SELECT * FROM results WHERE id = $1', [id]);
  if (!r) throw notFound('Résultat introuvable.');
  await assertScopeFor(req.user, { levelId: r.level_id, parcoursId: r.parcours_id });
  await query("UPDATE results SET status='withdrawn', updated_at=now() WHERE id=$1", [id]);
  await history(id, req.user.id, 'withdraw', str(req.body.reason, { max: 500 }) || 'Retrait des résultats');
  await audit(req, 'result.withdraw', 'result', id, {});
  res.json({ message: 'Résultat retiré. Il n’est plus accessible aux étudiants.' });
}));

router.get('/results/:id/history', requireAuth, requirePermission('results.manage'), ah(async (req, res) => {
  const id = intId(req.params.id);
  const rows = await query(
    `SELECT h.*, u.full_name AS actor_name FROM result_history h LEFT JOIN users u ON u.id=h.actor_id
     WHERE h.result_id=$1 ORDER BY h.created_at DESC`,
    [id]
  );
  res.json({ history: rows });
}));

router.get('/results/:id/viewers', requireAuth, requirePermission('results.manage'), ah(async (req, res) => {
  const id = intId(req.params.id);
  const rows = await query(
    `SELECT v.first_viewed_at, u.full_name, u.phone, l.name AS level_name, p.name AS parcours_name
     FROM result_views v JOIN users u ON u.id=v.user_id
     LEFT JOIN levels l ON l.id=u.level_id LEFT JOIN parcours p ON p.id=u.parcours_id
     WHERE v.result_id=$1 ORDER BY v.first_viewed_at`,
    [id]
  );
  res.json({ viewers: rows });
}));

router.post('/results/:id/view', requireAuth, requireCsrf, ah(async (req, res) => {
  const id = intId(req.params.id);
  const row = await one('SELECT * FROM results WHERE id = $1', [id]);
  if (!row) throw notFound('Résultat introuvable.');
  if (!canManageResults(req.user)) {
    if (row.status !== 'published' || req.user.role_slug !== 'etudiant') throw forbidden();
    if (row.level_id && row.level_id !== req.user.level_id) throw forbidden();
    if (row.parcours_id && row.parcours_id !== req.user.parcours_id) throw forbidden();
  }
  await query(
    `INSERT INTO result_views (result_id, user_id) VALUES ($1,$2) ON CONFLICT (result_id, user_id) DO NOTHING`,
    [id, req.user.id]
  );
  res.json({ ok: true });
}));

export default router;
