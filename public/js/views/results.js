import {
  state, api, uploadFile, html, icon, esc, modal, confirmDialog, toast,
  fmtDate, fmtDateTime, can, statusBadge, fileUrl, fileSize, loading, emptyState,
  setLoading, showFormError,
} from '../api.js';

const canManage = () => can('results.manage');
const canPublish = () => can('results.publish');

export async function renderResults(root) {
  const manager = canManage() || canPublish();
  root.innerHTML = String(html`
    <div class="page-header">
      <div>
        <h1 class="page-title">Résultats et informations d’examen</h1>
        <p class="page-sub">${manager ? 'Dépôt, publication et suivi des consultations des résultats.' : 'Résultats publiés pour votre niveau et votre parcours. Chaque accès est comptabilisé.'}</p>
      </div>
      ${canManage() ? html`<div class="page-actions"><button class="btn btn-primary" id="add-result">${icon('upload')} Déposer des résultats</button></div>` : ''}
    </div>
    <div id="results-box">${loading()}</div>
  `);

  const box = document.getElementById('results-box');
  const structure = state.structure || (await api('/structure').then((s) => (state.structure = s)).catch(() => ({ levels: [], parcours: [] })));

  const load = async () => {
    box.innerHTML = String(loading());
    try {
      const data = await api('/results');
      if (!data.results.length) {
        box.innerHTML = String(emptyState(
          manager ? 'Aucun résultat déposé' : 'Aucun résultat publié',
          manager ? 'Déposez un fichier PDF, puis publiez-le après vérification.' : 'Les résultats officiellement publiés pour votre niveau apparaîtront ici.',
          'award'
        ));
        return;
      }
      box.innerHTML = String(html`
        ${manager ? html`<div class="stat-grid">
          <div class="stat-card"><div class="stat-label">Résultats publiés</div><div class="stat-value">${data.results.filter((r) => r.status === 'published').length}</div></div>
          <div class="stat-card"><div class="stat-label">Brouillons</div><div class="stat-value">${data.results.filter((r) => r.status === 'draft').length}</div></div>
          <div class="stat-card"><div class="stat-label">Retirés</div><div class="stat-value">${data.results.filter((r) => r.status === 'withdrawn').length}</div></div>
          <div class="stat-card accent"><div class="stat-label">Consultations</div><div class="stat-value">${data.results.reduce((a, r) => a + r.view_count, 0)}</div><div class="stat-note">accès enregistrés</div></div>
        </div>` : ''}
        <div class="pub-list">
          ${data.results.map((r) => html`
            <article class="card card-pad">
              <div class="pub-top">
                ${statusBadge(r.status)}
                ${r.level_name ? html`<span class="badge">${r.level_name}</span>` : ''}
                ${r.parcours_name ? html`<span class="badge badge-gris">${r.parcours_name}</span>` : ''}
                ${r.session ? html`<span class="chip">${r.session}</span>` : ''}
                ${r.period ? html`<span class="chip">${r.period}</span>` : ''}
                <span class="muted tiny" style="margin-left:auto">${r.published_at ? `Publié le ${fmtDate(r.published_at)}` : `Déposé le ${fmtDate(r.created_at)}`}</span>
              </div>
              <h3 class="pub-title">${r.title}</h3>
              <div class="pub-meta">
                <span>${icon('file')} ${r.filename} (${fileSize(r.size)})</span>
                ${manager ? html`<span>${icon('eye')} ${r.view_count} consultation(s)</span>` : ''}
                ${r.publisher_name ? html`<span>${icon('user')} Publié par ${r.publisher_name}</span>` : ''}
              </div>
              <div class="doc-actions">
                ${r.status === 'published' || manager ? html`
                  <button class="btn btn-primary btn-sm" data-open-result="${r.id}" data-file="${r.file_id}">${icon('eye')} Consulter</button>
                  <a class="btn btn-secondary btn-sm" href="${fileUrl(r.file_id)}">${icon('download')} Télécharger</a>` : html`<span class="muted small">${r.status === 'draft' ? 'En attente de publication par un responsable habilité.' : 'Résultat retiré.'}</span>`}
                ${manager && r.status !== 'published' && canPublish() ? html`<button class="btn btn-gold btn-sm" data-publish="${r.id}">${icon('send')} Publier</button>` : ''}
                ${manager && r.status === 'published' ? html`<button class="btn btn-secondary btn-sm" data-withdraw="${r.id}">${icon('archive')} Retirer</button>` : ''}
                ${canManage() ? html`<button class="btn btn-ghost btn-sm" data-edit-result="${r.id}">${icon('edit')} Modifier</button>
                  <button class="btn btn-ghost btn-sm" data-history="${r.id}">${icon('history')} Historique</button>
                  <button class="btn btn-ghost btn-sm" data-viewers="${r.id}">${icon('users')} Consultations</button>` : ''}
              </div>
            </article>`)}
        </div>`);

      box.querySelectorAll('[data-open-result]').forEach((btn) => btn.addEventListener('click', async () => {
        try {
          await api(`/results/${btn.dataset.openResult}/view`, { method: 'POST' });
          window.open(fileUrl(btn.dataset.file, true), '_blank', 'noopener');
        } catch (err) { toast(err.message, 'error'); }
      }));
      box.querySelectorAll('[data-publish]').forEach((btn) => btn.addEventListener('click', async () => {
        if (!(await confirmDialog('Publier ces résultats ? Ils deviendront visibles par les étudiants du niveau et du parcours concernés, et une notification sera envoyée.', { confirmLabel: 'Publier' }))) return;
        try {
          const res = await api(`/results/${btn.dataset.publish}/publish`, { method: 'POST' });
          toast(res.message, 'success');
          load();
        } catch (err) { toast(err.message, 'error'); }
      }));
      box.querySelectorAll('[data-withdraw]').forEach((btn) => btn.addEventListener('click', async () => {
        if (!(await confirmDialog('Retirer ces résultats ? Ils ne seront plus accessibles aux étudiants. L’opération est tracée dans l’historique.', { confirmLabel: 'Retirer', danger: true }))) return;
        try {
          const res = await api(`/results/${btn.dataset.withdraw}/withdraw`, { method: 'POST', body: { reason: 'Retrait demandé par un responsable habilité.' } });
          toast(res.message, 'success');
          load();
        } catch (err) { toast(err.message, 'error'); }
      }));
      box.querySelectorAll('[data-edit-result]').forEach((btn) => btn.addEventListener('click', () => {
        const r = data.results.find((x) => x.id === Number(btn.dataset.editResult));
        if (r) openResultForm(r, load);
      }));
      box.querySelectorAll('[data-history]').forEach((btn) => btn.addEventListener('click', async () => {
        try {
          const res = await api(`/results/${btn.dataset.history}/history`);
          modal({
            title: 'Historique des modifications',
            body: res.history.length
              ? html`<div class="notif-list">${res.history.map((h) => html`
                  <div class="notif-item"><div class="notif-icon">${icon('history')}</div>
                    <div class="notif-body"><p class="notif-title">${actionLabel(h.action)}</p>
                      <p class="notif-sub">${h.details || ''}</p>
                      <div class="notif-time">${h.actor_name || 'Système'} · ${fmtDateTime(h.created_at)}</div></div></div>`)}</div>`
              : '<p class="muted">Aucun historique.</p>',
          });
        } catch (err) { toast(err.message, 'error'); }
      }));
      box.querySelectorAll('[data-viewers]').forEach((btn) => btn.addEventListener('click', async () => {
        try {
          const res = await api(`/results/${btn.dataset.viewers}/viewers`);
          modal({
            title: 'Consultations des résultats',
            wide: true,
            body: res.viewers.length
              ? html`<div class="table-wrap"><table class="data"><thead><tr><th>Étudiant</th><th>Téléphone</th><th>Niveau</th><th>Parcours</th><th>Premier accès</th></tr></thead>
                <tbody>${res.viewers.map((v) => html`<tr><td>${v.full_name}</td><td>${v.phone}</td><td>${v.level_name || '—'}</td><td>${v.parcours_name || '—'}</td><td>${fmtDateTime(v.first_viewed_at)}</td></tr>`)}</tbody></table></div>`
              : emptyState('Aucune consultation', 'Les ouvertures de résultats publiés seront enregistrées ici.', 'eye'),
          });
        } catch (err) { toast(err.message, 'error'); }
      }));
    } catch (err) {
      box.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>${err.message}</div></div>`);
    }
  };

  document.getElementById('add-result')?.addEventListener('click', () => openResultForm(null, load));
  await load();
}

function actionLabel(action) {
  return {
    create: 'Dépôt des résultats', update: 'Mise à jour', replace_file: 'Remplacement du fichier',
    publish: 'Publication', withdraw: 'Retrait', status: 'Changement de statut',
  }[action] || action;
}

function openResultForm(result, onSaved) {
  const structure = state.structure || { levels: [], parcours: [] };
  modal({
    title: result ? 'Modifier les résultats' : 'Déposer des résultats',
    wide: true,
    body: html`
      <div id="res-form-error"></div>
      <form id="res-form">
        <div class="field"><label class="label" for="r-title">Intitulé <span class="req">*</span></label>
          <input class="input" id="r-title" value="${result?.title || ''}" placeholder="Ex. Résultats — Semestre 1, session normale"></div>
        <div class="form-grid">
          <div class="field"><label class="label" for="r-level">Niveau <span class="req">*</span></label>
            <select class="select" id="r-level"><option value="">Choisir…</option>
              ${structure.levels.map((l) => html`<option value="${l.id}" ${result?.level_id === l.id ? 'selected' : ''}>${l.name}</option>`)}</select></div>
          <div class="field"><label class="label" for="r-parcours">Parcours</label>
            <select class="select" id="r-parcours"><option value="">Tous les parcours du niveau</option>
              ${structure.parcours.map((p) => html`<option value="${p.id}" ${result?.parcours_id === p.id ? 'selected' : ''}>${p.name}</option>`)}</select></div>
          <div class="field"><label class="label" for="r-session">Session</label><input class="input" id="r-session" value="${result?.session || ''}" placeholder="Ex. Session normale"></div>
          <div class="field"><label class="label" for="r-period">Période</label><input class="input" id="r-period" value="${result?.period || ''}" placeholder="Ex. Semestre 1"></div>
        </div>
        <div class="field"><label class="label" for="r-file">Fichier PDF ${result ? '' : '<span class="req">*</span>'}</label>
          <input class="input" type="file" id="r-file" accept="application/pdf,.pdf">
          ${result ? html`<div class="hint">Fichier actuel : ${result.filename}. Un remplacement repasse les résultats en brouillon jusqu’à nouvelle publication.</div>` : html`<div class="hint">Les résultats personnels ne doivent jamais être accessibles à tous. Vérifiez le fichier avant publication.</div>`}
        </div>
        <div class="alert alert-warn" style="margin-bottom:0">${icon('alert')}<div class="small">Après le dépôt, les résultats restent en brouillon. Seule une personne disposant du droit de publication peut les rendre visibles aux étudiants.</div></div>
      </form>`,
    footer: html`<button class="btn btn-secondary" data-close>Annuler</button><button class="btn btn-primary" id="r-submit">${icon('save')} Enregistrer</button>`,
    onMount(overlay, close) {
      overlay.querySelector('#r-submit').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const errBox = overlay.querySelector('#res-form-error');
        errBox.innerHTML = '';
        const title = overlay.querySelector('#r-title').value.trim();
        const levelId = overlay.querySelector('#r-level').value;
        const file = overlay.querySelector('#r-file').files?.[0];
        if (title.length < 2) return (errBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>Indiquez un intitulé.</div></div>`));
        if (!levelId) return (errBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>Choisissez le niveau concerné.</div></div>`));
        if (!result && !file) return (errBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>Choisissez un fichier PDF.</div></div>`));
        if (file && file.type !== 'application/pdf') return (errBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>Le fichier doit être au format PDF.</div></div>`));
        setLoading(btn, true, 'Enregistrement…');
        try {
          let fileId = result?.file_id;
          if (file) fileId = (await uploadFile(file)).id;
          const payload = {
            title,
            level_id: levelId,
            parcours_id: overlay.querySelector('#r-parcours').value || null,
            session: overlay.querySelector('#r-session').value,
            period: overlay.querySelector('#r-period').value,
            file_id: fileId,
          };
          const res = result
            ? await api(`/results/${result.id}`, { method: 'PUT', body: payload })
            : await api('/results', { method: 'POST', body: payload });
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
