import {
  state, api, loadMe, loadStructure, loadCategories, can, html, icon,
  toast, navigate, playSound, browserNotify, academicYear,
} from './api.js';
import { renderLanding, renderLogin, renderRegister, renderForgot, renderReset } from './views/public.js';
import { renderDashboard } from './views/dashboard.js';
import { renderPublications, renderPublicationDetail, renderPublicationEditor } from './views/publications.js';
import { renderDocuments } from './views/documents.js';
import { renderTimetables, renderCalendar } from './views/timetables.js';
import { renderResults } from './views/results.js';
import { renderRequests } from './views/requests.js';
import { renderMessages } from './views/messages.js';
import { renderActivities } from './views/activities.js';
import { renderNotifications } from './views/notifications.js';
import { renderProfile } from './views/profile.js';
import {
  renderAdminUsers, renderAdminRoles, renderAdminStructure, renderAdminSettings,
  renderAdminStats, renderAdminAudit, renderAdminBackup,
} from './views/admin.js';

const app = document.getElementById('app');

const NAV_GROUPS = [
  {
    title: 'Espace personnel',
    items: [
      { path: '/accueil', label: "Vue d'ensemble", icon: 'home' },
      { path: '/notifications', label: 'Notifications', icon: 'bell', badge: 'notif' },
      { path: '/messages', label: 'Messages privés', icon: 'message', badge: 'msg', module: 'messages' },
      { path: '/profil', label: 'Mon profil', icon: 'user' },
    ],
  },
  {
    title: 'Espace académique',
    items: [
      { path: '/annonces', label: 'Annonces', icon: 'megaphone' },
      { path: '/documents', label: 'Documents', icon: 'folder', module: 'documents' },
      { path: '/emplois-du-temps', label: 'Emplois du temps', icon: 'calendar', module: 'timetables' },
      { path: '/calendrier', label: 'Calendrier', icon: 'clock', module: 'timetables' },
      { path: '/resultats', label: 'Résultats', icon: 'award', module: 'results' },
      { path: '/demandes', label: 'Demandes administratives', icon: 'book', module: 'requests' },
      { path: '/vie-du-departement', label: 'Vie du département', icon: 'graduation', module: 'activities' },
    ],
  },
];

function allNavItems() {
  return NAV_GROUPS.flatMap((g) => g.items);
}

function adminNav() {
  const items = [];
  if (can('users.view')) items.push({ path: '/admin/utilisateurs', label: 'Utilisateurs', icon: 'users' });
  if (can('roles.manage')) items.push({ path: '/admin/roles', label: 'Rôles & permissions', icon: 'shield' });
  if (can('structure.manage')) items.push({ path: '/admin/structure', label: 'Structure académique', icon: 'graduation' });
  if (can('stats.view')) items.push({ path: '/admin/statistiques', label: 'Statistiques', icon: 'chart' });
  if (can('audit.view')) items.push({ path: '/admin/journal', label: "Journal d'activité", icon: 'history' });
  if (can('settings.manage')) items.push({ path: '/admin/parametres', label: 'Paramètres', icon: 'settings' });
  if (can('backups.manage')) items.push({ path: '/admin/sauvegarde', label: 'Sauvegarde', icon: 'database' });
  return items;
}

function navLink(item, activePath) {
  const active = activePath === item.path || activePath.startsWith(item.path + '/');
  return html`
    <a href="#${item.path}" class="sidebar-link ${active ? 'active' : ''}" data-nav${active ? ' aria-current="page"' : ''}>
      ${icon(item.icon)}<span class="sidebar-link-label">${item.label}</span>
      ${item.badge === 'notif' ? html`<span class="count ${state.notif.unread ? '' : 'hidden'}" id="nav-notif-count">${state.notif.unread}</span>` : ''}
      ${item.badge === 'msg' ? html`<span class="count hidden" id="nav-msg-count">0</span>` : ''}
    </a>`;
}

