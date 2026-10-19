import express from 'express';
import { query, one } from '../db.js';
import { requireAuth, requireCsrf, requirePermission } from '../auth.js';
import { hasPermission } from '../permissions.js';
import { audit } from '../audit.js';
import { ah, userScopeList } from './util.js';
import { str, intId, oneOf, pagination, bool } from '../validation.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { canReadDocument } from '../services/access.js';
import { getSettings, moduleEnabled } from '../settings.js';

const router = express.Router();

const DOC_SELECT = `
  SELECT d.*, f.filename, f.mime, f.size, u.full_name AS uploader_name,
         l.name AS level_name, p.name AS parcours_name
  FROM documents d
  JOIN files f ON f.id = d.file_id
  JOIN users u ON u.id = d.uploaded_by
  LEFT JOIN levels l ON l.id = d.level_id
  LEFT JOIN parcours p ON p.id = d.parcours_id`;

router.get('/public/documents', ah(async (req, res) => {
  const settings = await getSettings();
  if (!moduleEnabled(settings, 'documents')) return res.json({ documents: [] });
  const rows = await query(
    `SELECT d.id, d.title, d.description, d.category, d.created_at,
            f.id AS file_id, f.filename, f.mime, f.size, u.full_name AS uploader_name
     FROM documents d
     JOIN files f ON f.id = d.file_id
     LEFT JOIN users u ON u.id = d.uploaded_by
     WHERE d.archived = FALSE AND d.visibility = 'public'
     ORDER BY d.created_at DESC LIMIT 8`
  );
  res.json({ documents: rows });
}));

