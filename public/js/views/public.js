import {
  state, api, html, icon, esc, modal, fmtDate, fmtDateTime, toast, navigate, loading,
  statusBadge, fileUrl, fileSize,
} from '../api.js';

const LOGO = () => (state.settings.logo ? state.settings.logo.url : '/icons/icon-192.png');

export function publicHeader(active = '') {
  return html`
  <header class="topbar">
    <div class="topbar-inner">
      <a class="brand" href="#/" aria-label="Accueil">
        <img class="brand-logo" src="${LOGO()}" alt="">
        <div class="brand-text">
          <div class="brand-title">${state.settings.app_short || 'Département de Communication'}</div>
          <div class="brand-sub">${state.settings.institution || 'Université de Bouaké'}</div>
        </div>
      </a>
      <nav class="nav-links" aria-label="Navigation publique">
        <a href="#/" class="${active === 'accueil' ? 'active' : ''}">Accueil</a>
        <a href="#/" data-scroll="annonces">Annonces</a>
        <a href="#/" data-scroll="filieres">Filières & parcours</a>
        <a href="#/" data-scroll="documents-publics">Documents</a>
        <a href="#/" data-scroll="vie-departement">Vie du département</a>
        <a href="#/" data-scroll="contact">Contact</a>
        ${state.user
          ? html`<a href="#/accueil" class="btn btn-primary btn-sm" style="margin-left:.4rem">Mon espace</a>`
          : html`<a href="#/connexion" class="btn btn-secondary btn-sm" style="margin-left:.4rem">Connexion</a>
              ${state.settings.registration_open ? html`<a href="#/inscription" class="btn btn-primary btn-sm">Créer un compte</a>` : ''}`}
      </nav>
    </div>
  </header>`;
}

export function publicFooter() {
  return html`
  <footer class="footer">
    <div class="footer-inner">
      <div>
        <h4>${state.settings.app_short || 'Département de Communication'}</h4>
        <p style="margin-bottom:.5rem">${state.settings.institution || 'Université de Bouaké'} — Côte d’Ivoire.</p>
        <p style="font-size:.8rem;color:#93a7bc">Espace numérique de communication, de documentation et de démarches du département. Les informations officielles sont publiées et actualisées par la direction.</p>
      </div>
      <div>
        <h4>Accès rapides</h4>
        <p style="margin:.25rem 0"><a href="#/connexion">Connexion</a></p>
        ${state.settings.registration_open ? html`<p style="margin:.25rem 0"><a href="#/inscription">Créer un compte</a></p>` : ''}
        <p style="margin:.25rem 0"><a href="#/mot-de-passe-oublie">Mot de passe oublié</a></p>
      </div>
      <div>
        <h4>Informations</h4>
        ${state.settings.contact_email ? html`<p style="margin:.25rem 0">${state.settings.contact_email}</p>` : ''}
        ${state.settings.contact_phone ? html`<p style="margin:.25rem 0">${state.settings.contact_phone}</p>` : ''}
        ${state.settings.academic_year ? html`<p style="margin:.25rem 0">Année académique ${state.settings.academic_year}</p>` : ''}
        <p style="margin:.25rem 0;font-size:.78rem;color:#93a7bc">${state.settings.footer_note || ''}</p>
      </div>
    </div>
    <div class="footer-bottom">© ${new Date().getFullYear()} ${state.settings.institution || 'Université de Bouaké'} · ${state.settings.app_short || 'Département de Communication'} · Application sécurisée</div>
  </footer>`;
}

function presentationText() {
  const p = String(state.settings.presentation || '').trim();
  if (p) return p.length > 420 ? `${p.slice(0, 420)}…` : p;
  return "Cet espace numérique centralise les annonces officielles, les documents pédagogiques, les emplois du temps, les résultats et les démarches administratives du département. La présentation officielle du département sera publiée par sa direction.";
}

