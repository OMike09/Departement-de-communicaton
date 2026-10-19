import express from 'express';
import { query, one } from '../db.js';
import { requireAuth, requirePermission, requireCsrf } from '../auth.js';
import { audit } from '../audit.js';
import { ah } from './util.js';
import { str, intId, bool, oneOf } from '../validation.js';
import { badRequest, notFound } from '../errors.js';

const router = express.Router();

async function buildStructure(includeInactive = false) {
  const levels = await query(
    `SELECT id, name, code, description, order_index, active, source
     FROM levels ${includeInactive ? '' : 'WHERE active = TRUE'} ORDER BY order_index, name`
  );
  const parcours = await query(
    `SELECT id, name, code, description, parent_id, order_index, active, source
     FROM parcours ${includeInactive ? '' : 'WHERE active = TRUE'} ORDER BY order_index, name`
  );
  const links = await query('SELECT parcours_id, level_id FROM parcours_levels');
  const groups = await query(
    `SELECT id, name, level_id, parcours_id, academic_year, active
     FROM groups ${includeInactive ? '' : 'WHERE active = TRUE'} ORDER BY name`
  );
  return {
    levels,
    parcours: parcours.map((p) => ({
      ...p,
      level_ids: links.filter((l) => l.parcours_id === p.id).map((l) => l.level_id),
    })),
    groups,
  };
}

router.get('/structure', ah(async (req, res) => {
  res.json(await buildStructure(false));
}));

/* ------------------------------ Niveaux ------------------------------ */
router.post('/admin/levels', requireAuth, requireCsrf, requirePermission('structure.manage'), ah(async (req, res) => {
  const name = str(req.body.name, { required: true, min: 1, max: 120, field: 'Le nom du niveau' });
  const code = str(req.body.code, { max: 40 });
  const description = str(req.body.description, { max: 1000 });
  const order = Number.parseInt(req.body.order_index ?? '0', 10) || 0;
  const row = await one(
    'INSERT INTO levels (name, code, description, order_index, source) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [name, code, description, order, 'administration']
  );
  await audit(req, 'structure.level.create', 'level', row.id, { name });
  res.status(201).json({ message: 'Niveau créé.', level: row });
}));

router.put('/admin/levels/:id', requireAuth, requireCsrf, requirePermission('structure.manage'), ah(async (req, res) => {
  const id = intId(req.params.id);
  const existing = await one('SELECT * FROM levels WHERE id = $1', [id]);
  if (!existing) throw notFound('Niveau introuvable.');
  const name = str(req.body.name ?? existing.name, { required: true, max: 120, field: 'Le nom du niveau' });
  const code = str(req.body.code ?? existing.code, { max: 40 });
  const description = str(req.body.description ?? existing.description, { max: 1000 });
  const order = Number.parseInt(req.body.order_index ?? existing.order_index, 10) || 0;
  const active = bool(req.body.active, existing.active);
  const row = await one(
    'UPDATE levels SET name=$1, code=$2, description=$3, order_index=$4, active=$5 WHERE id=$6 RETURNING *',
    [name, code, description, order, active, id]
  );
  await audit(req, 'structure.level.update', 'level', id, { name, active });
  res.json({ message: 'Niveau mis à jour.', level: row });
}));