/* ------------------------------ Coquille connectée ------------------------------ */
function shell(activePath) {
  const u = state.user || {};
  const initials = initialsOf(u.full_name);
  const adminItems = adminNav();
  const cover = state.settings.cover;
  const logo = state.settings.logo;
  const banner = cover
    ? html`<img src="${cover.url}" alt="Photo de couverture du département">`
    : logo
      ? html`<img class="side-banner-logo" src="${logo.url}" alt="Logo du département">`
      : html`<span class="side-monogram" aria-hidden="true">DC</span>`;
  return html`
  <div class="app-layout">
    <div class="sidebar-scrim hidden" id="sidebar-scrim"></div>
    <aside class="sidebar" id="sidebar" aria-label="Navigation principale">
      <a class="side-banner${cover ? ' has-photo' : ''}" href="#/accueil" aria-label="Accueil du département">${banner}</a>
      <a class="side-brand" href="#/accueil">
        <span class="side-brand-title">${state.settings.app_short || 'Département de Communication'}</span>
        <span class="side-brand-sub">${state.settings.institution || 'Université de Bouaké'}</span>
      </a>
      <div class="sidebar-scroll">
        ${NAV_GROUPS.map((group) => {
          const items = group.items.filter((i) => !i.module || state.modules?.[i.module] !== false);
          if (!items.length) return '';
          return html`
            <div class="sidebar-section">${group.title}</div>
            ${items.map((item) => navLink(item, activePath))}`;
        })}
        ${adminItems.length ? html`
          <div class="sidebar-section">Administration</div>
          ${adminItems.map((item) => navLink(item, activePath))}` : ''}
      </div>
      <div class="sidebar-foot">
        <button type="button" class="side-user" data-profile aria-label="Ouvrir mon profil">
          <span class="side-avatar">${initials}</span>
          <span class="side-user-meta">
            <strong>${u.full_name || ''}</strong>
            <span>${u.role_name || ''}</span>
          </span>
        </button>
        <button type="button" class="side-logout" id="logout-btn">
          ${icon('logout')}<span>Déconnexion</span>
        </button>
        <div class="side-version">Version ${window.APP_BUILD || '2.0.0'}</div>
      </div>
    </aside>
    <div class="app-main">
      <header class="app-topbar">
        <button type="button" class="btn btn-icon hamburger" id="hamburger" aria-label="Ouvrir le menu">${icon('menu')}</button>
        <nav class="topbar-crumbs" aria-label="Fil d’Ariane">
          <span class="crumb-root">${state.settings.app_short || 'Département de Communication'}</span>
          <span class="crumb-sep" aria-hidden="true">/</span>
          <strong id="topbar-title">${titleFor(activePath)}</strong>
        </nav>
        <div class="topbar-actions">
          <span class="topbar-year" title="Année académique en cours">${academicYear()}</span>
          <a href="#/notifications" class="topbar-bell" aria-label="Notifications" title="Notifications">
            ${icon('bell')}
            <span class="notif-badge ${state.notif.unread ? '' : 'hidden'}" id="top-notif-count">${state.notif.unread}</span>
          </a>
          <button type="button" class="topbar-user" data-profile aria-label="Mon profil">
            <span class="topbar-user-meta">
              <strong>${u.full_name || ''}</strong>
              <span>${u.role_name || ''}</span>
            </span>
            <span class="side-avatar side-avatar-sm">${initials}</span>
          </button>
        </div>
      </header>
      <main id="view" class="page" tabindex="-1"></main>
    </div>
  </div>`;
}

function initialsOf(name) {
  const words = String(name || '')
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((w) => /[\p{L}]/u.test(w));
  const picked = words.slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  return picked || '?';
}
function titleFor(path) {
  const all = [...allNavItems(), ...adminNav()];
  const found = all.find((i) => path === i.path || path.startsWith(i.path + '/'));
  if (path.startsWith('/annonces/nouvelle')) return 'Nouvelle publication';
  if (path.match(/^\/annonces\/\d+\/modifier/)) return 'Modifier la publication';
  if (path.match(/^\/annonces\/\d+/)) return 'Publication';
  return found?.label || 'Mon espace';
}

