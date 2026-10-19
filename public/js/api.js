/* =====================================================================
   Socle du client : état, appels API, échappement HTML, composants UI
   ===================================================================== */

export const state = {
  user: null,
  csrf: null,
  permissions: [],
  settings: {},
  modules: {},
  structure: null,
  categories: null,
  scale: Number(localStorage.getItem('dc_scale') || 1),
  notif: { unread: 0, last_id: 0, loaded: false },
  toastRoot: null,
};

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/* ------------------------------ Échappement ------------------------------ */
const ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPE[c]);

class Raw {
  constructor(value) { this.value = value; }
  toString() { return this.value; }
}
export const raw = (value) => new Raw(value);

function renderValue(value) {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof Raw) return value.value;
  if (Array.isArray(value)) return value.map(renderValue).join('');
  return esc(value);
}

/** Balise de template sécurisée : les valeurs interpolées sont échappées. */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) {
    out += renderValue(values[i]) + strings[i + 1];
  }
  return new Raw(out);
}

/* --------------------------------- API --------------------------------- */
export async function api(path, { method = 'GET', body, headers = {}, rawBody } = {}) {
  const opts = { method, credentials: 'same-origin', headers: { Accept: 'application/json', ...headers } };
  if (rawBody !== undefined) {
    opts.body = rawBody;
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  if (!['GET', 'HEAD'].includes(method)) opts.headers['X-CSRF-Token'] = state.csrf || '';
  let res;
  try {
    res = await fetch(`/api${path}`, opts);
  } catch {
    throw new ApiError('Connexion au serveur impossible. Vérifiez votre réseau puis réessayez.', 0, 'network');
  }
  let data = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new ApiError(data?.error || `Erreur ${res.status}. Réessayez ou contactez l’administration.`, res.status, data?.code);
    err.payload = data;
    throw err;
  }
  return data;
}

export async function uploadFile(file) {
  const maxMb = Number(state.settings?.max_upload_mb || 8);
  if (file.size > maxMb * 1024 * 1024) {
    throw new ApiError(`Fichier trop volumineux : maximum ${maxMb} Mo.`, 400, 'too_large');
  }
  const res = await fetch('/api/uploads', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'X-File-Name': encodeURIComponent(file.name),
      'X-CSRF-Token': state.csrf || '',
    },
    body: file,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.error || 'Échec du téléversement.', res.status, data?.code);
  return data.file;
}

export async function loadMe() {
  let data;
  try {
    data = await api('/auth/me');
  } catch (err) {
    if (err.code === 'account_pending' || err.code === 'account_suspended' || err.code === 'account_rejected') {
      state.authNotice = err.message;
      state.settings = err.payload?.settings || state.settings;
      state.modules = state.settings?.modules || {};
      state.user = null;
      return null;
    }
    throw err;
  }
  state.user = data.user;
  state.csrf = data.csrf_token;
  state.permissions = data.permissions || [];
  state.settings = data.settings || {};
  state.modules = data.settings?.modules || {};
  if (data.user && data.user.text_scale) state.scale = Number(data.user.text_scale);
  applyScale(state.scale);
  return data;
}

export async function loadStructure(force = false) {
  if (state.structure && !force) return state.structure;
  state.structure = await api('/structure');
  return state.structure;
}

export async function loadCategories(force = false) {
  if (state.categories && !force) return state.categories;
  const data = await api('/categories');
  state.categories = data.categories;
  return state.categories;
}

/* ------------------------------ Permissions ------------------------------ */
export function can(permission) {
  return state.permissions.includes('*') || state.permissions.includes(permission);
}
export function canAny(...perms) {
  return perms.some((p) => can(p));
}
export function isStudent() {
  return state.user?.role_slug === 'etudiant';
}
export function isStaff() {
  return Boolean(state.user) && state.user.role_slug !== 'etudiant';
}
export function moduleOn(key) {
  return state.modules?.[key] !== false;
}

/* ------------------------------ Formatage ------------------------------ */
const DATE_FMT = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
const DATETIME_FMT = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const TIME_FMT = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