export async function renderLanding(root) {
  root.innerHTML = String(html`${publicHeader('accueil')}
    <main>
      <section class="hero">
        <div class="hero-inner">
          <div>
            <div class="hero-kicker">${icon('globe')} ${state.settings.institution || 'Université de Bouaké'} · Côte d’Ivoire</div>
            <h1 class="hero-title">${state.settings.app_name || 'Département de Communication — Université de Bouaké'}</h1>
            <p class="hero-sub">${presentationText()}</p>
            <div class="hero-actions">
              ${state.user
                ? html`<a href="#/accueil" class="btn btn-gold">${icon('home')} Ouvrir mon espace</a>`
                : html`<a href="#/connexion" class="btn btn-gold">${icon('lock')} Se connecter</a>
                    ${state.settings.registration_open ? html`<a href="#/inscription" class="btn btn-secondary">${icon('user')} Créer un compte</a>` : ''}`}
              <a href="#/" data-scroll="annonces" class="btn btn-ghost" style="color:#fff">${icon('megaphone')} Voir les annonces</a>
            </div>
          </div>
          <aside class="hero-panel" aria-label="Services de la plateforme">
            <h3>Votre espace départemental</h3>
            <div class="hero-list">
              <div class="hero-list-item">${icon('megaphone')}<span>Annonces administratives et pédagogiques ciblées</span></div>
              <div class="hero-list-item">${icon('folder')}<span>Documents, supports de cours et calendriers</span></div>
              <div class="hero-list-item">${icon('award')}<span>Résultats protégés et consultés selon vos droits</span></div>
              <div class="hero-list-item">${icon('message')}<span>Messagerie interne et demandes administratives</span></div>
            </div>
          </aside>
        </div>
      </section>

      <section class="section">
        <div class="landing-grid">
          <div class="feature">${icon('users')}<h3>Une communication ciblée</h3><p>Chaque publication est adressée aux niveaux, parcours, groupes ou rôles concernés, avec notifications et suivi des consultations.</p></div>
          <div class="feature">${icon('folder')}<h3>Documents et pédagogie</h3><p>Retrouvez les supports de cours, notes administratives, calendriers et emplois du temps dans une bibliothèque organisée et protégée.</p></div>
          <div class="feature">${icon('shield')}<h3>Données protégées</h3><p>Les comptes sont validés par l’administration. Les résultats, messages et fichiers privés ne sont accessibles qu’aux personnes autorisées.</p></div>
        </div>
      </section>

      <section class="section section-alt" id="annonces">
        <div class="section-head">
          <div>
            <h2 class="section-title">Annonces publiques</h2>
            <p class="section-sub">Informations publiées par la direction du département à l’attention du public.</p>
          </div>
        </div>
        <div id="public-announcements">${loading()}</div>
      </section>

      ${state.modules.documents !== false ? html`
      <section class="section" id="documents-publics">
        <div class="section-head">
          <div>
            <h2 class="section-title">Documents publics</h2>
            <p class="section-sub">Notes administratives, calendriers et documents destinés au public.</p>
          </div>
        </div>
        <div id="public-documents">${loading()}</div>
      </section>` : ''}

      ${state.modules.timetables !== false ? html`
      <section class="section section-alt" id="agenda">
        <div class="section-head">
          <div>
            <h2 class="section-title">Agenda du département</h2>
            <p class="section-sub">Examens, soutenances, conférences et réunions ouverts au public.</p>
          </div>
        </div>
        <div id="public-events">${loading()}</div>
      </section>` : ''}

      <section class="section" id="filieres">
        <div class="section-head">
          <div>
            <h2 class="section-title">Filières, parcours et niveaux</h2>
            <p class="section-sub">Structure académique officielle publiée par la direction du département.</p>
          </div>
        </div>
        <div id="public-structure">${loading()}</div>
      </section>

      ${state.modules.activities !== false ? html`
      <section class="section section-alt" id="vie-departement">
        <div class="section-head">
          <div>
            <h2 class="section-title">Vie du département</h2>
            <p class="section-sub">Recherche, conférences, ateliers, soutenances, partenariats et stages publiés par le département.</p>
          </div>
        </div>
        <div id="public-activities">${loading()}</div>
      </section>` : ''}

      <section class="section" id="contact">
        <div class="section-head">
          <div>
            <h2 class="section-title">Contact et informations administratives</h2>
            <p class="section-sub">Coordonnées officielles du département.</p>
          </div>
        </div>
        <div id="public-contact"></div>
      </section>
    </main>
    ${publicFooter()}`);

  root.querySelectorAll('[data-scroll]').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById(link.dataset.scroll)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  // Annonces publiques
  const annBox = document.getElementById('public-announcements');
  try {
    const data = await api('/public/announcements?limit=6');
    if (!data.announcements.length) {
      annBox.innerHTML = String(html`<div class="empty">${icon('megaphone')}<h3>Aucune annonce publique</h3><p>Les annonces destinées au public seront affichées ici dès leur publication par la direction.</p></div>`);
    } else {
      annBox.innerHTML = String(html`<div class="pub-list">
        ${data.announcements.map((a) => html`
          <article class="pub-card priority-${a.priority}" data-announcement="${a.id}" role="button" tabindex="0" style="cursor:pointer">
            <div class="pub-top">
              ${a.category_name ? html`<span class="badge" style="background:${a.category_color}1a;color:${a.category_color}">${a.category_name}</span>` : ''}
              ${a.pinned ? html`<span class="badge badge-or">${icon('pin')} Épinglée</span>` : ''}
              <span class="muted tiny" style="margin-left:auto">${fmtDate(a.published_at)}</span>
            </div>
            <h3 class="pub-title">${a.title}</h3>
            <p class="pub-excerpt">${a.excerpt}</p>
            <div class="pub-meta"><span>${icon('megaphone')} Lire l’annonce</span></div>
          </article>`)}
      </div>`);
      const open = async (id) => {
        try {
          const detail = await api(`/public/announcements/${id}`);
          const p = detail.publication;
          modal({
            title: p.title,
            wide: true,
            body: html`
              <div class="pub-meta mb2">
                ${p.category_name ? html`<span class="badge">${p.category_name}</span>` : ''}
                <span>${icon('calendar')} ${fmtDate(p.published_at)}</span>
                <span>${icon('user')} ${p.author_name}</span>
              </div>
              <div class="body-text">${p.body}</div>
              ${p.files?.length ? html`<div class="mt2"><strong class="small">Pièces jointes</strong>
                ${p.files.map((f) => html`<a class="attachment" href="${fileUrl(f.id)}" target="_blank" rel="noopener">${icon('file')}<span class="name">${f.filename}</span><span class="muted tiny">${fileSize(f.size)}</span>${icon('download')}</a>`)}
              </div>` : ''}`,
            footer: html`<a href="#/connexion" class="btn btn-secondary">Se connecter pour plus d’informations</a>`,
          });
        } catch (err) {
          toast(err.message, 'error');
        }
      };
      annBox.querySelectorAll('[data-announcement]').forEach((card) => {
        card.addEventListener('click', () => open(card.dataset.announcement));
        card.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(card.dataset.announcement); }
        });
      });
    }
  } catch (err) {
    annBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>${err.message}</div></div>`);
  }

  // Structure académique
  const stBox = document.getElementById('public-structure');
  try {
    const st = await api('/structure');
    const hasContent = st.levels.length || st.parcours.length;
    if (!hasContent) {
      stBox.innerHTML = String(html`<div class="alert alert-info">${icon('info')}<div>
        La structure officielle (filières, parcours et niveaux) n’a pas encore été publiée par la direction du département.
        Elle sera affichée ici dès sa validation. Pour toute question, utilisez la rubrique contact ou le secrétariat.
      </div></div>`);
    } else {
      stBox.innerHTML = String(html`
        ${st.parcours.length ? html`<div class="grid cols-2">
          ${st.parcours.map((p) => html`
            <div class="path-card">
              <h3>${p.name}</h3>
              ${p.description ? html`<p class="small muted" style="margin:0">${p.description}</p>` : ''}
              <div class="levels">
                ${st.levels.filter((l) => p.level_ids.includes(l.id)).map((l) => html`<span class="chip">${icon('graduation')} ${l.name}</span>`)}
              </div>
            </div>`)}
        </div>` : html`<div class="grid cols-3">
          ${st.levels.map((l) => html`<div class="path-card"><h3>${l.name}</h3>${l.description ? html`<p class="small muted" style="margin:0">${l.description}</p>` : ''}</div>`)}
        </div>`}
        ${st.levels.length ? html`<p class="hint mt2">Niveaux proposés : ${st.levels.map((l) => l.name).join(' · ')}</p>` : ''}
      `);
    }
  } catch (err) {
    stBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>Structure indisponible : ${err.message}</div></div>`);
  }

  // Documents publics
  const docBox = document.getElementById('public-documents');
  if (docBox) {
    try {
      const data = await api('/public/documents');
      docBox.innerHTML = String(data.documents.length
        ? html`<div class="grid cols-2">
            ${data.documents.map((d) => html`
              <div class="card card-pad">
                <div class="pub-top"><span class="badge">${d.category}</span><span class="muted tiny" style="margin-left:auto">${fmtDate(d.created_at)}</span></div>
                <h3 style="margin:.45rem 0 0;font-size:1.02rem">${d.title}</h3>
                ${d.description ? html`<p class="small muted" style="margin:.3rem 0 .7rem">${d.description}</p>` : ''}
                <a class="attachment" href="${fileUrl(d.file_id)}" target="_blank" rel="noopener">
                  ${icon('file')}<span class="name">${d.filename}</span><span class="muted tiny">${fileSize(d.size)}</span>${icon('download')}
                </a>
              </div>`)}
          </div>`
        : html`<div class="empty">${icon('folder')}<h3>Aucun document public</h3><p>Les documents rendus publics par la direction seront affichés ici.</p></div>`);
    } catch (err) {
      docBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>${err.message}</div></div>`);
    }
  }

  // Agenda public
  const eventBox = document.getElementById('public-events');
  if (eventBox) {
    try {
      const data = await api('/public/events');
      eventBox.innerHTML = String(data.events.length
        ? html`<div class="stack">
            ${data.events.map((e) => html`
              <div class="card card-pad flex between" style="align-items:flex-start;gap:1rem">
                <div>
                  <div class="pub-top"><span class="badge badge-gris">${e.type}</span></div>
                  <h3 style="margin:.35rem 0 0;font-size:1rem">${e.title}</h3>
                  <div class="pub-meta"><span>${icon('calendar')} ${fmtDateTime(e.starts_at)}</span>${e.location ? html`<span>${icon('map-pin')} ${e.location}</span>` : ''}</div>
                </div>
              </div>`)}
          </div>`
        : html`<div class="empty">${icon('calendar')}<h3>Aucun événement public à venir</h3><p>Le calendrier public sera complété par la direction du département.</p></div>`);
    } catch (err) {
      eventBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>${err.message}</div></div>`);
    }
  }

  // Vie du département
  const actBox = document.getElementById('public-activities');
  if (actBox) {
    const CATEGORY_LABELS = {
      recherche: 'Recherche', publication_scientifique: 'Publication scientifique', conference: 'Conférence',
      seminaire: 'Séminaire', atelier: 'Atelier', soutenance: 'Soutenance', partenariat: 'Partenariat',
      association: 'Association', stage: 'Stage', opportunite: 'Opportunité', autre: 'Activité',
    };
    try {
      const data = await api('/public/activities');
      actBox.innerHTML = String(data.activities.length
        ? html`<div class="grid cols-2">
            ${data.activities.map((a) => html`
              <div class="card card-pad">
                <div class="pub-top"><span class="badge">${CATEGORY_LABELS[a.category] || a.category}</span>${a.date_start ? html`<span class="muted tiny" style="margin-left:auto">${fmtDate(a.date_start)}</span>` : ''}</div>
                <h3 style="margin:.45rem 0 .3rem;font-size:1.02rem">${a.title}</h3>
                ${a.description ? html`<p class="small muted" style="margin:0 0 .5rem">${a.description.length > 220 ? `${a.description.slice(0, 220)}…` : a.description}</p>` : ''}
                <div class="pub-meta">${a.organizer ? html`<span>${icon('users')} ${a.organizer}</span>` : ''}${a.location ? html`<span>${icon('map-pin')} ${a.location}</span>` : ''}${a.link ? html`<a href="${a.link}" target="_blank" rel="noopener">${icon('link')} En savoir plus</a>` : ''}</div>
              </div>`)}
          </div>`
        : html`<div class="empty">${icon('graduation')}<h3>Aucune activité publiée</h3><p>Les conférences, ateliers, soutenances et partenariats seront publiés ici par le département.</p></div>`);
    } catch (err) {
      actBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>${err.message}</div></div>`);
    }
  }

  // Contact
  const contactBox = document.getElementById('public-contact');
  const s = state.settings;
  const hasContact = s.contact_email || s.contact_phone || s.contact_address || s.contact_hours;
  contactBox.innerHTML = String(hasContact
    ? html`<div class="contact-grid">
        <div class="card card-pad">
          <div class="contact-item">${icon('mail')}<div><strong>E-mail</strong>${s.contact_email || 'Non renseigné'}</div></div>
          <div class="contact-item">${icon('phone')}<div><strong>Téléphone</strong>${s.contact_phone || 'Non renseigné'}</div></div>
          <div class="contact-item">${icon('map-pin')}<div><strong>Adresse</strong>${s.contact_address || 'Non renseignée'}</div></div>
          <div class="contact-item">${icon('clock')}<div><strong>Horaires</strong>${s.contact_hours || 'Non renseignés'}</div></div>
        </div>
        <div class="card card-pad">
          <h3>${state.settings.institution || 'Université de Bouaké'}</h3>
          <p class="small muted">Les demandes administratives peuvent également être transmises depuis votre espace personnel après connexion, avec un numéro de référence et un suivi de traitement.</p>
          <a href="#/connexion" class="btn btn-secondary btn-sm">${icon('message')} Accéder à mes demandes</a>
        </div>
      </div>`
    : html`<div class="alert alert-info">${icon('info')}<div>
        Les coordonnées officielles du département (e-mail, téléphone, adresse, horaires) n’ont pas encore été renseignées.
        Elles sont administrées par la direction et apparaîtront ici dès leur publication.
      </div></div>`);
}

/* ------------------------------ Pages d'authentification ------------------------------ */
function authShell(inner) {
  return html`${publicHeader('')}
  <div class="auth-wrap" style="min-height:calc(100vh - 72px)">
    <aside class="auth-side">
      <div class="auth-side-inner">
        <div class="hero-kicker">${icon('shield')} Espace sécurisé</div>
        <h2>Un espace numérique au service de la communauté universitaire.</h2>
        <p>Annonces, documents, emplois du temps, résultats et démarches : tout le département réuni dans une plateforme fiable.</p>
        <div class="auth-points">
          <div class="auth-point">${icon('check-circle')}<span>Comptes vérifiés et validés par l’administration</span></div>
          <div class="auth-point">${icon('check-circle')}<span>Notifications ciblées selon votre niveau et votre parcours</span></div>
          <div class="auth-point">${icon('check-circle')}<span>Documents et résultats protégés selon vos droits</span></div>
          <div class="auth-point">${icon('check-circle')}<span>Demandes administratives avec suivi et référence</span></div>
        </div>
      </div>
      <p style="font-size:.78rem;color:#a9bed4;position:relative;z-index:1">${state.settings.app_name || 'Département de Communication — Université de Bouaké'}</p>
    </aside>
    <main class="auth-main">
      <div class="auth-card">${inner}</div>
    </main>
  </div>`;
}

function authBrand() {
  return html`<a class="brand" href="#/">
    <img class="brand-logo" src="${LOGO()}" alt="">
    <div class="brand-text">
      <div class="brand-title">${state.settings.app_short || 'Département de Communication'}</div>
      <div class="brand-sub">${state.settings.institution || 'Université de Bouaké'}</div>
    </div>
  </a>`;
}

function noticeBox() {
  if (!state.authNotice) return '';
  const message = state.authNotice;
  state.authNotice = null;
  return html`<div class="alert alert-warn">${icon('alert')}<div>${message}</div></div>`;
}

export function renderLogin(root) {
  root.innerHTML = String(authShell(html`
    ${authBrand()}
    <h1>Connexion</h1>
    <p class="lead">Accédez à votre espace personnel avec votre numéro de téléphone.</p>
    ${noticeBox()}
    <div id="login-error"></div>
    <form id="login-form" novalidate>
      <div class="field">
        <label class="label" for="login-phone">Numéro de téléphone <span class="req">*</span></label>
        <input class="input" id="login-phone" name="phone" type="tel" inputmode="tel" autocomplete="username" placeholder="Ex. +225 07 00 00 00 00" required>
      </div>
      <div class="field">
        <label class="label" for="login-password">Mot de passe (6 chiffres) <span class="req">*</span></label>
        <div class="pw-wrap">
          <input class="input" id="login-password" name="password" type="password" inputmode="numeric" pattern="\\d{6}" maxlength="6" autocomplete="current-password" required aria-describedby="login-pw-hint">
          <button type="button" class="btn btn-icon pw-toggle" data-toggle-pw="login-password" aria-label="Afficher le mot de passe" aria-pressed="false">${icon('eye')}</button>
        </div>
        <div class="hint" id="login-pw-hint">Exactement 6 chiffres.</div>
      </div>
      <button class="btn btn-primary btn-block" type="submit" id="login-submit">${icon('lock')} Se connecter</button>
    </form>
    <div class="auth-links">
      <a href="#/mot-de-passe-oublie">Mot de passe oublié ?</a>
      ${state.settings.registration_open ? html`<a href="#/inscription">Créer un compte</a>` : html`<span class="muted small">Inscriptions fermées</span>`}
    </div>
    ${state.settings.require_approval ? html`<div class="alert alert-info mt2" style="margin-bottom:0">${icon('info')}<div class="small">Les nouvelles inscriptions sont validées par le secrétariat avant la première connexion.</div></div>` : ''}
    <div class="auth-foot">${state.settings.app_name || 'Département de Communication — Université de Bouaké'}<br>${state.settings.contact_email || ''}</div>
  `));
  bindPasswordToggles(root);
  const form = document.getElementById('login-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('login-error');
    errBox.innerHTML = '';
    const phone = form.phone.value.trim();
    const password = form.password.value;
    if (!phone) return (errBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>Indiquez votre numéro de téléphone.</div></div>`));
    if (!/^\d{6}$/.test(password)) return (errBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>Le mot de passe doit contenir exactement 6 chiffres.</div></div>`));
    const btn = document.getElementById('login-submit');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner spinner-sm"></span> Connexion…';
    try {
      const data = await api('/auth/login', { method: 'POST', body: { phone, password } });
      state.user = data.user;
      state.csrf = data.csrf_token;
      state.permissions = data.permissions || [];
      state.settings = data.settings || state.settings;
      state.modules = data.settings?.modules || {};
      state.notif.loaded = false;
      window.dispatchEvent(new CustomEvent('dcub:logged-in'));
      toast(`Bienvenue, ${data.user.full_name}.`, 'success');
      const returnTo = sessionStorage.getItem('dc_return_to') || '/accueil';
      sessionStorage.removeItem('dc_return_to');
      navigate(returnTo);
      if (location.hash === `#${returnTo}`) window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch (err) {
      errBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>${err.message}</div></div>`);
      btn.disabled = false;
      btn.innerHTML = `${icon('lock')} Se connecter`;
    }
  });
}

export function bindPasswordToggles(root) {
  root.querySelectorAll('[data-toggle-pw]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.togglePw);
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-pressed', String(show));
      btn.setAttribute('aria-label', show ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
      btn.innerHTML = String(icon(show ? 'volume-off' : 'eye'));
      input.focus({ preventScroll: true });
    });
  });
}

export function renderRegister(root) {
  const structure = state.structure || { levels: [], parcours: [] };
  const closed = !state.settings.registration_open;
  root.innerHTML = String(authShell(html`
    ${authBrand()}
    <h1>Créer un compte</h1>
    <p class="lead">Votre compte sera associé à votre rôle, votre niveau et votre parcours.</p>
    ${closed ? html`<div class="alert alert-warn">${icon('lock')}<div>Les inscriptions sont actuellement fermées. Contactez le secrétariat du département.</div></div>` : ''}
    <div id="register-error"></div>
    <div id="register-success"></div>
    <form id="register-form" novalidate ${closed ? 'hidden' : ''}>
      <div class="role-choice" role="radiogroup" aria-label="Profil">
        <label class="selected" data-role-label="etudiant"><input type="radio" name="profile" value="etudiant" checked><span><strong>Étudiant</strong><span class="tiny muted">Niveau et parcours requis</span></span></label>
        <label data-role-label="enseignant"><input type="radio" name="profile" value="enseignant"><span><strong>Enseignant</strong><span class="tiny muted">Compte validé par la direction</span></span></label>
      </div>
      <div class="field">
        <label class="label" for="reg-name">Nom complet <span class="req">*</span></label>
        <input class="input" id="reg-name" name="full_name" autocomplete="name" required placeholder="Prénom et nom">
      </div>
      <div class="field">
        <label class="label" for="reg-phone">Numéro de téléphone <span class="req">*</span></label>
        <input class="input" id="reg-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" required placeholder="Ex. +225 07 00 00 00 00">
        <div class="hint">Ce numéro sera votre identifiant de connexion.</div>
      </div>
      <div class="field">
        <label class="label" for="reg-email">Adresse e-mail <span class="muted small">(facultatif)</span></label>
        <input class="input" id="reg-email" name="email" type="email" autocomplete="email" placeholder="nom@exemple.com">
      </div>
      <div id="student-fields">
        <div class="form-grid">
          <div class="field">
            <label class="label" for="reg-level">Niveau <span class="req">*</span></label>
            <select class="select" id="reg-level" name="level_id">
              <option value="">Choisir un niveau…</option>
              ${structure.levels.map((l) => html`<option value="${l.id}">${l.name}</option>`)}
            </select>
            ${!structure.levels.length ? html`<div class="hint" style="color:var(--warn)">La structure académique n’est pas encore publiée : contactez le secrétariat pour créer votre compte.</div>` : ''}
          </div>
          <div class="field">
            <label class="label" for="reg-parcours">Parcours <span class="muted small">(si applicable)</span></label>
            <select class="select" id="reg-parcours" name="parcours_id"><option value="">Aucun / non précisé</option></select>
          </div>
          <div class="field">
            <label class="label" for="reg-group">Groupe / promotion</label>
            <input class="input" id="reg-group" name="group_name" placeholder="Ex. Groupe A">
          </div>
          <div class="field">
            <label class="label" for="reg-matricule">Matricule</label>
            <input class="input" id="reg-matricule" name="matricule" placeholder="Numéro d’étudiant">
          </div>
        </div>
      </div>
      <div class="form-grid">
        <div class="field">
          <label class="label" for="reg-password">Mot de passe (6 chiffres) <span class="req">*</span></label>
          <div class="pw-wrap">
            <input class="input" id="reg-password" name="password" type="password" inputmode="numeric" maxlength="6" pattern="\\d{6}" autocomplete="new-password" required>
            <button type="button" class="btn btn-icon pw-toggle" data-toggle-pw="reg-password" aria-label="Afficher le mot de passe" aria-pressed="false">${icon('eye')}</button>
          </div>
        </div>
        <div class="field">
          <label class="label" for="reg-confirm">Confirmer le mot de passe <span class="req">*</span></label>
          <div class="pw-wrap">
            <input class="input" id="reg-confirm" name="password_confirm" type="password" inputmode="numeric" maxlength="6" pattern="\\d{6}" autocomplete="new-password" required>
            <button type="button" class="btn btn-icon pw-toggle" data-toggle-pw="reg-confirm" aria-label="Afficher la confirmation" aria-pressed="false">${icon('eye')}</button>
          </div>
        </div>
      </div>
      ${state.settings.signup_help ? html`<div class="alert alert-info">${icon('info')}<div>${state.settings.signup_help}</div></div>` : ''}
      <button class="btn btn-primary btn-block" type="submit" id="reg-submit" ${!structure.levels.length ? 'disabled' : ''}>${icon('user')} Créer mon compte</button>
      <div class="auth-links"><a href="#/connexion">J’ai déjà un compte</a></div>
    </form>
    <div class="auth-foot">En créant un compte, vous acceptez que vos données soient utilisées pour la gestion pédagogique et administrative du département.</div>
  `));

  if (closed) return;
  bindPasswordToggles(root);
  const form = document.getElementById('register-form');
  const levelSelect = document.getElementById('reg-level');
  const parcoursSelect = document.getElementById('reg-parcours');
  const errorBox = document.getElementById('register-error');

  const refreshParcours = () => {
    const levelId = Number(levelSelect.value);
    const list = structure.parcours.filter((p) => !levelId || !p.level_ids?.length || p.level_ids.includes(levelId));
    parcoursSelect.innerHTML = `<option value="">Aucun / non précisé</option>` +
      list.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  };
  levelSelect.addEventListener('change', refreshParcours);
  refreshParcours();

  form.querySelectorAll('input[name="profile"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      form.querySelectorAll('[data-role-label]').forEach((label) => label.classList.toggle('selected', label.querySelector('input').checked));
      document.getElementById('student-fields').classList.toggle('hidden', radio.value !== 'etudiant' && radio.checked);
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.innerHTML = '';
    const profile = form.querySelector('input[name="profile"]:checked').value;
    const password = form.password.value;
    const confirm = form.password_confirm.value;
    if (password !== confirm) {
      return (errorBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>Les mots de passe ne correspondent pas.</div></div>`));
    }
    if (!/^\d{6}$/.test(password)) {
      return (errorBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>Le mot de passe doit contenir exactement 6 chiffres.</div></div>`));
    }
    if (profile === 'etudiant' && !form.level_id.value) {
      return (errorBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>Choisissez votre niveau.</div></div>`));
    }
    const btn = document.getElementById('reg-submit');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner spinner-sm"></span> Enregistrement…';
    try {
      const data = await api('/auth/register', {
        method: 'POST',
        body: {
          full_name: form.full_name.value,
          phone: form.phone.value,
          email: form.email.value,
          profile,
          level_id: profile === 'etudiant' ? form.level_id.value : '',
          parcours_id: profile === 'etudiant' ? form.parcours_id.value : '',
          group_name: form.group_name.value,
          matricule: form.matricule.value,
          password,
          password_confirm: confirm,
        },
      });
      if (data.user) {
        state.user = data.user;
        state.csrf = data.csrf_token;
        state.permissions = data.permissions || [];
        state.settings = data.settings || state.settings;
        window.dispatchEvent(new CustomEvent('dcub:logged-in'));
        toast('Votre compte est créé. Bienvenue !', 'success');
        navigate('/accueil');
        return;
      }
      form.classList.add('hidden');
      document.getElementById('register-success').innerHTML = String(html`
        <div class="alert alert-ok">${icon('check-circle')}<div><strong>Demande enregistrée.</strong><br>${data.message}</div></div>
        <a class="btn btn-primary btn-block" href="#/connexion">Aller à la connexion</a>`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      errorBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>${err.message}</div></div>`);
      btn.disabled = false;
      btn.innerHTML = `${icon('user')} Créer mon compte`;
      window.scrollTo({ top: errorBox.offsetTop - 80, behavior: 'smooth' });
    }
  });
}

export function renderForgot(root) {
  root.innerHTML = String(authShell(html`
    ${authBrand()}
    <h1>Mot de passe oublié</h1>
    <p class="lead">Indiquez le numéro associé à votre compte. Une demande de récupération sera transmise au secrétariat.</p>
    <div id="forgot-result"></div>
    <form id="forgot-form" novalidate>
      <div class="field">
        <label class="label" for="forgot-phone">Numéro de téléphone <span class="req">*</span></label>
        <input class="input" id="forgot-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" required placeholder="Ex. +225 07 00 00 00 00">
      </div>
      <button class="btn btn-primary btn-block" type="submit" id="forgot-submit">${icon('key')} Envoyer la demande</button>
    </form>
    <div class="auth-links"><a href="#/connexion">← Retour à la connexion</a></div>
    <div class="alert alert-info mt2">${icon('info')}<div class="small">Aucun code SMS automatique n’est envoyé : la réinitialisation est vérifiée par le secrétariat, qui remet un lien sécurisé valable une heure.</div></div>
  `));
  const form = document.getElementById('forgot-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('forgot-submit');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner spinner-sm"></span> Envoi…';
    try {
      const data = await api('/auth/forgot-password', { method: 'POST', body: { phone: form.phone.value } });
      document.getElementById('forgot-result').innerHTML = String(html`<div class="alert alert-ok">${icon('check-circle')}<div>${data.message}</div></div>`);
      form.classList.add('hidden');
    } catch (err) {
      document.getElementById('forgot-result').innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>${err.message}</div></div>`);
      btn.disabled = false;
      btn.innerHTML = `${icon('key')} Envoyer la demande`;
    }
  });
}

