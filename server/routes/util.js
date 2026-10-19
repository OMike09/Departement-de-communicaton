import { query, one } from '../db.js';
import { hasPermission } from '../permissions.js';
import { forbidden, badRequest } from '../errors.js';

export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function publicUser(u) {
  return {
    id: u.id,
    phone: u.phone,
    full_name: u.full_name,
    email: u.email,
    matricule: u.matricule,
    role_id: u.role_id,
    role_slug: u.role_slug,
    role_name: u.role_name,
    permissions: u.permissions,
    level_id: u.level_id,
    parcours_id: u.parcours_id,
    group_name: u.group_name,
    status: u.status,
    must_change_pw: u.must_change_pw,
    created_at: u.created_at,
    last_login_at: u.last_login_at,
    sound_pref: u.sound_pref,
    vibration: u.vibration,
    text_scale: u.text_scale === undefined ? undefined : Number(u.text_scale),
  };
}

/** Normalise et valide une liste d'audiences envoyée par le client. */
export function parseAudiences(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const kind = String(item.kind || '');
    if (!['public', 'all', 'role', 'level', 'parcours', 'group'].includes(kind)) continue;
    let targetText = item.target_text === undefined || item.target_text === null ? '' : String(item.target_text).trim();
    let targetId = item.target_id ? Number(item.target_id) : null;
    if (kind === 'level' || kind === 'parcours') {
      if (!targetId) continue;
      targetText = String(targetId);
    }
    if (kind === 'role') {
      const slug = targetText || (targetId ? '' : '');
      if (!slug) continue;
      targetText = slug;
    }
    if (kind === 'group' && !targetText && !targetId) continue;
    const key = `${kind}:${targetText}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind, target_text: targetText, target_id: targetId });
  }
  return out;
}

export async function userScopeList(userId) {
  const rows = await query('SELECT scope_type, scope_id FROM user_scopes WHERE user_id = $1', [userId]);
  return rows.map((r) => ({ type: r.scope_type, id: Number(r.scope_id) }));
}

export async function audienceLabel(audiences) {
  const labels = [];
  for (const a of audiences) {
    if (a.kind === 'public') labels.push('Public');
    else if (a.kind === 'all') labels.push('Tous les utilisateurs');
    else if (a.kind === 'role') labels.push(`Rôle : ${a.target_text}`);
    else if (a.kind === 'level') {
      const l = await query('SELECT name FROM levels WHERE id = $1', [Number(a.target_text)]);
      labels.push(`Niveau : ${l[0]?.name || a.target_text}`);
    } else if (a.kind === 'parcours') {
      const p = await query('SELECT name FROM parcours WHERE id = $1', [Number(a.target_text)]);
      labels.push(`Parcours : ${p[0]?.name || a.target_text}`);
    } else if (a.kind === 'group') labels.push(`Groupe : ${a.target_text}`);
  }
  return labels;
}

export function csvEscape(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Vérifie qu'un responsable agit bien dans son périmètre (niveau, parcours, groupe).
 * Le chef de département (ou tout rôle disposant de la permission globale) n'est pas limité.
 * Un responsable doit préciser au moins une cible et chacune doit figurer dans ses périmètres.
 */
export async function assertScopeFor(user, { levelId = null, parcoursId = null, groupName = '' } = {}) {
  if (!user) throw forbidden();
  if (hasPermission(user, '*')) return;
  const scopes = await userScopeList(user.id);
  const hasLevel = (id) => scopes.some((s) => s.type === 'level' && s.id === Number(id));
  const hasParcours = (id) => scopes.some((s) => s.type === 'parcours' && s.id === Number(id));
  const hasGroup = (id) => scopes.some((s) => s.type === 'group' && s.id === Number(id));
  let targeted = false;
  if (levelId) {
    targeted = true;
    if (!hasLevel(levelId)) throw forbidden('Ce niveau ne relève pas de votre périmètre.');
  }
  if (parcoursId) {
    targeted = true;
    if (!hasParcours(parcoursId)) throw forbidden('Ce parcours ne relève pas de votre périmètre.');
  }
  if (groupName) {
    const group = await one('SELECT id FROM groups WHERE name = $1 AND active = TRUE', [groupName]);
    if (!group) throw badRequest('Groupe introuvable.');
    targeted = true;
    if (!hasGroup(group.id)) throw forbidden('Ce groupe ne relève pas de votre périmètre.');
  }
  if (!targeted) {
    throw forbidden(
      'Précisez un niveau, un parcours ou un groupe de votre périmètre : seul le chef de département peut publier pour tout le département.'
    );
  }
}