export function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : DATE_FMT.format(d);
}
export function fmtDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : DATETIME_FMT.format(d);
}
export function fmtTime(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : TIME_FMT.format(d);
}
export function timeAgo(value) {
  if (!value) return '';
  const diff = (Date.now() - new Date(value).getTime()) / 1000;
  if (Number.isNaN(diff)) return '';
  if (diff < 60) return 'à l’instant';
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
  if (diff < 604800) return `il y a ${Math.floor(diff / 86400)} j`;
  return fmtDate(value);
}
export function initials(name) {
  const words = String(name || '')
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((w) => /[\p{L}]/u.test(w));
  return words.slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
}
export function fileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} Ko`;
  return `${(n / 1024 / 1024).toFixed(1)} Mo`;
}
export function toLocalInput(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
export const fileUrl = (id, inline = false) => `/api/files/${id}${inline ? '?inline=1' : ''}`;
export const priorityLabel = { normale: 'Normale', haute: 'Haute', urgente: 'Urgente' };
export const statusLabel = {
  draft: 'Brouillon', scheduled: 'Programmée', published: 'Publiée', archived: 'Archivée',
  pending: 'En attente', active: 'Actif', suspended: 'Suspendu', rejected: 'Rejeté',
  recue: 'Reçue', en_cours: 'En cours', traitee: 'Traitée', rejetee: 'Rejetée',
  withdrawn: 'Retirée',
};
export function statusBadge(status) {
  const map = {
    published: 'badge-ok', active: 'badge-ok', traitee: 'badge-ok',
    pending: 'badge-warn', recue: 'badge-warn', scheduled: 'badge-warn', en_cours: 'badge-warn',
    draft: 'badge-gris', archived: 'badge-gris', suspended: 'badge-err', rejected: 'badge-err', rejetee: 'badge-err', withdrawn: 'badge-err',
  };
  return html`<span class="badge ${map[status] || 'badge-gris'}">${statusLabel[status] || status}</span>`;
}

/* ------------------------------ Icônes ------------------------------ */
/** Année académique affichée : paramètre officiel, sinon année en cours (août → juillet). */
export function academicYear() {
  const set = String(state.settings?.academic_year || '').trim();
  if (set) return set;
  const now = new Date();
  const start = now.getMonth() + 1 >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  return `${start}–${start + 1}`;
}

const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-6h6v6"/>',
  bell: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .33 1.77l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.6 1.6 0 0 0-1.77-.33 1.6 1.6 0 0 0-1 1.47V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.46 1.6 1.6 0 0 0-1.77.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.6 1.6 0 0 0 4.6 15a1.6 1.6 0 0 0-1.47-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.46-1 1.6 1.6 0 0 0-.33-1.77l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.6 1.6 0 0 0 9 4.6a1.6 1.6 0 0 0 1-1.47V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.46 1.6 1.6 0 0 0 1.77-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.6 1.6 0 0 0 19.4 9c.2.6.74 1 1.37 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
  chart: '<path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6"/><rect x="12" y="8" width="3" height="10"/><rect x="17" y="5" width="3" height="13"/>',
  message: '<path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.5 8.6 8.6 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 1 1 16.1-3.8z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5M12 3v12"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  'check-circle': '<circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-5"/>',
  'x-circle': '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  megaphone: '<path d="m3 11 18-7v16L3 13z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  graduation: '<path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5"/>',
  'arrow-left': '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  'arrow-right': '<path d="M5 12h14M12 5l7 7-7 7"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m11 12 8-8 3 3-3 3-2-2"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.1a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 7L2 7"/>',
  'map-pin': '<path d="M21 10c0 7-9 12-9 12S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7L12.5 20"/>',
  pin: '<path d="M12 17v5"/><path d="M9 10.8V4l-2-2h10l-2 2v6.8l2 2V15H7v-2.2z"/>',
  filter: '<path d="M22 3H2l8 9.5V19l4 2v-8.5z"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5"/><path d="M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
  paperclip: '<path d="M21.4 11.6 12 21a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6M10 14 21 3"/>',
  volume: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14"/>',
  'volume-off': '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="m23 9-6 6M17 9l6 6"/>',
  award: '<circle cx="12" cy="8" r="6"/><path d="m8.2 13.4-1.7 7.6 5.5-3 5.5 3-1.7-7.6"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  'refresh': '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15"/>',
  tag: '<path d="M20.6 13.4 12 22l-9-9V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"/><circle cx="7.5" cy="7.5" r="1.2"/>',
  building: '<path d="M3 21h18"/><path d="M5 21V8l7-4 7 4v13"/><path d="M9.5 21v-4.5h5V21"/><path d="M9 10h.9M14.1 10h.9M9 13.2h.9M14.1 13.2h.9"/>',
};

export function icon(name, cls = '') {
  const path = ICONS[name] || ICONS.info;
  return raw(
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`
  );
}

/* ------------------------------ Toasts ------------------------------ */
export function toast(message, type = 'info', timeout = 4200) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = `toast ${type === 'error' ? 'err' : type === 'success' ? 'ok' : type === 'warning' ? 'warn' : ''}`;
  const iconName = type === 'error' ? 'x-circle' : type === 'success' ? 'check-circle' : type === 'warning' ? 'alert' : 'info';
  el.innerHTML = `${icon(iconName)}<div>${esc(message)}</div>`;
  root.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    el.style.transition = 'all .25s';
    setTimeout(() => el.remove(), 260);
  }, timeout);
}

