import express from 'express';
import { query, one, tx } from '../db.js';
import { requireAuth, requireCsrf, requirePermission } from '../auth.js';
import { hasPermission } from '../permissions.js';
import { audit } from '../audit.js';
import { ah, parseAudiences, userScopeList, audienceLabel } from './util.js';
import { str, intId, oneOf, isoDate, pagination, bool } from '../validation.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { publishPublication } from '../services/notify.js';
import { canReadPublication } from '../services/access.js';

const router = express.Router();

const PUB_SELECT = `
  SELECT p.*, c.name AS category_name, c.color AS category_color,
         u.full_name AS author_name, u.role_id AS author_role_id,
         ru.slug AS author_role,
         (SELECT COUNT(*)::int FROM publication_views v WHERE v.publication_id = p.id) AS view_count,
         (SELECT COUNT(*)::int FROM publication_files f WHERE f.publication_id = p.id) AS file_count
  FROM publications p
  LEFT JOIN categories c ON c.id = p.category_id
  JOIN users u ON u.id = p.created_by
  JOIN roles ru ON ru.id = u.role_id`;

async function audiencesFor(ids) {
  if (!ids.length) return new Map();
  const rows = await query(
    `SELECT publication_id, kind, target_text, target_id FROM publication_audiences WHERE publication_id = ANY($1::int[])`,
    [ids]
  );
  const levels = await query('SELECT id, name FROM levels');
  const parcours = await query('SELECT id, name FROM parcours');
  const roles = await query('SELECT slug, name FROM roles');
  const lmap = new Map(levels.map((l) => [l.id, l.name]));
  const pmap = new Map(parcours.map((p) => [p.id, p.name]));
  const rmap = new Map(roles.map((r) => [r.slug, r.name]));
  const out = new Map();
  for (const row of rows) {
    let label = '';
    if (row.kind === 'public') label = 'Public (page d’accueil)';
    else if (row.kind === 'all') label = 'Tous les utilisateurs';
    else if (row.kind === 'role') label = `Rôle : ${rmap.get(row.target_text) || row.target_text}`;
    else if (row.kind === 'level') label = `Niveau : ${lmap.get(Number(row.target_text)) || row.target_text}`;
    else if (row.kind === 'parcours') label = `Parcours : ${pmap.get(Number(row.target_text)) || row.target_text}`;
    else if (row.kind === 'group') label = `Groupe : ${row.target_text}`;
    if (!out.has(row.publication_id)) out.set(row.publication_id, []);
    out.get(row.publication_id).push({ kind: row.kind, target_text: row.target_text, target_id: row.target_id, label });
  }
  return out;
}

function feedAudienceSql(paramIndexBase, user) {
  // Construit la condition de visibilité des publications pour un utilisateur connecté.
  return `EXISTS (
    SELECT 1 FROM publication_audiences a WHERE a.publication_id = p.id AND (
         a.kind IN ('public','all')
      OR (a.kind = 'role' AND a.target_text = $${paramIndexBase + 1})
      OR (a.kind = 'level' AND $${paramIndexBase + 1} = 'etudiant' AND (a.target_id = $${paramIndexBase + 2} OR (a.target_id IS NULL AND a.target_text = $${paramIndexBase + 3})))
      OR (a.kind = 'parcours' AND $${paramIndexBase + 1} = 'etudiant' AND (a.target_id = $${paramIndexBase + 4} OR (a.target_id IS NULL AND a.target_text = $${paramIndexBase + 5})))
      OR (a.kind = 'group' AND $${paramIndexBase + 1} = 'etudiant' AND a.target_text = $${paramIndexBase + 6})
    )
  )`;
}

router.get('/categories', requireAuth, ah(async (req, res) => {
  const rows = await query('SELECT * FROM categories WHERE active = TRUE ORDER BY sort_order, name');
  res.json({ categories: rows });
}));

router.get('/public/announcements', ah(async (req, res) => {
  const limit = Math.min(20, Math.max(1, Number.parseInt(req.query.limit || '6', 10) || 6));
  const rows = await query(
    `${PUB_SELECT}
     WHERE p.status = 'published' AND p.published_at IS NOT NULL AND p.published_at <= now()
       AND EXISTS (SELECT 1 FROM publication_audiences a WHERE a.publication_id = p.id AND a.kind = 'public')
     ORDER BY p.pinned DESC, p.published_at DESC
     LIMIT ${limit}`
  );
  const aud = await audiencesFor(rows.map((r) => r.id));
  res.json({
    announcements: rows.map((r) => ({
      id: r.id, title: r.title, excerpt: String(r.body || '').slice(0, 320),
      published_at: r.published_at, category_name: r.category_name, category_color: r.category_color,
      priority: r.priority, pinned: r.pinned, audiences: aud.get(r.id) || [],
    })),
  });
}));