router.delete('/admin/levels/:id', requireAuth, requireCsrf, requirePermission('structure.manage'), ah(async (req, res) => {
  const id = intId(req.params.id);
  const existing = await one('SELECT * FROM levels WHERE id = $1', [id]);
  if (!existing) throw notFound('Niveau introuvable.');
  const used = await one(
    `SELECT
       (SELECT COUNT(*)::int FROM users WHERE level_id=$1) +
       (SELECT COUNT(*)::int FROM documents WHERE level_id=$1) +
       (SELECT COUNT(*)::int FROM timetables WHERE level_id=$1) +
       (SELECT COUNT(*)::int FROM results WHERE level_id=$1) +
       (SELECT COUNT(*)::int FROM groups WHERE level_id=$1) +
       (SELECT COUNT(*)::int FROM publication_audiences WHERE kind='level' AND target_text=$1::text) AS n`,
    [id]
  );
  if (used.n > 0) {
    await query('UPDATE levels SET active = FALSE WHERE id = $1', [id]);
    await audit(req, 'structure.level.archive', 'level', id, { used: used.n });
    return res.json({
      message: 'Ce niveau est utilisé par des données existantes : il a été archivé (historique conservé) au lieu d’être supprimé.',
      archived: true,
    });
  }
  await query('DELETE FROM levels WHERE id = $1', [id]);
  await audit(req, 'structure.level.delete', 'level', id, { name: existing.name });
  res.json({ message: 'Niveau supprimé.', archived: false });
}));

