import {
  state, api, html, icon, fmtDate, fmtDateTime, fmtTime, timeAgo, can, canAny,
  statusBadge, emptyState, loading, initials, academicYear,
} from '../api.js';

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Bonjour';
  if (h < 18) return 'Bon après-midi';
  return 'Bonsoir';
}

function pubMini(p) {
  return html`
    <a class="pub-card priority-${p.priority}" href="#/annonces/${p.id}">
      <div class="pub-top">
        ${p.category_name ? html`<span class="badge" style="background:${p.category_color}1a;color:${p.category_color}">${p.category_name}</span>` : html`<span class="badge badge-gris">Publication</span>`}
        ${p.priority !== 'normale' ? html`<span class="badge ${p.priority === 'urgente' ? 'badge-err' : 'badge-warn'}">${p.priority === 'urgente' ? 'Urgent' : 'Important'}</span>` : ''}
        <span class="muted tiny" style="margin-left:auto">${timeAgo(p.published_at || p.created_at)}</span>
      </div>
      <h3 class="pub-title">${p.title}</h3>
      <div class="pub-meta">
        <span>${icon('user')} ${p.author_name || 'Auteur'}</span>
        <span>${icon('eye')} ${p.view_count} vue(s)</span>
      </div>
    </a>`;
}

function completionItems() {
  const s = state.settings;
  const items = [];
  if (!String(s.presentation || '').trim()) items.push({ label: 'Rédiger la présentation officielle du département', href: '#/admin/parametres', action: 'Compléter' });
  if (!s.contact_email && !s.contact_phone && !s.contact_address) items.push({ label: 'Renseigner les coordonnées officielles (e-mail, téléphone, adresse)', href: '#/admin/parametres', action: 'Compléter' });
  if (!s.logo) items.push({ label: 'Ajouter le logo officiel', href: '#/admin/parametres', action: 'Ajouter' });
  if (!s.academic_year) items.push({ label: 'Indiquer l’année académique en cours', href: '#/admin/parametres', action: 'Compléter' });
  if (state.structure && !state.structure.levels.length) items.push({ label: 'Créer les niveaux d’études officiels', href: '#/admin/structure', action: 'Créer' });
  if (state.structure && !state.structure.parcours.length) items.push({ label: 'Créer les filières et parcours officiels', href: '#/admin/structure', action: 'Créer' });
  return items;
}

function heroSubtitle(u) {
  const role = u?.role_slug;
  if (role === 'chef') return 'Supervisez le département, validez les comptes et suivez les activités en un seul endroit.';
  if (role === 'secretariat') return 'Publiez les informations officielles, gérez les documents et traitez les demandes administratives.';
  if (role === 'enseignant') return 'Partagez vos cours et supports, publiez vos consignes et suivez la consultation de vos contenus.';
  if (role === 'responsable_niveau' || role === 'responsable_parcours') return 'Gérez les informations, documents et emplois du temps de votre périmètre académique.';
  if (role === 'etudiant') return 'Consultez les annonces, vos cours, vos emplois du temps et vos résultats officiels.';
  return 'Retrouvez les informations, documents et échanges de votre département en un seul endroit.';
}