router.get('/public/announcements/:id', ah(async (req, res) => {
  const id = intId(req.params.id);
  const access = await canReadPublication(null, id);
  if (!access.ok) throw notFound('Annonce introuvable.');
  const row = await one(`${PUB_SELECT} WHERE p.id = $1`, [id]);
  const audiences = await audiencesFor([id]);
  const files = await query(
    `SELECT f.id, f.filename, f.mime, f.size FROM publication_files pf JOIN files f ON f.id=pf.file_id WHERE pf.publication_id=$1`,
    [id]
  );
  res.json({ publication: { ...row, audiences: audiences.get(id) || [], files } });
}));

router.get('/publications', requireAuth, ah(async (req, res) => {
  const { page, limit, offset } = pagination(req.query, 20);
  const scope = req.query.scope === 'manage' ? 'manage' : 'feed';
  const params = [];
  const where = [];

  if (scope === 'manage') {
    if (!hasPermission(req.user, 'publications.create') && !hasPermission(req.user, 'publications.manage_all')) {
      throw forbidden();
    }
    if (!hasPermission(req.user, 'publications.manage_all')) {
      params.push(req.user.id);
      where.push(`p.created_by = $${params.length}`);
    }
    if (req.query.status) {
      params.push(oneOf(req.query.status, ['draft', 'scheduled', 'published', 'archived'], { field: 'Statut' }));
      where.push(`p.status = $${params.length}`);
    }
  } else {
    params.push(req.user.role_slug, req.user.level_id, String(req.user.level_id ?? ''), req.user.parcours_id, String(req.user.parcours_id ?? ''), req.user.group_name);
    const base = params.length - 6;
    where.push(
      `p.status = 'published' AND p.published_at <= now() AND (p.created_by = $${params.length + 1} OR ${feedAudienceSql(base, req.user)})`
    );
    params.push(req.user.id);
  }

  if (req.query.category) {
    params.push(intId(req.query.category, { field: 'Catégorie' }));
    where.push(`p.category_id = $${params.length}`);
  }
  if (req.query.q) {
    params.push(`%${String(req.query.q).trim().slice(0, 100)}%`);
    where.push(`(p.title ILIKE $${params.length} OR p.body ILIKE $${params.length})`);
  }
  if (req.query.level) {
    params.push(intId(req.query.level, { field: 'Niveau' }));
    where.push(`EXISTS (SELECT 1 FROM publication_audiences a2 WHERE a2.publication_id = p.id AND a2.kind='level' AND a2.target_id = $${params.length})`);
  }
  if (req.query.parcours) {
    params.push(intId(req.query.parcours, { field: 'Parcours' }));
    where.push(`EXISTS (SELECT 1 FROM publication_audiences a3 WHERE a3.publication_id = p.id AND a3.kind='parcours' AND a3.target_id = $${params.length})`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await one(`SELECT COUNT(*)::int AS n FROM publications p ${whereSql}`, params);
  const rows = await query(
    `${PUB_SELECT} ${whereSql}
     ORDER BY p.pinned DESC, COALESCE(p.published_at, p.publish_at, p.created_at) DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  const aud = await audiencesFor(rows.map((r) => r.id));
  res.json({
    publications: rows.map((r) => ({
      ...r,
      audiences: aud.get(r.id) || [],
      body_preview: String(r.body || '').slice(0, 220),
    })),
    total: total.n, page, limit,
  });
}));

router.get('/publications/:id', requireAuth, ah(async (req, res) => {
  const id = intId(req.params.id);
  const access = await canReadPublication(req.user, id);
  if (!access.ok) throw notFound('Publication introuvable ou non accessible.');
  const row = await one(`${PUB_SELECT} WHERE p.id = $1`, [id]);
  const audiences = await audiencesFor([id]);
  const files = await query(
    `SELECT f.id, f.filename, f.mime, f.size FROM publication_files pf JOIN files f ON f.id = pf.file_id WHERE pf.publication_id = $1`,
    [id]
  );
  const mine = await one('SELECT first_viewed_at, last_viewed_at, view_count FROM publication_views WHERE publication_id = $1 AND user_id = $2', [id, req.user.id]);
  res.json({ publication: { ...row, audiences: audiences.get(id) || [], files }, my_view: mine });
}));

async function validateAudiences(req, audiences) {
  if (!audiences.length) throw badRequest('Choisissez au moins un destinataire.', 'audience_required');
  const canAll = hasPermission(req.user, 'publications.audience_all');
  const scopes = await userScopeList(req.user.id);
  const scopeSet = new Set(scopes.map((s) => `${s.type}:${s.id}`));
  for (const a of audiences) {
    if (a.kind === 'level') {
      const lvl = await one('SELECT id FROM levels WHERE id = $1 AND active = TRUE', [Number(a.target_text)]);
      if (!lvl) throw badRequest('Un niveau destinataire est invalide.');
      a.target_id = lvl.id;
      if (!canAll && !scopeSet.has(`level:${lvl.id}`)) throw forbidden("Vous ne pouvez pas publier vers un niveau qui ne relève pas de votre périmètre.");
    } else if (a.kind === 'parcours') {
      const p = await one('SELECT id FROM parcours WHERE id = $1 AND active = TRUE', [Number(a.target_text)]);
      if (!p) throw badRequest('Un parcours destinataire est invalide.');
      a.target_id = p.id;
      if (!canAll && !scopeSet.has(`parcours:${p.id}`)) throw forbidden("Vous ne pouvez pas publier vers un parcours qui ne relève pas de votre périmètre.");
    } else if (a.kind === 'group') {
      const g = await one('SELECT id, name FROM groups WHERE id = $1', [Number(a.target_id)]).catch(() => null);
      const groupRow = g || (await one('SELECT id, name FROM groups WHERE name = $1', [a.target_text]));
      if (!groupRow) throw badRequest('Le groupe destinataire est invalide.');
      a.target_text = groupRow.name;
      a.target_id = groupRow.id;
      if (!canAll && !scopeSet.has(`group:${groupRow.id}`)) throw forbidden("Vous ne pouvez pas publier vers un groupe qui ne relève pas de votre périmètre.");
    } else if (a.kind === 'role') {
      const role = await one('SELECT slug FROM roles WHERE slug = $1', [a.target_text]);
      if (!role) throw badRequest('Rôle destinataire invalide.');
      if (!canAll && a.target_text !== req.user.role_slug) throw forbidden('Vous ne pouvez pas cibler ce rôle.');
    } else if ((a.kind === 'all' || a.kind === 'public') && !canAll) {
      throw forbidden('Vous ne disposez pas du droit de publier vers cette audience. Contactez le chef de département.');
    }
  }
  return audiences;
}

async function syncFiles(t, publicationId, fileIds, actor) {
  const ids = Array.isArray(fileIds) ? fileIds.map(Number).filter(Boolean) : [];
  const existing = await t.query('SELECT file_id FROM publication_files WHERE publication_id = $1', [publicationId]);
  const existingSet = new Set(existing.map((f) => f.file_id));
  for (const fileId of ids) {
    const file = await t.one('SELECT id, uploaded_by FROM files WHERE id = $1', [fileId]);
    if (!file) throw badRequest('Pièce jointe introuvable.');
    if (file.uploaded_by !== actor.id && !hasPermission(actor, 'publications.manage_all')) {
      throw forbidden('Vous ne pouvez joindre que des fichiers que vous avez déposés.');
    }
    if (!existingSet.has(fileId)) {
      await t.query('INSERT INTO publication_files (publication_id, file_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [publicationId, fileId]);
    }
  }
  for (const fileId of existingSet) {
    if (!ids.includes(fileId)) await t.query('DELETE FROM publication_files WHERE publication_id = $1 AND file_id = $2', [publicationId, fileId]);
  }
}

async function saveAudiences(t, publicationId, audiences) {
  await t.query('DELETE FROM publication_audiences WHERE publication_id = $1', [publicationId]);
  for (const a of audiences) {
    await t.query(
      'INSERT INTO publication_audiences (publication_id, kind, target_text, target_id) VALUES ($1,$2,$3,$4)',
      [publicationId, a.kind, String(a.target_text || ''), a.target_id || null]
    );
  }
}

router.post('/publications', requireAuth, requireCsrf, requirePermission('publications.create'), ah(async (req, res) => {
  const title = str(req.body.title, { required: true, min: 3, max: 200, field: 'Le titre' });
  const body = str(req.body.body, { max: 30000, field: 'Le texte' });
  const files = Array.isArray(req.body.file_ids) ? req.body.file_ids : [];
  if (!body && files.length === 0) throw badRequest('Ajoutez un texte ou au moins une pièce jointe.');
  const status = oneOf(req.body.status || 'draft', ['draft', 'scheduled', 'published'], { field: 'Statut' });
  let publishAt = isoDate(req.body.publish_at);
  if (status === 'scheduled') {
    if (!publishAt) throw badRequest('Choisissez la date et l’heure de publication programmée.');
    if (new Date(publishAt) <= new Date()) throw badRequest('La date programmée doit être dans le futur.');
  }
  const categoryId = intId(req.body.category_id, { required: false });
  if (categoryId) {
    const cat = await one('SELECT id FROM categories WHERE id = $1', [categoryId]);
    if (!cat) throw badRequest('Catégorie invalide.');
  }
  const priority = oneOf(req.body.priority || 'normale', ['normale', 'haute', 'urgente'], { field: 'Priorité' });
  const pinned = bool(req.body.pinned, false) && hasPermission(req.user, 'publications.audience_all');
  const audiences = await validateAudiences(req, parseAudiences(req.body.audiences));

  const result = await tx(async (t) => {
    const pub = await t.one(
      `INSERT INTO publications (title, body, category_id, priority, status, publish_at, pinned, created_by, updated_by)
       VALUES ($1,$2,$3,$4,'draft',$5,$6,$7,$7) RETURNING id`,
      [title, body, categoryId, priority, publishAt, pinned, req.user.id]
    );
    await saveAudiences(t, pub.id, audiences);
    await syncFiles(t, pub.id, files, req.user);
    if (status === 'scheduled') {
      await t.query("UPDATE publications SET status='scheduled', publish_at=$2 WHERE id=$1", [pub.id, publishAt]);
    }
    return pub.id;
  });

  let notified = 0;
  if (status === 'published') {
    const out = await publishPublication(result, req.user.id);
    notified = out.notified;
  }
  await audit(req, 'publication.create', 'publication', result, { status, audiences: audiences.length });
  res.status(201).json({
    message:
      status === 'published'
        ? `Publication diffusée. ${notified} notification(s) créée(s).`
        : status === 'scheduled'
          ? 'Publication programmée. Les destinataires seront notifiés à la date prévue.'
          : 'Brouillon enregistré.',
    id: result,
    notified,
  });
}));

router.put('/publications/:id', requireAuth, requireCsrf, requirePermission('publications.create'), ah(async (req, res) => {
  const id = intId(req.params.id);
  const pub = await one('SELECT * FROM publications WHERE id = $1', [id]);
  if (!pub) throw notFound('Publication introuvable.');
  if (pub.created_by !== req.user.id && !hasPermission(req.user, 'publications.manage_all')) throw forbidden();
  if (pub.status === 'archived') throw badRequest('Cette publication est archivée. Créez une nouvelle publication.');
  const title = str(req.body.title ?? pub.title, { required: true, min: 3, max: 200, field: 'Le titre' });
  const body = str(req.body.body ?? pub.body, { max: 30000, field: 'Le texte' });
  const categoryId = req.body.category_id === undefined ? pub.category_id : intId(req.body.category_id, { required: false });
  const priority = oneOf(req.body.priority ?? pub.priority, ['normale', 'haute', 'urgente'], { field: 'Priorité' });
  const pinned = req.body.pinned === undefined ? pub.pinned : bool(req.body.pinned, pub.pinned) && hasPermission(req.user, 'publications.audience_all');
  let status = pub.status;
  if (req.body.status) status = oneOf(req.body.status, ['draft', 'published', 'scheduled'], { field: 'Statut' });
  let publishAt = req.body.publish_at === undefined ? pub.publish_at : isoDate(req.body.publish_at);
  if (status === 'scheduled') {
    if (!publishAt) throw badRequest('Choisissez la date et l’heure de publication programmée.');
    if (new Date(publishAt) <= new Date()) throw badRequest('La date programmée doit être dans le futur.');
  }
  let audiences = null;
  if (req.body.audiences !== undefined) {
    audiences = await validateAudiences(req, parseAudiences(req.body.audiences));
  }
  await tx(async (t) => {
    await t.query(
      `UPDATE publications SET title=$1, body=$2, category_id=$3, priority=$4, pinned=$5, publish_at=$6, updated_by=$7, updated_at=now() WHERE id=$8`,
      [title, body, categoryId, priority, pinned, publishAt, req.user.id, id]
    );
    if (audiences) await saveAudiences(t, id, audiences);
    if (req.body.file_ids !== undefined) await syncFiles(t, id, req.body.file_ids, req.user);
    if (status !== 'published') {
      await t.query('UPDATE publications SET status = $1 WHERE id = $2', [status, id]);
    }
  });
  let notified = 0;
  if (status === 'published' && pub.status !== 'published') {
    const out = await publishPublication(id, req.user.id);
    notified = out.notified;
  }
  await audit(req, 'publication.update', 'publication', id, { status, notified });
  res.json({ message: 'Publication mise à jour.', notified });
}));

router.post('/publications/:id/publish', requireAuth, requireCsrf, requirePermission('publications.create'), ah(async (req, res) => {
  const id = intId(req.params.id);
  const pub = await one('SELECT * FROM publications WHERE id = $1', [id]);
  if (!pub) throw notFound('Publication introuvable.');
  if (pub.created_by !== req.user.id && !hasPermission(req.user, 'publications.manage_all')) throw forbidden();
  const out = await publishPublication(id, req.user.id);
  if (!out.published) throw badRequest('Cette publication est déjà diffusée ou archivée.');
  await audit(req, 'publication.publish', 'publication', id, { notified: out.notified });
  res.json({ message: `Publication diffusée. ${out.notified} notification(s) créée(s).` });
}));

router.post('/publications/:id/archive', requireAuth, requireCsrf, requirePermission('publications.create'), ah(async (req, res) => {
  const id = intId(req.params.id);
  const pub = await one('SELECT * FROM publications WHERE id = $1', [id]);
  if (!pub) throw notFound('Publication introuvable.');
  if (pub.created_by !== req.user.id && !hasPermission(req.user, 'publications.manage_all')) throw forbidden();
  await query("UPDATE publications SET status='archived', updated_at=now() WHERE id=$1", [id]);
  await audit(req, 'publication.archive', 'publication', id, {});
  res.json({ message: 'Publication archivée.' });
}));

router.delete('/publications/:id', requireAuth, requireCsrf, requirePermission('publications.create'), ah(async (req, res) => {
  const id = intId(req.params.id);
  const pub = await one('SELECT * FROM publications WHERE id = $1', [id]);
  if (!pub) throw notFound('Publication introuvable.');
  const manager = hasPermission(req.user, 'publications.manage_all');
  if (!manager && pub.created_by !== req.user.id) throw forbidden();
  if (pub.status === 'published' && !manager) {
    throw badRequest('Une publication diffusée ne peut pas être supprimée par son auteur : archivez-la. Le chef de département peut la supprimer.');
  }
  await query('DELETE FROM publications WHERE id = $1', [id]);
  await audit(req, 'publication.delete', 'publication', id, { title: pub.title });
  res.json({ message: 'Publication supprimée.' });
}));

router.post('/publications/:id/view', requireAuth, requireCsrf, ah(async (req, res) => {
  const id = intId(req.params.id);
  const access = await canReadPublication(req.user, id);
  if (!access.ok) throw notFound('Publication introuvable ou non accessible.');
  await tx(async (t) => {
    await t.query(
      `INSERT INTO publication_views (publication_id, user_id) VALUES ($1,$2)
       ON CONFLICT (publication_id, user_id)
       DO UPDATE SET last_viewed_at = now(), view_count = publication_views.view_count + 1`,
      [id, req.user.id]
    );
    await t.query(
      'UPDATE notifications SET opened_at = now(), read_at = COALESCE(read_at, now()) WHERE user_id = $1 AND publication_id = $2',
      [req.user.id, id]
    );
  });
  const row = await one('SELECT COUNT(*)::int AS n FROM publication_views WHERE publication_id = $1', [id]);
  res.json({ views: row.n });
}));

router.get('/publications/:id/viewers', requireAuth, ah(async (req, res) => {
  const id = intId(req.params.id);
  const pub = await one('SELECT * FROM publications WHERE id = $1', [id]);
  if (!pub) throw notFound('Publication introuvable.');
  if (pub.created_by !== req.user.id && !hasPermission(req.user, 'publications.manage_all') && !hasPermission(req.user, 'stats.view')) {
    throw forbidden("Vous n'êtes pas autorisé à consulter la liste nominative des lecteurs.");
  }
  const rows = await query(
    `SELECT v.first_viewed_at, v.last_viewed_at, v.view_count, u.full_name, u.phone, r.name AS role_name, l.name AS level_name
     FROM publication_views v JOIN users u ON u.id = v.user_id
     JOIN roles r ON r.id = u.role_id LEFT JOIN levels l ON l.id = u.level_id
     WHERE v.publication_id = $1 ORDER BY v.first_viewed_at`,
    [id]
  );
  res.json({ viewers: rows, total: rows.length });
}));

export default router;