/* ------------------------------ Parcours ------------------------------ */
router.post('/admin/parcours', requireAuth, requireCsrf, requirePermission('structure.manage'), ah(async (req, res) => {
  const name = str(req.body.name, { required: true, max: 160, field: 'Le nom du parcours' });
  const code = str(req.body.code, { max: 40 });
  const description = str(req.body.description, { max: 2000 });
  const parentId = intId(req.body.parent_id, { required: false });
  const order = Number.parseInt(req.body.order_index ?? '0', 10) || 0;
  if (parentId) {
    const parent = await one('SELECT id FROM parcours WHERE id = $1', [parentId]);
    if (!parent) throw badRequest('Parcours parent introuvable.');
  }
  const row = await one(
    'INSERT INTO parcours (name, code, description, parent_id, order_index, source) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [name, code, description, parentId, order, 'administration']
  );
  const levelIds = [];
  for (const levelId of Array.isArray(req.body.level_ids) ? req.body.level_ids.map(Number).filter(Number.isFinite) : []) {
    const level = await one('SELECT id FROM levels WHERE id = $1', [levelId]);
    if (!level) throw badRequest('Un niveau associé est invalide.');
    levelIds.push(levelId);
    await query('INSERT INTO parcours_levels (parcours_id, level_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [row.id, levelId]);
  }
  await audit(req, 'structure.parcours.create', 'parcours', row.id, { name });
  res.status(201).json({ message: 'Parcours créé.', parcours: row });
}));

router.put('/admin/parcours/:id', requireAuth, requireCsrf, requirePermission('structure.manage'), ah(async (req, res) => {
  const id = intId(req.params.id);
  const existing = await one('SELECT * FROM parcours WHERE id = $1', [id]);
  if (!existing) throw notFound('Parcours introuvable.');
  const name = str(req.body.name ?? existing.name, { required: true, max: 160, field: 'Le nom du parcours' });
  const code = str(req.body.code ?? existing.code, { max: 40 });
  const description = str(req.body.description ?? existing.description, { max: 2000 });
  const parentId = req.body.parent_id === undefined ? existing.parent_id : intId(req.body.parent_id, { required: false });
  if (parentId === id) throw badRequest('Un parcours ne peut pas être son propre parent.');
  const order = Number.parseInt(req.body.order_index ?? existing.order_index, 10) || 0;
  const active = bool(req.body.active, existing.active);
  const row = await one(
    'UPDATE parcours SET name=$1, code=$2, description=$3, parent_id=$4, order_index=$5, active=$6 WHERE id=$7 RETURNING *',
    [name, code, description, parentId, order, active, id]
  );
  if (Array.isArray(req.body.level_ids)) {
    const levelIds = [];
    for (const levelId of req.body.level_ids.map(Number).filter(Number.isFinite)) {
      const level = await one('SELECT id FROM levels WHERE id = $1', [levelId]);
      if (!level) throw badRequest('Un niveau associé est invalide.');
      levelIds.push(levelId);
    }
    await query('DELETE FROM parcours_levels WHERE parcours_id = $1', [id]);
    for (const levelId of levelIds) {
      await query('INSERT INTO parcours_levels (parcours_id, level_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, levelId]);
    }
  }
  await audit(req, 'structure.parcours.update', 'parcours', id, { name, active });
  res.json({ message: 'Parcours mis à jour.', parcours: row });
}));

router.delete('/admin/parcours/:id', requireAuth, requireCsrf, requirePermission('structure.manage'), ah(async (req, res) => {
  const id = intId(req.params.id);
  const existing = await one('SELECT * FROM parcours WHERE id = $1', [id]);
  if (!existing) throw notFound('Parcours introuvable.');
  const used = await one(
    `SELECT
       (SELECT COUNT(*)::int FROM users WHERE parcours_id=$1) +
       (SELECT COUNT(*)::int FROM documents WHERE parcours_id=$1) +
       (SELECT COUNT(*)::int FROM timetables WHERE parcours_id=$1) +
       (SELECT COUNT(*)::int FROM results WHERE parcours_id=$1) +
       (SELECT COUNT(*)::int FROM groups WHERE parcours_id=$1) +
       (SELECT COUNT(*)::int FROM parcours WHERE parent_id=$1) +
       (SELECT COUNT(*)::int FROM publication_audiences WHERE kind='parcours' AND target_text=$1::text) AS n`,
    [id]
  );
  if (used.n > 0) {
    await query('UPDATE parcours SET active = FALSE WHERE id = $1', [id]);
    await audit(req, 'structure.parcours.archive', 'parcours', id, { used: used.n });
    return res.json({
      message: 'Ce parcours est utilisé par des données existantes : il a été archivé (historique conservé) au lieu d’être supprimé.',
      archived: true,
    });
  }
  await query('DELETE FROM parcours WHERE id = $1', [id]);
  await audit(req, 'structure.parcours.delete', 'parcours', id, { name: existing.name });
  res.json({ message: 'Parcours supprimé.', archived: false });
}));

/* ------------------------------- Groupes ------------------------------- */
router.post('/admin/groups', requireAuth, requireCsrf, requirePermission('structure.manage'), ah(async (req, res) => {
  const name = str(req.body.name, { required: true, max: 120, field: 'Le nom du groupe' });
  const levelId = intId(req.body.level_id, { required: false });
  const parcoursId = intId(req.body.parcours_id, { required: false });
  const year = str(req.body.academic_year, { max: 30 });
  const row = await one(
    'INSERT INTO groups (name, level_id, parcours_id, academic_year) VALUES ($1,$2,$3,$4) RETURNING *',
    [name, levelId, parcoursId, year]
  );
  await audit(req, 'structure.group.create', 'group', row.id, { name });
  res.status(201).json({ message: 'Groupe créé.', group: row });
}));

router.put('/admin/groups/:id', requireAuth, requireCsrf, requirePermission('structure.manage'), ah(async (req, res) => {
  const id = intId(req.params.id);
  const existing = await one('SELECT * FROM groups WHERE id = $1', [id]);
  if (!existing) throw notFound('Groupe introuvable.');
  const name = str(req.body.name ?? existing.name, { required: true, max: 120, field: 'Le nom du groupe' });
  const levelId = req.body.level_id === undefined ? existing.level_id : intId(req.body.level_id, { required: false });
  const parcoursId = req.body.parcours_id === undefined ? existing.parcours_id : intId(req.body.parcours_id, { required: false });
  const year = str(req.body.academic_year ?? existing.academic_year, { max: 30 });
  const active = bool(req.body.active, existing.active);
  const row = await one(
    'UPDATE groups SET name=$1, level_id=$2, parcours_id=$3, academic_year=$4, active=$5 WHERE id=$6 RETURNING *',
    [name, levelId, parcoursId, year, active, id]
  );
  await audit(req, 'structure.group.update', 'group', id, { name });
  res.json({ message: 'Groupe mis à jour.', group: row });
}));

router.get('/admin/structure', requireAuth, requirePermission('structure.manage'), ah(async (req, res) => {
  res.json(await buildStructure(true));
}));

export default router;
