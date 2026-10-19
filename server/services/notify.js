import { query, tx } from '../db.js';
import { getSetting } from '../settings.js';

/**
 * Publie une publication programmée ou en brouillon et crée les notifications
 * des destinataires autorisés, de façon transactionnelle et dédupliquée.
 */
async function notificationTypeEnabled(type) {
  try {
    const raw = await getSetting('notification_types', '');
    if (!raw) return true;
    const map = JSON.parse(raw);
    return map[type] !== false;
  } catch {
    return true;
  }
}

export async function publishPublication(publicationId, actorId) {
  const enabled = await notificationTypeEnabled('publication');
  return tx(async (t) => {
    const pub = await t.one(
      `UPDATE publications
       SET status = 'published', published_at = now(), publish_at = COALESCE(publish_at, now()),
           updated_by = $2, updated_at = now()
       WHERE id = $1 AND status IN ('draft','scheduled')
       RETURNING id, title, publish_at, created_by`,
      [publicationId, actorId || null]
    );
    if (!pub) return { published: false, notified: 0 };
    const notified = enabled ? await insertAudienceNotifications(t, pub) : 0;
    return { published: true, notified };
  });
}

async function insertAudienceNotifications(t, pub) {
  const author = pub.created_by || 0;
  const bodyText = 'Une nouvelle publication est disponible dans votre espace.';
  const rows = await t.query(
    `INSERT INTO notifications (user_id, publication_id, type, title, body)
     SELECT u.id, $1, 'publication', $2, $3
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.status = 'active'
       AND u.id <> $4
       AND EXISTS (
         SELECT 1 FROM publication_audiences a
         WHERE a.publication_id = $1 AND (
              a.kind = 'all'
           OR (a.kind = 'role' AND a.target_text = r.slug)
           OR (a.kind = 'level' AND r.slug = 'etudiant' AND a.target_id = u.level_id)
           OR (a.kind = 'parcours' AND r.slug = 'etudiant' AND a.target_id = u.parcours_id)
           OR (a.kind = 'group' AND r.slug = 'etudiant' AND a.target_text = u.group_name)
         )
       )
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [pub.id, `Nouvelle publication : ${pub.title}`.slice(0, 180), bodyText, author]
  );
  return rows.length;
}

/** Notifie une liste d'utilisateurs (résultats publiés, emploi du temps...). */
export async function notifyUsers(userIds, { type = 'info', title, body = '' }) {
  if (!userIds.length) return 0;
  if (!(await notificationTypeEnabled(type))) return 0;
  let count = 0;
  for (const userId of userIds) {
    await query(
      'INSERT INTO notifications (user_id, type, title, body) VALUES ($1,$2,$3,$4)',
      [userId, type, title.slice(0, 180), body.slice(0, 500)]
    );
    count += 1;
  }
  return count;
}

/** Identifiants des étudiants actifs correspondant à un niveau / parcours. */
export async function studentIdsFor(levelId, parcoursId) {
  const rows = await query(
    `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.status = 'active' AND r.slug = 'etudiant'
       AND ($1::int IS NULL OR u.level_id = $1)
       AND ($2::int IS NULL OR u.parcours_id = $2)`,
    [levelId, parcoursId]
  );
  return rows.map((r) => r.id);
}

/** Vérifie périodiquement les publications programmées arrivées à échéance. */
export async function publishDuePublications() {
  const rows = await query(
    `SELECT id, created_by FROM publications
     WHERE status = 'scheduled' AND publish_at IS NOT NULL AND publish_at <= now()`
  );
  for (const row of rows) {
    try {
      await publishPublication(row.id, row.created_by);
    } catch (err) {
      console.error('Publication programmée :', err.message);
    }
  }
  return rows.length;
}
