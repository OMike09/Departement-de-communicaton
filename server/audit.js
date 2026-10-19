import { query } from './db.js';

/** Trace une opération sensible. N'échoue jamais la requête métier. */
export async function audit(req, action, entityType = '', entityId = null, details = {}) {
  try {
    await query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details, ip)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [req?.user?.id || null, action, entityType, entityId, JSON.stringify(details || {}), String(req?.ip || '')]
    );
  } catch (err) {
    console.error('audit:', err.message);
  }
}
