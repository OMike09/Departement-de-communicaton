import express from 'express';
import { query, one, dbMode } from '../db.js';
import { requireAuth, requireCsrf, requirePermission } from '../auth.js';
import { audit } from '../audit.js';
import { ah } from './util.js';
import { str, intId, pagination, email as vemail, bool } from '../validation.js';
import { badRequest, notFound } from '../errors.js';
import { getSettings, setSetting, publicSettings } from '../settings.js';
import { hasPermission } from '../permissions.js';
import { driverFor } from '../services/storage.js';
import { config } from '../config.js';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.js';
import crypto from 'node:crypto';

const router = express.Router();

router.get('/admin/settings', requireAuth, requirePermission('settings.manage'), ah(async (req, res) => {
  const settings = await getSettings();
  res.json({ settings });
}));

const MODULE_KEYS = ['activities', 'documents', 'timetables', 'results', 'requests', 'messages', 'notifications_sound'];
const NOTIFICATION_TYPES = ['publication', 'result', 'timetable', 'request', 'message'];
const ACTIVITY_CATEGORIES = [
  'recherche', 'publication_scientifique', 'conference', 'seminaire', 'atelier',
  'soutenance', 'partenariat', 'association', 'stage', 'opportunite', 'autre',
];

router.put('/admin/settings', requireAuth, requireCsrf, requirePermission('settings.manage'), ah(async (req, res) => {
  const updates = {};
  const s = req.body || {};
  const textKeys = ['app_name', 'app_short', 'institution', 'contact_phone', 'contact_address', 'contact_hours', 'academic_year', 'signup_help', 'footer_note', 'source_pdf_note'];
  for (const key of textKeys) {
    if (s[key] !== undefined) updates[key] = str(s[key], { max: key === 'source_pdf_note' ? 2000 : 500 });
  }
  if (s.presentation !== undefined) updates.presentation = str(s.presentation, { max: 5000 });
  if (s.presentation_extra !== undefined) updates.presentation_extra = str(s.presentation_extra, { max: 10000 });
  if (s.contact_email !== undefined) updates.contact_email = vemail(s.contact_email);
  for (const key of ['require_approval', 'registration_open', 'demo_mode']) {
    if (s[key] !== undefined) updates[key] = bool(s[key], false) ? '1' : '0';
  }
  if (s.default_signup_role !== undefined) {
    const role = await one('SELECT slug FROM roles WHERE slug = $1', [String(s.default_signup_role)]);
    if (!role) throw badRequest('Rôle par défaut invalide.');
    if (role.slug === 'chef') throw badRequest('Le rôle de chef ne peut pas être attribué automatiquement.');
    updates.default_signup_role = role.slug;
  }
  if (s.text_scale_min !== undefined || s.text_scale_max !== undefined) {
    const current = await getSettings();
    const min = Math.min(1.4, Math.max(0.8, Number(s.text_scale_min ?? current.text_scale_min) || 0.9));
    const max = Math.min(1.6, Math.max(1.0, Number(s.text_scale_max ?? current.text_scale_max) || 1.4));
    if (min > max) throw badRequest('La taille minimale ne peut pas dépasser la taille maximale.');
    updates.text_scale_min = String(min);
    updates.text_scale_max = String(max);
  }
  if (s.max_upload_mb !== undefined) {
    const mb = Math.min(50, Math.max(1, Number(s.max_upload_mb) || 8));
    updates.max_upload_mb = String(mb);
  }
  if (s.notification_types !== undefined) {
    const input = s.notification_types;
    if (!input || typeof input !== 'object') throw badRequest('Configuration des notifications invalide.');
    const clean = {};
    for (const key of NOTIFICATION_TYPES) clean[key] = input[key] !== false;
    updates.notification_types = JSON.stringify(clean);
  }
  if (s.activity_categories !== undefined) {
    const input = s.activity_categories;
    if (!input || typeof input !== 'object') throw badRequest('Configuration des rubriques invalide.');
    const clean = {};
    for (const key of ACTIVITY_CATEGORIES) clean[key] = input[key] !== false;
    updates.activity_categories = JSON.stringify(clean);
  }
  if (s.data_retention_days !== undefined) {
    const days = Math.min(3650, Math.max(0, Math.round(Number(s.data_retention_days) || 0)));
    updates.data_retention_days = String(days);
  }
  if (s.modules !== undefined) {
    let modules;
    try {
      modules = typeof s.modules === 'string' ? JSON.parse(s.modules) : s.modules;
    } catch {
      throw badRequest('Configuration des rubriques invalide.');
    }
    if (!modules || typeof modules !== 'object') throw badRequest('Configuration des rubriques invalide.');
    const clean = {};
    for (const key of MODULE_KEYS) clean[key] = modules[key] !== false;
    updates.modules = JSON.stringify(clean);
  }
  if (s.logo_file_id !== undefined) {
    if (s.logo_file_id === '' || s.logo_file_id === null) updates.logo_file_id = '';
    else {
      const fileId = intId(s.logo_file_id);
      const file = await one('SELECT id, mime FROM files WHERE id = $1', [fileId]);
      if (!file) throw badRequest('Logo introuvable.');
      if (!/^image\//.test(file.mime)) throw badRequest('Le logo doit être une image (PNG, JPG ou WEBP).');
      updates.logo_file_id = String(fileId);
    }
  }
  if (!Object.keys(updates).length) throw badRequest('Aucune modification à enregistrer.');
  for (const [key, value] of Object.entries(updates)) await setSetting(key, value);
  await audit(req, 'settings.update', 'settings', null, { keys: Object.keys(updates) });
  res.json({ message: 'Paramètres enregistrés. Les modifications sont immédiatement visibles.', settings: await getSettings() });
}));

/* ------------------------------- Catégories ------------------------------ */
function slugifyCategory(name) {
  const base = String(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || 'categorie';
}

router.get('/admin/categories', requireAuth, requirePermission('categories.manage'), ah(async (req, res) => {
  const categories = await query(
    `SELECT c.*,
            (SELECT COUNT(*)::int FROM publications p WHERE p.category_id = c.id) AS publication_count
     FROM categories c ORDER BY c.sort_order, c.name`
  );
  res.json({ categories });
}));

router.post('/admin/categories', requireAuth, requireCsrf, requirePermission('categories.manage'), ah(async (req, res) => {
  const name = str(req.body.name, { required: true, min: 2, max: 80, field: 'Le nom de la catégorie' });
  const color = /^#[0-9a-f]{3,8}$/i.test(String(req.body.color || '')) ? String(req.body.color) : '#1f4e79';
  const sortOrder = Math.max(0, Math.min(9999, Number.parseInt(req.body.sort_order, 10) || 0));
  const existing = await one('SELECT id FROM categories WHERE lower(name) = lower($1)', [name]);
  if (existing) throw badRequest('Une catégorie porte déjà ce nom.');
  let slug = slugifyCategory(name);
  let suffix = 2;
  while (await one('SELECT id FROM categories WHERE slug = $1', [slug])) {
    slug = `${slugifyCategory(name).slice(0, 55)}-${suffix}`;
    suffix += 1;
  }
  const row = await one(
    'INSERT INTO categories (name, slug, color, sort_order, active) VALUES ($1,$2,$3,$4,TRUE) RETURNING *',
    [name, slug, color, sortOrder]
  );
  await audit(req, 'category.create', 'category', row.id, { name });
  res.status(201).json({ message: 'Catégorie créée.', category: row });
}));

router.put('/admin/categories/:id', requireAuth, requireCsrf, requirePermission('categories.manage'), ah(async (req, res) => {
  const id = intId(req.params.id);
  const existing = await one('SELECT * FROM categories WHERE id = $1', [id]);
  if (!existing) throw notFound('Catégorie introuvable.');
  const name = str(req.body.name ?? existing.name, { required: true, min: 2, max: 80, field: 'Le nom de la catégorie' });
  const duplicate = await one('SELECT id FROM categories WHERE lower(name) = lower($1) AND id <> $2', [name, id]);
  if (duplicate) throw badRequest('Une catégorie porte déjà ce nom.');
  const color = req.body.color === undefined
    ? existing.color
    : /^#[0-9a-f]{3,8}$/i.test(String(req.body.color)) ? String(req.body.color) : existing.color;
  const sortOrder = req.body.sort_order === undefined ? existing.sort_order : Math.max(0, Math.min(9999, Number.parseInt(req.body.sort_order, 10) || 0));
  const active = req.body.active === undefined ? existing.active : bool(req.body.active, existing.active);
  const row = await one(
    'UPDATE categories SET name=$1, color=$2, sort_order=$3, active=$4 WHERE id=$5 RETURNING *',
    [name, color, sortOrder, active, id]
  );
  await audit(req, 'category.update', 'category', id, { name, active });
  res.json({ message: 'Catégorie mise à jour.', category: row });
}));

router.delete('/admin/categories/:id', requireAuth, requireCsrf, requirePermission('categories.manage'), ah(async (req, res) => {
  const id = intId(req.params.id);
  const existing = await one('SELECT * FROM categories WHERE id = $1', [id]);
  if (!existing) throw notFound('Catégorie introuvable.');
  const used = await one('SELECT COUNT(*)::int AS n FROM publications WHERE category_id = $1', [id]);
  if (used.n > 0) {
    await query('UPDATE categories SET active = FALSE WHERE id = $1', [id]);
    await audit(req, 'category.archive', 'category', id, { publications: used.n });
    return res.json({
      message: `Cette catégorie est utilisée par ${used.n} publication(s) : elle a été archivée (les publications existantes sont conservées).`,
      archived: true,
    });
  }
  await query('DELETE FROM categories WHERE id = $1', [id]);
  await audit(req, 'category.delete', 'category', id, {});
  res.json({ message: 'Catégorie supprimée.', archived: false });
}));

router.get('/admin/audit', requireAuth, requirePermission('audit.view'), ah(async (req, res) => {
  const { page, limit, offset } = pagination(req.query, 40);
  const params = [];
  const where = [];
  if (req.query.action) {
    params.push(`%${String(req.query.action).slice(0, 60)}%`);
    where.push(`a.action ILIKE $${params.length}`);
  }
  if (req.query.actor) {
    params.push(intId(req.query.actor));
    where.push(`a.actor_id = $${params.length}`);
  }
  if (req.query.entity) {
    params.push(String(req.query.entity).slice(0, 40));
    where.push(`a.entity_type = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const count = await one(`SELECT COUNT(*)::int AS n FROM audit_logs a ${whereSql}`, params);
  const rows = await query(
    `SELECT a.*, u.full_name AS actor_name, r.name AS actor_role
     FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id LEFT JOIN roles r ON r.id = u.role_id
     ${whereSql} ORDER BY a.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  res.json({ logs: rows, total: count.n, page, limit });
}));

const BACKUP_TABLES = [
  'roles', 'levels', 'parcours', 'parcours_levels', 'groups', 'users', 'user_scopes',
  'categories', 'publications', 'publication_audiences', 'publication_views',
  'files', 'documents', 'publication_files', 'timetables', 'schedule_events',
  'results', 'result_views', 'result_history', 'requests', 'request_events',
  'threads', 'thread_participants', 'messages', 'activities', 'notifications', 'settings',
];

router.get('/admin/backup', requireAuth, requirePermission('backups.manage'), ah(async (req, res) => {
  const data = {};
  for (const table of BACKUP_TABLES) {
    const rows = await query(`SELECT * FROM ${table}`);
    if (table === 'files') {
      data[table] = rows.map((r) => ({ ...r, data: r.data ? '<binaire exclu du JSON — voir documentation>' : null }));
    } else if (table === 'users') {
      data[table] = rows.map(({ password_hash, ...rest }) => ({
        ...rest,
        password_hash: '<exclu de l’export — mot de passe à réinitialiser après restauration>',
      }));
    } else {
      data[table] = rows;
    }
  }
  const payload = {
    application: 'Département de Communication — Université de Bouaké',
    generated_at: new Date().toISOString(),
    database: dbMode(),
    note: "Export logique des données. Les fichiers binaires et les empreintes de mots de passe ne sont pas inclus : utilisez pg_dump pour une sauvegarde complète (voir docs/EXPLOITATION.md).",
    tables: data,
  };
  await audit(req, 'backup.export', 'backup', null, { tables: BACKUP_TABLES.length });
  const json = JSON.stringify(payload, null, 2);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="sauvegarde-departement-communication-${new Date().toISOString().slice(0, 10)}.json"`);
  res.send(json);
}));

router.get('/admin/health', requireAuth, ah(async (req, res) => {
  if (!hasPermission(req.user, 'settings.manage') && req.user.role_slug !== 'chef') {
    return res.status(403).json({ error: "Accès réservé à la direction." });
  }
  const counts = await one(
    `SELECT (SELECT COUNT(*)::int FROM users) AS users,
            (SELECT COUNT(*)::int FROM publications) AS publications,
            (SELECT COUNT(*)::int FROM documents) AS documents,
            (SELECT COUNT(*)::int FROM files) AS files,
            (SELECT COUNT(*)::int FROM notifications) AS notifications`
  );
  let disk = null;
  try {
    const stat = fs.statfsSync ? fs.statfsSync(path.join(ROOT, 'storage')) : null;
    if (stat) disk = { free_bytes: stat.bavail * stat.bsize, total_bytes: stat.blocks * stat.bsize };
  } catch {}
  res.json({
    status: 'ok',
    version: await appVersion(),
    database: dbMode(),
    storage: driverFor(),
    uptime_seconds: Math.round(process.uptime()),
    memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    counts,
    disk,
  });
}));

export async function appVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    return pkg.version || '1.0.0';
  } catch {
    return '1.0.0';
  }
}

export default router;
