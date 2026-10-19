import { query, one } from '../db.js';
import { hasPermission } from '../permissions.js';

/** Un utilisateur peut-il voir cette publication (lecture) ? */
export async function canReadPublication(user, publicationId) {
  const pub = await one('SELECT * FROM publications WHERE id = $1', [publicationId]);
  if (!pub) return { ok: false, reason: 'not_found' };
  if (user && (pub.created_by === user.id || hasPermission(user, 'publications.manage_all'))) {
    return { ok: true, pub, staff: true };
  }
  if (pub.status !== 'published') return { ok: false, reason: 'not_found' };
  const audiences = await query('SELECT kind, target_text, target_id FROM publication_audiences WHERE publication_id = $1', [
    publicationId,
  ]);
  if (!user) {
    return audiences.some((a) => a.kind === 'public') ? { ok: true, pub, staff: false } : { ok: false, reason: 'forbidden' };
  }
  const ok = audiences.some((a) => {
    if (a.kind === 'public' || a.kind === 'all') return true;
    if (a.kind === 'role' && a.target_text === user.role_slug) return true;
    if (a.kind === 'level' && Number(a.target_text) === Number(user.level_id)) return true;
    if (a.kind === 'parcours' && Number(a.target_text) === Number(user.parcours_id)) return true;
    if (a.kind === 'group' && a.target_text && a.target_text === user.group_name) return true;
    return false;
  });
  return ok ? { ok: true, pub, staff: false } : { ok: false, reason: 'forbidden' };
}

export async function canReadDocument(user, doc) {
  if (!user) {
    return doc.visibility === 'public' && !doc.archived;
  }
  if (hasPermission(user, 'documents.manage') || hasPermission(user, 'settings.manage')) return true;
  if (doc.archived) return false;
  const role = user.role_slug;
  if (doc.visibility === 'public' || doc.visibility === 'all') return true;
  if (doc.visibility === 'etudiant') return role === 'etudiant';
  if (doc.visibility === 'enseignant') return role === 'enseignant' || (role !== 'etudiant');
  if (doc.visibility === 'personnel') return role !== 'etudiant';
  if (doc.visibility === 'level') return Number(doc.level_id) === Number(user.level_id);
  if (doc.visibility === 'parcours') return Number(doc.parcours_id) === Number(user.parcours_id);
  return false;
}

export function canManageResults(user) {
  return hasPermission(user, 'results.manage') || hasPermission(user, 'results.publish');
}

export async function canReadResult(user, result) {
  if (!user) return false;
  if (canManageResults(user)) return true;
  if (result.status !== 'published') return false;
  if (result.level_id && Number(result.level_id) !== Number(user.level_id)) return false;
  if (result.parcours_id && Number(result.parcours_id) !== Number(user.parcours_id)) return false;
  if (result.parcours_id && !user.parcours_id) return false;
  return true;
}

export async function canReadTimetable(user, tt) {
  if (!user) return false;
  if (hasPermission(user, 'timetables.manage')) return true;
  if (tt.archived) return false;
  const scopes = await query('SELECT scope_type, scope_id FROM user_scopes WHERE user_id = $1', [user.id]);
  const levelOk = !tt.level_id || Number(tt.level_id) === Number(user.level_id) ||
    scopes.some((s) => s.scope_type === 'level' && Number(s.scope_id) === Number(tt.level_id));
  const parcoursOk = !tt.parcours_id || Number(tt.parcours_id) === Number(user.parcours_id) ||
    scopes.some((s) => s.scope_type === 'parcours' && Number(s.scope_id) === Number(tt.parcours_id));
  const groupOk = !tt.group_name || !user.group_name || tt.group_name === user.group_name;
  return levelOk && parcoursOk && groupOk;
}

/** Accès centralisé aux fichiers selon leurs liens et autorisations. */
export async function canAccessFile(user, fileId) {
  const role = user?.role_slug || null;
  const perms = user?.permissions || [];

  const logo = await one("SELECT value FROM settings WHERE key = 'logo_file_id'");
  if (logo && String(logo.value) === String(fileId)) return { ok: true, inline: true, filename: null, mime: null };

  const doc = await one('SELECT * FROM documents WHERE file_id = $1 LIMIT 1', [fileId]);
  if (doc) {
    if (doc.visibility === 'public') return { ok: true, inline: false };
    if (!user) return { ok: false };
    return { ok: await canReadDocument(user, doc), inline: false };
  }

  const tt = await one('SELECT * FROM timetables WHERE file_id = $1 LIMIT 1', [fileId]);
  if (tt) {
    if (!user) return { ok: false };
    return { ok: await canReadTimetable(user, tt), inline: false };
  }

  const result = await one('SELECT * FROM results WHERE file_id = $1 LIMIT 1', [fileId]);
  if (result) {
    if (!user) return { ok: false };
    return { ok: await canReadResult(user, result), inline: false };
  }

  const links = await query('SELECT publication_id FROM publication_files WHERE file_id = $1', [fileId]);
  if (links.length) {
    for (const link of links) {
      const access = await canReadPublication(user, link.publication_id);
      if (access.ok) return { ok: true, inline: true };
    }
    return { ok: false };
  }

  // Fichier orphelin : réservé au chef / gestionnaire de documents.
  if (user && (hasPermission(user, 'documents.manage') || hasPermission(user, 'settings.manage'))) {
    return { ok: true, inline: false };
  }
  return { ok: false };
}
