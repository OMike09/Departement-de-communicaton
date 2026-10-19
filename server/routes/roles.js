import express from 'express';
import { query, one } from '../db.js';
import { requireAuth, requireCsrf, requirePermission } from '../auth.js';
import { audit } from '../audit.js';
import { ah } from './util.js';
import { str, intId } from '../validation.js';
import { PERMISSION_GROUPS, ALL_PERMISSIONS, sanitizePermissions } from '../permissions.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';

const router = express.Router();

function slugify(name) {
  return String(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 50);
}

router.get('/roles-lite', requireAuth, ah(async (req, res) => {
  const chef = req.user.role_slug === 'chef';
  const roles = await query(
    `SELECT id, slug, name FROM roles ${chef ? '' : "WHERE slug <> 'chef'"} ORDER BY is_system DESC, name`
  );
  res.json({ roles });
}));

router.get('/admin/permissions', requireAuth, requirePermission('roles.manage'), ah(async (req, res) => {
  res.json({ groups: PERMISSION_GROUPS.map((g) => ({ label: g.label, items: g.items.map(([key, label]) => ({ key, label })) })) });
}));

router.get('/admin/roles', requireAuth, requirePermission('roles.manage'), ah(async (req, res) => {
  const roles = await query(
    `SELECT r.*, (SELECT COUNT(*)::int FROM users u WHERE u.role_id = r.id) AS user_count
     FROM roles r ORDER BY r.is_system DESC, r.name`
  );
  res.json({ roles });
}));

router.post('/admin/roles', requireAuth, requireCsrf, requirePermission('roles.manage'), ah(async (req, res) => {
  const name = str(req.body.name, { required: true, min: 2, max: 80, field: 'Le nom du rôle' });
  const description = str(req.body.description, { max: 500 });
  const permissions = sanitizePermissions(req.body.permissions);
  if (permissions.includes('*') && req.user.role_slug !== 'chef') {
    throw forbidden('Seul le chef de département peut créer un rôle administrateur complet.');
  }
  let slug = slugify(name);
  if (!slug) throw badRequest('Nom de rôle invalide.');
  if (await one('SELECT id FROM roles WHERE slug = $1', [slug])) slug = `${slug}-${Date.now().toString(36)}`;
  const row = await one(
    'INSERT INTO roles (slug, name, description, permissions, is_system) VALUES ($1,$2,$3,$4,FALSE) RETURNING *',
    [slug, name, description, JSON.stringify(permissions)]
  );
  await audit(req, 'role.create', 'role', row.id, { name, permissions });
  res.status(201).json({ message: 'Rôle créé.', role: row });
}));

router.put('/admin/roles/:id', requireAuth, requireCsrf, requirePermission('roles.manage'), ah(async (req, res) => {
  const id = intId(req.params.id);
  const role = await one('SELECT * FROM roles WHERE id = $1', [id]);
  if (!role) throw notFound('Rôle introuvable.');
  if (role.slug === 'chef') {
    throw forbidden('Le rôle de chef de département ne peut pas être modifié : il doit conserver le contrôle général de l’application.');
  }
  const name = str(req.body.name ?? role.name, { required: true, max: 80, field: 'Le nom du rôle' });
  const description = str(req.body.description ?? role.description, { max: 500 });
  let permissions = sanitizePermissions(req.body.permissions ?? role.permissions);
  if (permissions.includes('*') && req.user.role_slug !== 'chef') {
    throw forbidden('Seul le chef de département peut attribuer la permission administrateur complète.');
  }
  if (role.slug === 'chef' && !permissions.includes('*')) permissions = ['*'];
  await query('UPDATE roles SET name=$1, description=$2, permissions=$3 WHERE id=$4', [name, description, JSON.stringify(permissions), id]);
  await audit(req, 'role.update', 'role', id, { name, permissions });
  res.json({ message: 'Rôle mis à jour. Les utilisateurs concernés disposent immédiatement des nouvelles permissions.' });
}));

router.delete('/admin/roles/:id', requireAuth, requireCsrf, requirePermission('roles.manage'), ah(async (req, res) => {
  const id = intId(req.params.id);
  const role = await one('SELECT * FROM roles WHERE id = $1', [id]);
  if (!role) throw notFound('Rôle introuvable.');
  if (role.is_system) throw forbidden('Les rôles système ne peuvent pas être supprimés. Vous pouvez modifier leurs permissions.');
  const used = await one('SELECT COUNT(*)::int AS n FROM users WHERE role_id = $1', [id]);
  if (used.n > 0) throw conflict('Ce rôle est attribué à des comptes : réaffectez-les avant de le supprimer.');
  await query('DELETE FROM roles WHERE id = $1', [id]);
  await audit(req, 'role.delete', 'role', id, { name: role.name });
  res.json({ message: 'Rôle supprimé.' });
}));

export default router;
