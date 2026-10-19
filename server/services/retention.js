import { query } from '../db.js';
import { getSetting } from '../settings.js';

/**
 * Applique la durée de conservation configurée :
 *  - notifications déjà lues plus anciennes que N jours ;
 *  - entrées du journal d'audit plus anciennes que N jours.
 * Une valeur de 0 (ou vide) signifie « conservation illimitée ».
 */
export async function purgeExpiredData() {
  const days = Number(await getSetting('data_retention_days', '0')) || 0;
  if (!Number.isFinite(days) || days <= 0) return { notifications: 0, audit: 0, days: 0 };
  const notifications = await query(
    `DELETE FROM notifications
     WHERE read_at IS NOT NULL AND read_at < now() - ($1::int * interval '1 day')
     RETURNING id`,
    [days]
  );
  const audit = await query(
    `DELETE FROM audit_logs
     WHERE created_at < now() - ($1::int * interval '1 day')
     RETURNING id`,
    [days]
  );
  return { notifications: notifications.length, audit: audit.length, days };
}
