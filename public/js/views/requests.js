import {
  state, api, html, icon, modal, toast, fmtDate, fmtDateTime, can,
  statusBadge, loading, emptyState, setLoading,
} from '../api.js';

const CATEGORIES = ['Renseignement', 'Demande de document', 'Rendez-vous', 'Réclamation', 'Récupération de compte', 'Autre'];
const STATUSES = {
  recue: 'Reçue', en_cours: 'En cours', traitee: 'Traitée', rejetee: 'Rejetée',
};

export async function renderRequests(root) {
  const manager = can('requests.manage');
  let status = '';
  let q = '';

  root.innerHTML = String(html`
    <div class="page-header">
      <div>
        <h1 class="page-title">Demandes administratives</h1>
        <p class="page-sub">${manager ? 'Demandes transmises par les utilisateurs, avec numéro de référence et suivi du traitement.' : 'Transmettez une demande au secrétariat et suivez son traitement grâce à son numéro de référence.'}</p>
      </div>
      <div class="page-actions"><button class="btn btn-primary" id="new-request">${icon('plus')} Nouvelle demande</button></div>
    </div>
    <div class="stat-grid" id="req-summary"></div>
    <div class="toolbar">
      <div class="field search-field">
        <label class="label sr-only" for="req-search">Rechercher</label>
        <div class="search-input">${icon('search')}<input class="input" id="req-search" type="search" placeholder="Rechercher par objet ou référence…"></div>
      </div>
      <div class="field"><label class="label sr-only" for="req-status">Statut</label>
        <select class="select" id="req-status"><option value="">Tous les statuts</option>
          ${Object.entries(STATUSES).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select></div>
    </div>
    <div id="req-box">${loading()}</div>
  `);

  const box = document.getElementById('req-box');
  const summary = document.getElementById('req-summary');

  const load = async () => {
    box.innerHTML = String(loading());
    const params = new URLSearchParams({ limit: '50' });
    if (status) params.set('status', status);
    if (q) params.set('q', q);
    try {
      const data = await api(`/requests?${params.toString()}`);
      summary.innerHTML = String(html`
        <div class="stat-card"><div class="stat-label">Reçues</div><div class="stat-value">${data.summary.recue}</div></div>
        <div class="stat-card"><div class="stat-label">En cours</div><div class="stat-value">${data.summary.en_cours}</div></div>
        <div class="stat-card"><div class="stat-label">Traitées</div><div class="stat-value">${data.summary.traitee}</div></div>
        <div class="stat-card"><div class="stat-label">Rejetées</div><div class="stat-value">${data.summary.rejetee}</div></div>`);
      if (!data.requests.length) {
        box.innerHTML = String(emptyState(
          manager ? 'Aucune demande' : 'Aucune demande pour le moment',
          'Utilisez le bouton « Nouvelle demande » pour transmettre une demande au secrétariat.',
          'book'
        ));
        return;
      }
      box.innerHTML = String(manager ? html`
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Référence</th><th>Objet</th><th>Auteur</th><th>Statut</th><th>Affectée à</th><th>Date</th><th></th></tr></thead>
          <tbody>${data.requests.map((r) => html`
            <tr class="${r.status === 'recue' ? 'row-warn' : ''}">
              <td class="nowrap"><strong>${r.reference}</strong></td>
              <td>${r.subject}</td>
              <td>${r.author_name}<div class="tiny muted">${r.author_role}</div></td>
              <td>${statusBadge(r.status)}</td>
              <td>${r.assignee_name || '—'}</td>
              <td class="nowrap">${fmtDate(r.created_at)}</td>
              <td><button class="btn btn-secondary btn-sm" data-open="${r.id}">Ouvrir</button></td>
            </tr>`)}</tbody>
        </table></div>
      ` : html`
        <div class="pub-list">
          ${data.requests.map((r) => html`
            <article class="pub-card" role="button" tabindex="0" data-open="${r.id}" style="cursor:pointer">
              <div class="pub-top">${statusBadge(r.status)}<span class="muted tiny" style="margin-left:auto">${r.reference}</span></div>
              <h3 class="pub-title">${r.subject}</h3>
              <p class="pub-excerpt">${r.message}</p>
              <div class="pub-meta"><span>${icon('calendar')} ${fmtDateTime(r.created_at)}</span>${r.response ? html`<span>${icon('check-circle')} Réponse disponible</span>` : ''}</div>
            </article>`)}
        </div>`);
      box.querySelectorAll('[data-open]').forEach((el) => {
        el.addEventListener('click', () => openRequest(Number(el.dataset.open), load, manager));
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter') openRequest(Number(el.dataset.open), load, manager); });
      });
    } catch (err) {
      box.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>${err.message}</div></div>`);
    }
  };

  document.getElementById('new-request').addEventListener('click', () => openNewRequest(load));
  let timer;
  document.getElementById('req-search').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { q = e.target.value.trim(); load(); }, 300);
  });
  document.getElementById('req-status').addEventListener('change', (e) => { status = e.target.value; load(); });
  await load();
}

function openNewRequest(onSaved) {
  modal({
    title: 'Nouvelle demande administrative',
    wide: true,
    body: html`
      <div id="req-form-error"></div>
      <form id="req-form">
        <div class="field"><label class="label" for="n-subject">Objet <span class="req">*</span></label>
          <input class="input" id="n-subject" maxlength="200" placeholder="Résumé de votre demande"></div>
        <div class="field"><label class="label" for="n-category">Type de demande</label>
          <select class="select" id="n-category">${CATEGORIES.map((c) => html`<option value="${c}">${c}</option>`)}</select></div>
        <div class="field"><label class="label" for="n-message">Message <span class="req">*</span></label>
          <textarea class="textarea" id="n-message" rows="6" maxlength="5000" placeholder="Décrivez précisément votre demande…"></textarea>
          <div class="hint">Ne communiquez jamais votre mot de passe dans une demande.</div></div>
      </form>`,
    footer: html`<button class="btn btn-secondary" data-close>Annuler</button><button class="btn btn-primary" id="n-submit">${icon('send')} Envoyer la demande</button>`,
    onMount(overlay, close) {
      overlay.querySelector('#n-submit').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const errBox = overlay.querySelector('#req-form-error');
        errBox.innerHTML = '';
        const subject = overlay.querySelector('#n-subject').value.trim();
        const message = overlay.querySelector('#n-message').value.trim();
        if (subject.length < 3) return (errBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>Indiquez l’objet de la demande.</div></div>`));
        if (message.length < 5) return (errBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>Rédigez votre message.</div></div>`));
        setLoading(btn, true, 'Envoi…');
        try {
          const res = await api('/requests', { method: 'POST', body: { subject, category: overlay.querySelector('#n-category').value, message } });
          toast(res.message, 'success');
          close();
          onSaved();
        } catch (err) {
          errBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>${err.message}</div></div>`);
          setLoading(btn, false);
        }
      });
    },
  });
}