/* ------------------------------ Modales ------------------------------ */
export function modal({ title = '', body = '', footer = '', wide = false, onMount, onClose } = {}) {
  const root = document.getElementById('modal-root');
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = renderValue(
    html`<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-head">
        <h2 id="modal-title">${title}</h2>
        <button type="button" class="btn btn-icon" data-close aria-label="Fermer">${icon('close')}</button>
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? html`<div class="modal-foot">${footer}</div>` : ''}
    </div>`
  );
  root.appendChild(overlay);
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('[data-close]')) close();
  });
  const first = overlay.querySelector('input, select, textarea, button');
  setTimeout(() => first?.focus(), 30);
  onMount?.(overlay, close);
  return { overlay, close };
}

export function confirmDialog(message, { title = 'Confirmation', confirmLabel = 'Confirmer', danger = false } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value, close) => {
      if (settled) return;
      settled = true;
      resolve(value);
      close();
    };
    const { close, overlay } = modal({
      title,
      body: html`<p style="margin:0">${message}</p>`,
      footer: html`<button type="button" class="btn btn-secondary" data-close>Annuler</button>
        <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-confirm>${confirmLabel}</button>`,
      onClose: () => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      },
    });
    overlay.querySelector('[data-confirm]').addEventListener('click', () => finish(true, close));
    overlay.querySelector('[data-close]').addEventListener('click', () => finish(false, close));
  });
}

/* ------------------------------ Accessibilité & préférences ------------------------------ */
export function applyScale(scale) {
  const min = Number(state.settings?.text_scale_min || 0.9);
  const max = Number(state.settings?.text_scale_max || 1.4);
  const bounded = Math.min(max || 1.4, Math.max(min || 0.9, Number(scale) || 1));
  state.scale = bounded;
  document.documentElement.style.fontSize = `${(16 * bounded).toFixed(1)}px`;
  localStorage.setItem('dc_scale', String(bounded));
}

const audioCache = new Map();
export function playSound(pref, { volume = 0.7 } = {}) {
  if (!pref || pref === 'aucun') return;
  const name = ['classique', 'discret', 'doux', 'academique', 'dynamique', 'defaut'].includes(pref) ? pref : 'classique';
  try {
    let audio = audioCache.get(name);
    if (!audio) {
      audio = new Audio(`/sounds/${name}.wav`);
      audio.preload = 'auto';
      audioCache.set(name, audio);
    }
    audio.pause();
    audio.currentTime = 0;
    audio.volume = volume;
    audio.play().catch(() => {});
  } catch {
    /* la lecture est facultative */
  }
  if (state.user?.vibration && navigator.vibrate) navigator.vibrate(90);
}

export async function enableBrowserNotifications() {
  if (!('Notification' in window)) {
    toast("Ce navigateur ne prend pas en charge les notifications système. Les alertes restent visibles dans l’application.", 'warning');
    return false;
  }
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') {
    toast('Les notifications système sont bloquées dans les réglages du navigateur.', 'warning');
    return false;
  }
  const result = await Notification.requestPermission();
  return result === 'granted';
}

export function browserNotify(title, body, url = '/#/notifications') {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, icon: '/icons/icon-192.png', tag: `dcub-${title}`, data: { url } });
    n.onclick = () => {
      window.focus();
      location.hash = url.replace(/^\/#/, '');
      n.close();
    };
  } catch {
    /* ignoré */
  }
}

/* ------------------------------ Navigation ------------------------------ */
export function navigate(path) {
  if (location.hash === `#${path}`) return;
  location.hash = path;
}
export function goBack() {
  if (history.length > 1) history.back();
  else navigate('/accueil');
}

/* ------------------------------ États de chargement ------------------------------ */
export const loading = () => html`<div class="loader"><span class="spinner"></span><span>Chargement…</span></div>`;
export function emptyState(title, text = '', iconName = 'folder', action = '') {
  return html`<div class="empty">${icon(iconName)}<h3>${title}</h3>${text ? html`<p>${text}</p>` : ''}${action}</div>`;
}
export function errorState(message, retryId = '') {
  return html`<div class="alert alert-err">${icon('alert')}<div><strong>Erreur.</strong> ${message}</div></div>
    ${retryId ? html`<button type="button" class="btn btn-secondary btn-sm" id="${retryId}">${icon('refresh')} Réessayer</button>` : ''}`;
}

/* ------------------------------ Validation formulaire ------------------------------ */
export function showFormError(root, message) {
  let box = root.querySelector('[data-form-error]');
  if (!box) {
    box = document.createElement('div');
    box.setAttribute('data-form-error', '');
    box.className = 'alert alert-err';
    box.innerHTML = `${icon('alert')}<div></div>`;
    const body = root.querySelector('.modal-body') || root;
    body.prepend(box);
  }
  box.querySelector('div').textContent = message;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
export function setLoading(button, isLoading, label = 'Traitement…') {
  if (!button) return;
  if (isLoading) {
    button.dataset.original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner spinner-sm"></span> ${esc(label)}`;
  } else {
    button.disabled = false;
    if (button.dataset.original) button.innerHTML = button.dataset.original;
  }
}
