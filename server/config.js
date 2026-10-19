import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

/* Chargement minimal de .env (sans dépendance externe) */
(function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  const content = fs.readFileSync(file, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
})();

function bool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

const isProd = process.env.NODE_ENV === 'production';

export const config = {
  isProd,
  port: Number(process.env.PORT || 3000),
  appUrl: process.env.APP_URL || '',
  databaseUrl: process.env.DATABASE_URL || '',
  pgliteDataDir: path.resolve(ROOT, process.env.PGLITE_DATA_DIR || 'storage/pglite'),
  sessionSecret: process.env.SESSION_SECRET || '',
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS || 24),
  trustProxy: bool(process.env.TRUST_PROXY, isProd),
  requireApproval: bool(process.env.REQUIRE_APPROVAL, true),
  registrationOpen: bool(process.env.REGISTRATION_OPEN, true),
  defaultSignupRole: process.env.DEFAULT_SIGNUP_ROLE || 'etudiant',
  storageDriver: process.env.STORAGE_DRIVER || 'auto',
  storageDir: path.resolve(ROOT, process.env.STORAGE_DIR || 'storage'),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 8),
  storageBackend: (process.env.STORAGE_BACKEND || '').toLowerCase(),
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseKey: process.env.SUPABASE_SERVICE_KEY || '',
  supabaseBucket: process.env.SUPABASE_BUCKET || 'documents',
};

export const ALLOWED_ORIGIN = process.env.APP_URL || '';
export const COOKIE_NAME = 'sid';