router.get('/documents', requireAuth, ah(async (req, res) => {
  const { page, limit, offset } = pagination(req.query, 24);
  const manager = hasPermission(req.user, 'documents.manage');
  const params = [];
  const where = [];
  if (!manager) {
    params.push(req.user.role_slug, req.user.level_id, req.user.parcours_id);
    where.push(`d.archived = FALSE AND (
      d.visibility IN ('public','all')
      OR (d.visibility = 'etudiant' AND $1 = 'etudiant')
      OR (d.visibility = 'enseignant' AND $1 <> 'etudiant')
      OR (d.visibility = 'personnel' AND $1 <> 'etudiant')
      OR (d.visibility = 'level' AND d.level_id = $2)
      OR (d.visibility = 'parcours' AND d.parcours_id = $3)
    )`);
  } else if (req.query.archived !== '1') {
    where.push('d.archived = FALSE');
  }
  if (req.query.category) {
    params.push(str(req.query.category, { max: 80 }));
    where.push(`d.category = $${params.length}`);
  }
  if (req.query.level) {
    params.push(intId(req.query.level, { field: 'Niveau' }));
    where.push(`d.level_id = $${params.length}`);
  }
  if (req.query.parcours) {
    params.push(intId(req.query.parcours, { field: 'Parcours' }));
    where.push(`d.parcours_id = $${params.length}`);
  }
  if (req.query.mine === '1') {
    params.push(req.user.id);
    where.push(`d.uploaded_by = $${params.length}`);
  }
  if (req.query.q) {
    params.push(`%${String(req.query.q).trim().slice(0, 100)}%`);
    where.push(`(d.title ILIKE $${params.length} OR d.description ILIKE $${params.length} OR f.filename ILIKE $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const count = await one(`SELECT COUNT(*)::int AS n FROM documents d JOIN files f ON f.id=d.file_id ${whereSql}`, params);
  const rows = await query(
    `${DOC_SELECT} ${whereSql} ORDER BY d.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  const categories = await query('SELECT DISTINCT category FROM documents WHERE archived = FALSE ORDER BY category');
  res.json({ documents: rows, total: count.n, page, limit, categories: categories.map((c) => c.category) });
}));

router.get('/documents/:id', requireAuth, ah(async (req, res) => {
  const id = intId(req.params.id);
  const doc = await one(`${DOC_SELECT} WHERE d.id = $1`, [id]);
  if (!doc) throw notFound('Document introuvable.');
  if (!(await canReadDocument(req.user, doc))) throw notFound('Document introuvable ou non accessible.');
  res.json({ document: doc });
}));

async function validateScope(req, { visibility, levelId, parcoursId }) {
  if (hasPermission(req.user, 'documents.manage')) return;
  if (['public', 'all', 'etudiant', 'enseignant', 'personnel'].includes(visibility)) {
    throw forbidden(
      'Vous pouvez déposer un document pour un niveau ou un parcours de votre périmètre. Les documents publics ou destinés à tout le département sont réservés à la direction.'
    );
  }
  if (visibility === 'level' && levelId) {
    const scopes = await userScopeList(req.user.id);
    if (!scopes.some((s) => s.type === 'level' && s.id === levelId)) {
      throw forbidden("Ce niveau ne relève pas de votre périmètre.");
    }
  }
  if (visibility === 'parcours' && parcoursId) {
    const scopes = await userScopeList(req.user.id);
    if (!scopes.some((s) => s.type === 'parcours' && s.id === parcoursId)) {
      throw forbidden("Ce parcours ne relève pas de votre périmètre.");
    }
  }
  if ((visibility === 'level' || visibility === 'parcours') && !levelId && !parcoursId) {
    throw badRequest('Précisez le niveau ou le parcours concerné.');
  }
}

router.post('/documents', requireAuth, requireCsrf, requirePermission('documents.upload'), ah(async (req, res) => {
  const title = str(req.body.title, { required: true, min: 2, max: 200, field: 'Le titre du document' });
  const description = str(req.body.description, { max: 3000 });
  const category = str(req.body.category, { max: 80 }) || 'Document';
  const visibility = oneOf(req.body.visibility || 'all', ['public', 'all', 'etudiant', 'enseignant', 'personnel', 'level', 'parcours'], { field: 'Visibilité' });
  const levelId = intId(req.body.level_id, { required: false });
  const parcoursId = intId(req.body.parcours_id, { required: false });
  const fileId = intId(req.body.file_id, { field: 'Le fichier' });
  const file = await one('SELECT * FROM files WHERE id = $1', [fileId]);
  if (!file) throw badRequest('Fichier introuvable : recommencez le téléversement.');
  if (file.uploaded_by !== req.user.id && !hasPermission(req.user, 'documents.manage')) {
    throw forbidden('Ce fichier ne vous appartient pas.');
  }
  await validateScope(req, { visibility, levelId, parcoursId });
  const row = await one(
    `INSERT INTO documents (title, description, category, file_id, level_id, parcours_id, visibility, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [title, description, category, fileId, levelId, parcoursId, visibility, req.user.id]
  );
  await audit(req, 'document.create', 'document', row.id, { title, visibility });
  res.status(201).json({ message: 'Document ajouté à la bibliothèque.', id: row.id });
}));

router.put('/documents/:id', requireAuth, requireCsrf, requirePermission('documents.upload'), ah(async (req, res) => {
  const id = intId(req.params.id);
  const doc = await one('SELECT * FROM documents WHERE id = $1', [id]);
  if (!doc) throw notFound('Document introuvable.');
  if (doc.uploaded_by !== req.user.id && !hasPermission(req.user, 'documents.manage')) throw forbidden();
  const title = str(req.body.title ?? doc.title, { required: true, max: 200, field: 'Le titre du document' });
  const description = str(req.body.description ?? doc.description, { max: 3000 });
  const category = str(req.body.category ?? doc.category, { max: 80 });
  const visibility = oneOf(req.body.visibility ?? doc.visibility, ['public', 'all', 'etudiant', 'enseignant', 'personnel', 'level', 'parcours'], { field: 'Visibilité' });
  const levelId = req.body.level_id === undefined ? doc.level_id : intId(req.body.level_id, { required: false });
  const parcoursId = req.body.parcours_id === undefined ? doc.parcours_id : intId(req.body.parcours_id, { required: false });
  await validateScope(req, { visibility, levelId, parcoursId });
  await query(
    `UPDATE documents SET title=$1, description=$2, category=$3, visibility=$4, level_id=$5, parcours_id=$6, updated_at=now() WHERE id=$7`,
    [title, description, category, visibility, levelId, parcoursId, id]
  );
  await audit(req, 'document.update', 'document', id, { title, visibility });
  res.json({ message: 'Document mis à jour.' });
}));

router.post('/documents/:id/archive', requireAuth, requireCsrf, requirePermission('documents.upload'), ah(async (req, res) => {
  const id = intId(req.params.id);
  const doc = await one('SELECT * FROM documents WHERE id = $1', [id]);
  if (!doc) throw notFound('Document introuvable.');
  if (doc.uploaded_by !== req.user.id && !hasPermission(req.user, 'documents.manage')) throw forbidden();
  const archived = bool(req.body.archived, true);
  await query('UPDATE documents SET archived = $1, updated_at = now() WHERE id = $2', [archived, id]);
  await audit(req, archived ? 'document.archive' : 'document.restore', 'document', id, {});
  res.json({ message: archived ? 'Document archivé. Il n’est plus visible des utilisateurs.' : 'Document restauré.' });
}));

export default router;