export async function renderDashboard(root) {
  const u = state.user;
  root.innerHTML = String(html`
    <section class="hero-banner">
      <div class="hero-banner-main">
        <div class="hero-media${state.settings.cover ? ' has-photo' : state.settings.logo ? ' has-logo' : ''}">
          ${state.settings.cover
            ? html`<img src="${state.settings.cover.url}" alt="Photo de couverture du département">`
            : state.settings.logo
              ? html`<img src="${state.settings.logo.url}" alt="Logo du département">`
              : html`<span class="hero-media-mark" aria-hidden="true">${icon('building')}</span>`}
        </div>
        <div class="hero-copy">
          <div class="hero-eyebrow">Votre espace · ${academicYear()}</div>
          <h1 class="hero-title">${greeting()}, ${(u.full_name || '').split(' ')[0]} 👋</h1>
          <p class="hero-sub">${heroSubtitle(u)}</p>
        </div>
      </div>
      <div class="hero-cta">
        <a class="btn-hero" href="#/annonces">Voir les annonces</a>
        ${can('publications.create') ? html`<a class="btn-hero-ghost" href="#/annonces/nouvelle">${icon('plus')} Nouvelle publication</a>` : ''}
      </div>
    </section>

    ${state.settings.demo_mode ? html`<div class="alert alert-warn">${icon('alert')}<div><strong>Mode démonstration.</strong> Les données affichées sont fictives et destinées aux tests. Désactivez ce mode dans les paramètres avant la mise en service réelle.</div></div>` : ''}

    <div id="dash-stats" class="stat-grid">
      <div class="stat-card"><div class="stat-icon">${icon('bell')}</div><div class="stat-value">${state.notif.unread}</div><div class="stat-label">Notifications non lues</div></div>
      <div class="stat-card"><div class="stat-icon">${icon('shield')}</div><div class="stat-value stat-value-sm">${u.role_name}</div><div class="stat-label">Votre rôle</div><div class="stat-note">${u.level_id ? 'Niveau et parcours associés' : 'Compte départemental'}</div></div>
    </div>

    <div class="dash-grid">
      <div class="stack">
        <section class="card">
          <div class="card-head">
            <h2>${icon('megaphone')} Dernières annonces</h2>
            <a class="btn btn-ghost btn-sm" href="#/annonces">Tout voir ${icon('arrow-right')}</a>
          </div>
          <div class="card-body" id="dash-feed">${loading()}</div>
        </section>
        <section class="card">
          <div class="card-head">
            <h2>${icon('calendar')} Prochains événements</h2>
            <a class="btn btn-ghost btn-sm" href="#/calendrier">Calendrier ${icon('arrow-right')}</a>
          </div>
          <div class="card-body" id="dash-events">${loading()}</div>
        </section>
      </div>
      <aside class="stack">
        <section class="card">
          <div class="card-head"><h2>${icon('plus')} Accès rapides</h2></div>
          <div class="card-body">
            <div class="quick-actions">
              ${can('publications.create') ? html`<a class="quick-action" href="#/annonces/nouvelle">${icon('megaphone')} Publier une annonce</a>` : ''}
              ${can('documents.upload') ? html`<a class="quick-action" href="#/documents">${icon('folder')} Bibliothèque</a>` : html`<a class="quick-action" href="#/documents">${icon('folder')} Mes documents</a>`}
              ${can('timetables.manage') ? html`<a class="quick-action" href="#/emplois-du-temps">${icon('calendar')} Emplois du temps</a>` : html`<a class="quick-action" href="#/emplois-du-temps">${icon('calendar')} Mon emploi du temps</a>`}
              <a class="quick-action" href="#/demandes">${icon('book')} ${can('requests.manage') ? 'Demandes reçues' : 'Mes demandes'}</a>
              <a class="quick-action" href="#/messages">${icon('message')} Messagerie</a>
              <a class="quick-action" href="#/profil">${icon('settings')} Mon profil</a>
              ${can('users.view') ? html`<a class="quick-action" href="#/admin/utilisateurs">${icon('users')} Comptes</a>` : ''}
              ${can('stats.view') ? html`<a class="quick-action" href="#/admin/statistiques">${icon('chart')} Statistiques</a>` : ''}
            </div>
          </div>
        </section>
        <section class="card" id="dash-pending"></section>
        <section class="card" id="dash-completion"></section>
      </aside>
    </div>
  `);

  // Statistiques contextuelles
  const statsBox = document.getElementById('dash-stats');
  try {
    if (can('stats.view')) {
      const s = await api('/stats/overview');
      statsBox.innerHTML = String(html`
        <div class="stat-card"><div class="stat-icon">${icon('users')}</div><div class="stat-value">${s.byStatus.active}</div><div class="stat-label">Utilisateurs</div><div class="stat-note">${s.byStatus.pending} compte(s) à valider</div></div>
        <div class="stat-card"><div class="stat-icon">${icon('megaphone')}</div><div class="stat-value">${s.publications.published}</div><div class="stat-label">Publications</div><div class="stat-note">${s.publications.last30} ce mois</div></div>
        <div class="stat-card"><div class="stat-icon">${icon('folder')}</div><div class="stat-value">${s.documents.active}</div><div class="stat-label">Documents</div><div class="stat-note">dans la bibliothèque</div></div>
        <div class="stat-card"><div class="stat-icon">${icon('book')}</div><div class="stat-value">${s.requests.recue + s.requests.en_cours}</div><div class="stat-label">Demandes en attente</div><div class="stat-note">${s.requests.traitee} traitée(s)</div></div>`);
    } else {
      const [notif, docs, reqs, msg] = await Promise.all([
        api('/notifications/count').catch(() => ({ unread: state.notif.unread })),
        api('/documents?limit=1').catch(() => ({ total: 0 })),
        api('/requests?limit=1').catch(() => ({ total: 0, summary: {} })),
        api('/messages/unread-count').catch(() => ({ unread: 0 })),
      ]);
      statsBox.innerHTML = String(html`
        <div class="stat-card"><div class="stat-icon">${icon('bell')}</div><div class="stat-value">${notif.unread}</div><div class="stat-label">Notifications non lues</div><div class="stat-note"><a href="#/notifications">Consulter</a></div></div>
        <div class="stat-card"><div class="stat-label">Documents accessibles</div><div class="stat-value">${docs.total}</div><div class="stat-note"><a href="#/documents">Bibliothèque</a></div></div>
        <div class="stat-card"><div class="stat-label">Mes demandes</div><div class="stat-value">${reqs.total || 0}</div><div class="stat-note">${reqs.summary?.recue || 0} en attente de traitement</div></div>
        <div class="stat-card"><div class="stat-label">Messages non lus</div><div class="stat-value">${msg.unread}</div><div class="stat-note"><a href="#/messages">Messagerie</a></div></div>`);
    }
  } catch {
    statsBox.innerHTML = '';
  }

  // Fil des annonces
  const feed = document.getElementById('dash-feed');
  try {
    const data = await api('/publications?limit=4');
    if (!data.publications.length) {
      feed.innerHTML = String(html`<div class="empty" style="padding:1.4rem">${icon('megaphone')}<h3>Aucune annonce pour le moment</h3><p class="small">Les publications destinées à votre niveau ou à votre rôle apparaîtront ici.</p></div>`);
    } else {
      feed.innerHTML = String(html`<div class="pub-list">${data.publications.map(pubMini)}</div>`);
    }
  } catch (err) {
    feed.innerHTML = String(html`<div class="alert alert-err" style="margin:0">${icon('alert')}<div>${err.message}</div></div>`);
  }

  // Événements à venir
  const eventsBox = document.getElementById('dash-events');
  try {
    const from = new Date().toISOString();
    const data = await api(`/events?from=${encodeURIComponent(from)}`);
    const events = data.events.slice(0, 4);
    eventsBox.innerHTML = String(events.length
      ? html`${events.map((e) => html`
        <div class="event-item">
          <div class="event-date"><div class="d">${new Date(e.starts_at).getDate()}</div><div class="m">${new Date(e.starts_at).toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '')}</div></div>
          <div>
            <p class="event-title">${e.title}</p>
            <p class="event-meta">${fmtTime(e.starts_at)}${e.location ? ` · ${e.location}` : ''} ${e.level_name ? `· ${e.level_name}` : ''}</p>
          </div>
        </div>`)}`
      : String(html`<div class="empty" style="padding:1.2rem">${icon('calendar')}<h3>Aucun événement à venir</h3><p class="small">Les examens, soutenances et conférences validés apparaîtront ici.</p></div>`));
  } catch (err) {
    eventsBox.innerHTML = String(html`<div class="alert alert-err" style="margin:0">${icon('alert')}<div>${err.message}</div></div>`);
  }

  // En attente d'approbation (chef/secrétariat)
  if (can('users.approve')) {
    try {
      const pending = await api('/admin/pending-count');
      const box = document.getElementById('dash-pending');
      if (pending.pending > 0 || true) {
        box.innerHTML = String(html`
          <div class="card-head"><h2>${icon('users')} Inscriptions</h2></div>
          <div class="card-body">
            ${pending.pending > 0
              ? html`<p class="mb1"><strong>${pending.pending}</strong> demande(s) de compte en attente de validation.</p>
                     <a class="btn btn-gold btn-sm" href="#/admin/utilisateurs?status=pending">Traiter les demandes</a>`
              : html`<p class="small muted mb0">Aucune demande en attente. Les nouveaux comptes validés apparaîtront dans la liste des utilisateurs.</p>`}
          </div>`);
      }
    } catch {}
  }

  // Informations à compléter (direction)
  if (can('settings.manage') || can('structure.manage')) {
    const items = completionItems();
    const box = document.getElementById('dash-completion');
    box.innerHTML = String(html`
      <div class="card-head"><h2>${icon('info')} Informations à compléter</h2></div>
      <div class="card-body">
        ${items.length
          ? html`<ul style="margin:0;padding-left:1.1rem">${items.map((i) => html`<li style="margin-bottom:.45rem;font-size:.87rem">${i.label} <a href="${i.href}" class="nowrap">${i.action}</a></li>`)}</ul>
                 <p class="hint mt2 mb0">Le document de référence fourni est un cahier technique : il ne contient pas la structure officielle du Département de Communication. Ces informations doivent être saisies par la direction.</p>`
          : html`<p class="small muted mb0">Les informations institutionnelles essentielles sont renseignées.</p>`}
      </div>`);
  }
}