export async function renderReset(root, token) {
  root.innerHTML = String(authShell(html`${authBrand()}<div class="loader"><span class="spinner"></span> Vérification du lien…</div>`));
  if (!token) {
    document.querySelector('.auth-card').innerHTML = String(html`${authBrand()}<div class="alert alert-err">${icon('alert')}<div>Lien de réinitialisation incomplet.</div></div><a class="btn btn-secondary" href="#/connexion">Retour à la connexion</a>`);
    return;
  }
  let info;
  try {
    info = await api(`/auth/reset/${encodeURIComponent(token)}`);
  } catch (err) {
    document.querySelector('.auth-card').innerHTML = String(html`${authBrand()}
      <div class="alert alert-err">${icon('alert')}<div>${err.message}</div></div>
      <a class="btn btn-secondary btn-block" href="#/connexion">Retour à la connexion</a>`);
    return;
  }
  const card = document.querySelector('.auth-card');
  card.innerHTML = String(html`
    ${authBrand()}
    <h1>Nouveau mot de passe</h1>
    <p class="lead">Compte : ${info.full_name} · ${info.phone}</p>
    <div id="reset-error"></div>
    <form id="reset-form" novalidate>
      <div class="form-grid">
        <div class="field">
          <label class="label" for="reset-password">Nouveau mot de passe <span class="req">*</span></label>
          <div class="pw-wrap">
            <input class="input" id="reset-password" name="password" type="password" inputmode="numeric" maxlength="6" pattern="\\d{6}" autocomplete="new-password" required>
            <button type="button" class="btn btn-icon pw-toggle" data-toggle-pw="reset-password" aria-label="Afficher" aria-pressed="false">${icon('eye')}</button>
          </div>
        </div>
        <div class="field">
          <label class="label" for="reset-confirm">Confirmer <span class="req">*</span></label>
          <div class="pw-wrap">
            <input class="input" id="reset-confirm" name="password_confirm" type="password" inputmode="numeric" maxlength="6" pattern="\\d{6}" autocomplete="new-password" required>
            <button type="button" class="btn btn-icon pw-toggle" data-toggle-pw="reset-confirm" aria-label="Afficher" aria-pressed="false">${icon('eye')}</button>
          </div>
        </div>
      </div>
      <button class="btn btn-primary btn-block" type="submit" id="reset-submit">${icon('key')} Réinitialiser</button>
    </form>
    <div class="auth-links"><a href="#/connexion">← Retour à la connexion</a></div>`);
  bindPasswordToggles(card);
  const form = document.getElementById('reset-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorBox = document.getElementById('reset-error');
    errorBox.innerHTML = '';
    if (form.password.value !== form.password_confirm.value) {
      return (errorBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>Les mots de passe ne correspondent pas.</div></div>`));
    }
    if (!/^\d{6}$/.test(form.password.value)) {
      return (errorBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>Le mot de passe doit contenir exactement 6 chiffres.</div></div>`));
    }
    const btn = document.getElementById('reset-submit');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner spinner-sm"></span> Enregistrement…';
    try {
      await api(`/auth/reset/${encodeURIComponent(token)}`, { method: 'POST', body: { password: form.password.value, password_confirm: form.password_confirm.value } });
      toast('Mot de passe réinitialisé. Vous pouvez vous connecter.', 'success');
      navigate('/connexion');
    } catch (err) {
      errorBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>${err.message}</div></div>`);
      btn.disabled = false;
      btn.innerHTML = `${icon('key')} Réinitialiser`;
    }
  });
}