async function openRequest(id, onSaved, manager) {
  let data;
  try {
    data = await api(`/requests/${id}`);
  } catch (err) {
    toast(err.message, 'error');
    return;
  }
  const r = data.request;
  let contacts = [];
  if (manager) {
    try {
      const c = await api('/messages/contacts');
      contacts = c.contacts.filter((x) => x.role_slug !== 'etudiant');
    } catch {}
  }
  modal({
    title: `${r.reference} · ${r.subject}`,
    wide: true,
    body: html`
      <div class="flex between mb2 flex-wrap">
        <div class="flex" style="gap:.4rem">${statusBadge(r.status)}<span class="badge badge-gris">${r.category}</span></div>
        <span class="muted small">${fmtDateTime(r.created_at)}</span>
      </div>
      <dl class="key-value mb2">
        <dt>Demandeur</dt><dd>${r.author_name} (${r.author_role})${r.author_phone ? ` · ${r.author_phone}` : ''}</dd>
        ${r.assignee_name ? html`<dt>Affectée à</dt><dd>${r.assignee_name}</dd>` : ''}
      </dl>
      <div class="card card-pad" style="background:#fbfcfe">
        <div class="body-text">${r.message}</div>
      </div>
      ${r.response ? html`<div class="alert alert-ok mt2">${icon('check-circle')}<div><strong>Réponse de l’administration</strong><div class="body-text" style="margin-top:.3rem">${r.response}</div></div></div>` : ''}
      <h3 class="mt3" style="font-size:1rem">Historique</h3>
      <div class="notif-list">
        ${data.history.map((h) => html`
          <div class="notif-item"><div class="notif-icon">${icon('history')}</div>
            <div class="notif-body"><p class="notif-title">${STATUSES[h.status] || h.status}</p>
              <p class="notif-sub">${h.comment || ''}</p>
              <div class="notif-time">${h.actor_name || 'Système'} · ${fmtDateTime(h.created_at)}</div></div></div>`)}
      </div>
      ${manager ? html`
        <div class="sep"></div>
        <h3 style="font-size:1rem">Traitement de la demande</h3>
        <div id="req-manage-error"></div>
        <div class="form-grid">
          <div class="field"><label class="label" for="m-status">Statut</label>
            <select class="select" id="m-status">${Object.entries(STATUSES).map(([k, v]) => html`<option value="${k}" ${r.status === k ? 'selected' : ''}>${v}</option>`)}</select></div>
          <div class="field"><label class="label" for="m-assignee">Affecter à</label>
            <select class="select" id="m-assignee"><option value="">Non affectée</option>
              ${contacts.map((c) => html`<option value="${c.id}" ${r.assigned_to === c.id ? 'selected' : ''}>${c.full_name} — ${c.role_name}</option>`)}</select></div>
        </div>
        <div class="field"><label class="label" for="m-response">Réponse au demandeur</label>
          <textarea class="textarea" id="m-response" rows="4" maxlength="5000">${r.response || ''}</textarea></div>
        <div class="field"><label class="label" for="m-comment">Note interne / commentaire de suivi</label>
          <input class="input" id="m-comment" maxlength="1000" placeholder="Facultatif"></div>
        <div class="flex end"><button class="btn btn-primary" id="m-save">${icon('save')} Enregistrer le traitement</button></div>` : ''}
    `,
    footer: manager ? html`<button class="btn btn-secondary" data-close>Fermer</button>` : html`<button class="btn btn-secondary" data-close>Fermer</button>`,
    onMount(overlay, close) {
      overlay.querySelector('#m-save')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const errBox = overlay.querySelector('#req-manage-error');
        errBox.innerHTML = '';
        setLoading(btn, true, 'Enregistrement…');
        try {
          const res = await api(`/requests/${id}`, {
            method: 'PUT',
            body: {
              status: overlay.querySelector('#m-status').value,
              assigned_to: overlay.querySelector('#m-assignee').value || null,
              response: overlay.querySelector('#m-response').value,
              comment: overlay.querySelector('#m-comment').value,
            },
          });
          toast(res.message, 'success');
          close();
          onSaved();
        } catch (err) {
          errBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>${err.message}</div></div>`);
          setLoading(btn, false);
        }
      });
    },
  });
}
