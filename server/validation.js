import { badRequest } from './errors.js';

export function str(value, { min = 0, max = 5000, field = 'Ce champ', required = false } = {}) {
  const v = value === undefined || value === null ? '' : String(value).trim();
  if (!v) {
    if (required) throw badRequest(`${field} est obligatoire.`);
    return '';
  }
  if (v.length < min) throw badRequest(`${field} doit contenir au moins ${min} caractères.`);
  if (v.length > max) throw badRequest(`${field} ne doit pas dépasser ${max} caractères.`);
  return v;
}

export function intId(value, { field = 'Identifiant', required = true } = {}) {
  if (value === undefined || value === null || value === '' || value === 'null') {
    if (required) throw badRequest(`${field} invalide.`);
    return null;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`${field} invalide.`);
  return n;
}

export function oneOf(value, allowed, { field = 'Valeur', required = true } = {}) {
  if ((value === undefined || value === null || value === '') && !required) return null;
  const v = String(value);
  if (!allowed.includes(v)) throw badRequest(`${field} invalide.`);
  return v;
}

export function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'oui', 'on', 'yes'].includes(String(value).toLowerCase());
}

export function email(value, { required = false } = {}) {
  const v = str(value, { max: 160, field: 'Adresse e-mail' });
  if (!v) {
    if (required) throw badRequest("L'adresse e-mail est obligatoire.");
    return '';
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) throw badRequest("L'adresse e-mail est invalide.");
  return v;
}

export function phone(value) {
  const raw = str(value, { required: true, max: 25, field: 'Numéro de téléphone' });
  const cleaned = raw.replace(/[\s.\-()]/g, '');
  if (!/^\+?\d{8,15}$/.test(cleaned)) {
    throw badRequest('Le numéro de téléphone doit contenir entre 8 et 15 chiffres (indicatif autorisé).');
  }
  return cleaned;
}

/** Mot de passe : exactement 6 chiffres (exigence du cahier des charges). */
export function password6(value, { field = 'Le mot de passe' } = {}) {
  const v = value === undefined || value === null ? '' : String(value);
  if (!/^\d{6}$/.test(v)) throw badRequest(`${field} doit contenir exactement 6 chiffres.`, 'password_rule');
  return v;
}

export function dateOnly(value, { field = 'Date', required = false } = {}) {
  const v = str(value, { max: 10, field });
  if (!v) {
    if (required) throw badRequest(`${field} est obligatoire.`);
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw badRequest(`${field} est invalide.`);
  return v;
}

export function isoDate(value, { field = 'Date', required = false } = {}) {
  const v = str(value, { max: 40, field });
  if (!v) {
    if (required) throw badRequest(`${field} est obligatoire.`);
    return null;
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw badRequest(`${field} est invalide.`);
  return d.toISOString();
}

export function pagination(query, defaultLimit = 30) {
  const page = Math.max(1, Number.parseInt(query.page || '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit || String(defaultLimit), 10) || defaultLimit));
  return { page, limit, offset: (page - 1) * limit };
}

export function safeUrl(value) {
  const v = str(value, { max: 500, field: 'Lien' });
  if (!v) return '';
  if (!/^https?:\/\/[^\s<>"']+$/i.test(v)) throw badRequest('Le lien doit commencer par http:// ou https://.');
  return v;
}

export function localReference(prefix = 'DEM') {
  const now = new Date();
  const y = now.getFullYear();
  const rand = Math.floor(Math.random() * 90000 + 10000);
  return `${prefix}-${y}-${rand}`;
}