function bindShell() {
  document.getElementById('hamburger')?.addEventListener('click', () => {
    document.getElementById('sidebar')?.classList.add('open');
    document.getElementById('sidebar-scrim')?.classList.remove('hidden');
  });
  document.getElementById('sidebar-scrim')?.addEventListener('click', closeSidebar);
  document.querySelectorAll('[data-nav]').forEach((a) => a.addEventListener('click', closeSidebar));
  document.querySelectorAll('[data-profile]').forEach((el) => el.addEventListener('click', () => navigate('/profil')));
  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {}
    state.user = null;
    state.csrf = null;
    state.permissions = [];
    stopPolling();
    toast('Vous êtes déconnecté.', 'success');
    navigate('/');
    render();
  });
}
function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebar-scrim')?.classList.add('hidden');
}

/* ------------------------------ Routeur ------------------------------ */
const PUBLIC_PATHS = ['/', '/connexion', '/inscription', '/mot-de-passe-oublie'];

function parseRoute() {
  const hash = location.hash.replace(/^#/, '') || '/';
  const [pathPart, queryPart] = hash.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  return { path: '/' + segments.join('/'), segments, query: new URLSearchParams(queryPart || '') };
}

async function ensureData() {
  await loadMe();
  if (state.user) {
    await Promise.all([loadStructure().catch(() => null), loadCategories().catch(() => null)]);
  }
}

let notifTimer = null;
let msgTimer = null;

function startPolling() {
  if (notifTimer) return;
  const pollNotif = async () => {
    if (!state.user) return;
    try {
      const data = await api('/notifications/count');
      const previousLast = state.notif.last_id;
      state.notif.unread = data.unread;
      state.notif.last_id = data.last_id || 0;
      updateBadges();
      if (state.notif.loaded && data.last_id && data.last_id > previousLast) {
        const pref = state.user?.sound_pref || 'classique';
        playSound(pref);
        if (document.hidden) {
          browserNotify('Nouvelle notification', 'Une nouvelle publication ou information est disponible.', '/#/notifications');
        }
      }
      state.notif.loaded = true;
    } catch {}
    try {
      const msg = await api('/messages/unread-count');
      const el = document.getElementById('nav-msg-count');
      if (el) {
        el.textContent = String(msg.unread);
        el.classList.toggle('hidden', !msg.unread);
      }
    } catch {}
  };
  pollNotif();
  notifTimer = setInterval(pollNotif, 30000);
}

function stopPolling() {
  if (notifTimer) clearInterval(notifTimer);
  notifTimer = null;
}

function updateBadges() {
  for (const id of ['top-notif-count', 'nav-notif-count']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.textContent = String(state.notif.unread);
    el.classList.toggle('hidden', !state.notif.unread);
  }
}

function accessDenied(required) {
  const view = document.getElementById('view');
  if (!view) return;
  view.innerHTML = String(html`
    <div class="alert alert-err">${icon('lock')}<div><strong>Accès refusé.</strong> Cette section nécessite une autorisation particulière${required ? ` (${required})` : ''}. Contactez le chef de département si vous pensez qu’il s’agit d’une erreur.</div></div>
    <a class="btn btn-secondary" href="#/accueil">${icon('arrow-left')} Retour à l’accueil</a>`);
}

async function render() {
  const { path, segments, query } = parseRoute();
  const isPublicRoute = PUBLIC_PATHS.includes(path) || path.startsWith('/reinitialisation');

  if (!state.user && !isPublicRoute) {
    sessionStorage.setItem('dc_return_to', path);
    renderPublicPage('/connexion');
    return;
  }
  if (state.user && ['/connexion', '/inscription', '/mot-de-passe-oublie'].includes(path)) {
    navigate('/accueil');
    return;
  }
  if (!state.user) {
    renderPublicPage(path, segments);
    return;
  }

  app.innerHTML = String(shell(path));
  bindShell();
  const view = document.getElementById('view');
  document.title = `${titleFor(path)} — ${state.settings.app_short || 'Département de Communication'}`;

  try {
    if (path === '/accueil') await renderDashboard(view);
    else if (path === '/annonces') await renderPublications(view, query);
    else if (segments[0] === 'annonces' && segments[1] === 'nouvelle') await renderPublicationEditor(view, null);
    else if (segments[0] === 'annonces' && segments[2] === 'modifier') await renderPublicationEditor(view, Number(segments[1]));
    else if (segments[0] === 'annonces' && segments[1]) await renderPublicationDetail(view, Number(segments[1]), query);
    else if (path === '/documents') await renderDocuments(view);
    else if (path === '/emplois-du-temps') await renderTimetables(view);
    else if (path === '/calendrier') await renderCalendar(view);
    else if (path === '/resultats') await renderResults(view);
    else if (path === '/demandes') await renderRequests(view);
    else if (path === '/messages' || segments[0] === 'messages') await renderMessages(view, segments[1] ? Number(segments[1]) : null);
    else if (path === '/vie-du-departement') await renderActivities(view);
    else if (path === '/notifications') await renderNotifications(view);
    else if (path === '/profil') await renderProfile(view);
    else if (path === '/admin/utilisateurs') { if (!can('users.view')) return accessDenied('users.view'); await renderAdminUsers(view); }
    else if (path === '/admin/roles') { if (!can('roles.manage')) return accessDenied('roles.manage'); await renderAdminRoles(view); }
    else if (path === '/admin/structure') { if (!can('structure.manage')) return accessDenied('structure.manage'); await renderAdminStructure(view); }
    else if (path === '/admin/statistiques') { if (!can('stats.view')) return accessDenied('stats.view'); await renderAdminStats(view); }
    else if (path === '/admin/journal') { if (!can('audit.view')) return accessDenied('audit.view'); await renderAdminAudit(view); }
    else if (path === '/admin/parametres') { if (!can('settings.manage')) return accessDenied('settings.manage'); await renderAdminSettings(view); }
    else if (path === '/admin/sauvegarde') { if (!can('backups.manage')) return accessDenied('backups.manage'); await renderAdminBackup(view); }
    else view.innerHTML = String(html`<div class="card card-pad">${icon('info')} Page introuvable. <a href="#/accueil">Revenir à l’accueil</a>.</div>`);
  } catch (err) {
    if (err?.status === 401) {
      state.user = null;
      stopPolling();
      toast(err.message || 'Votre session a expiré. Reconnectez-vous.', 'warning');
      renderPublicPage('/connexion');
      return;
    }
    view.innerHTML = String(html`
      <div class="alert alert-err">${icon('alert')}<div><strong>Impossible de charger cette page.</strong> ${err.message || 'Erreur inconnue.'}</div></div>
      <button class="btn btn-secondary" id="retry-render">${icon('refresh')} Réessayer</button>`);
    document.getElementById('retry-render')?.addEventListener('click', () => render());
  }
  window.scrollTo({ top: 0, behavior: 'auto' });
  view.focus({ preventScroll: true });
}

function renderPublicPage(path, segments = []) {
  if (path.startsWith('/reinitialisation')) return renderReset(app, segments[1] || '');
  if (path === '/connexion') return renderLogin(app);
  if (path === '/inscription') return renderRegister(app);
  if (path === '/mot-de-passe-oublie') return renderForgot(app);
  return renderLanding(app);
}

/* ------------------------------ Démarrage ------------------------------ */
async function boot() {
  try {
    await ensureData();
  } catch (err) {
    app.innerHTML = String(html`
      <div style="max-width:560px;margin:3rem auto;padding:1rem">
        <div class="alert alert-err">${icon('alert')}<div><strong>L’application ne peut pas démarrer.</strong> ${err.message}</div></div>
        <button class="btn btn-primary" onclick="location.reload()">${icon('refresh')} Recharger</button>
      </div>`);
    return;
  }
  if (state.user) startPolling();
  render();

  // Enregistrement du service worker (PWA) uniquement en HTTPS ou localhost
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

window.addEventListener('hashchange', () => render());
window.addEventListener('dcub:logged-in', () => { startPolling(); });
window.addEventListener('online', () => toast('Connexion rétablie.', 'success'));
window.addEventListener('offline', () => toast('Vous êtes hors connexion. Certaines actions ne fonctionneront pas.', 'warning'));
boot();
