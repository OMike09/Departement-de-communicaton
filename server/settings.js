import { query, one } from './db.js';

export const SETTING_KEYS = [
  'app_name', 'app_short', 'institution', 'presentation', 'presentation_extra',
  'contact_email', 'contact_phone', 'contact_address', 'contact_hours',
  'logo_file_id', 'academic_year', 'require_approval', 'registration_open',
  'default_signup_role', 'signup_help', 'modules', 'text_scale_min', 'text_scale_max',
  'demo_mode', 'footer_note', 'max_upload_mb', 'source_pdf_note',
  'notification_types', 'activity_categories', 'data_retention_days',
];

export async function getSettings() {
  const rows = await query('SELECT key, value FROM settings');
  const map = {};
  for (const row of rows) map[row.key] = row.value;
  return map;
}

export async function getSetting(key, fallback = '') {
  const row = await one('SELECT value FROM settings WHERE key = $1', [key]);
  return row ? row.value : fallback;
}

export async function setSetting(key, value) {
  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1,$2,now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, String(value ?? '')]
  );
}

export async function getModules() {
  const raw = await getSetting('modules', '{}');
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function moduleEnabled(settings, key) {
  try {
    const mods = JSON.parse(settings.modules || '{}');
    return mods[key] !== false;
  } catch {
    return true;
  }
}

/** Libellé public de l'application (évite les appels répétés). */
export async function publicSettings() {
  const s = await getSettings();
  let logo = null;
  if (s.logo_file_id) {
    const row = await one('SELECT id, filename, mime, size FROM files WHERE id = $1', [Number(s.logo_file_id)]);
    if (row) logo = { id: row.id, url: `/api/public/logo` };
  }
  return {
    app_name: s.app_name,
    app_short: s.app_short,
    institution: s.institution,
    presentation: s.presentation,
    presentation_extra: s.presentation_extra,
    contact_email: s.contact_email,
    contact_phone: s.contact_phone,
    contact_address: s.contact_address,
    contact_hours: s.contact_hours,
    academic_year: s.academic_year,
    registration_open: s.registration_open === '1',
    require_approval: s.require_approval === '1',
    signup_help: s.signup_help,
    modules: JSON.parse(s.modules || '{}'),
    activity_categories: (() => { try { return JSON.parse(s.activity_categories || '{}'); } catch { return {}; } })(),
    text_scale_min: s.text_scale_min,
    text_scale_max: s.text_scale_max,
    demo_mode: s.demo_mode === '1',
    footer_note: s.footer_note,
    source_pdf_note: s.source_pdf_note,
    max_upload_mb: Number(s.max_upload_mb || 8),
    logo,
  };
}
