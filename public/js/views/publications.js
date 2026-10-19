import {
  state, api, uploadFile, html, icon, esc, modal, confirmDialog, toast, navigate,
  fmtDate, fmtDateTime, timeAgo, can, statusBadge, priorityLabel, fileUrl, fileSize,
  loading, emptyState, setLoading, showFormError,
} from '../api.js';

/* ------------------------------ Liste ------------------------------ */
export async function renderPublications(root, query) {
  const manageAllowed = can('publications.create');
  let scope = query.get('scope') === 'manage' && manageAllowed ? 'manage' : 'feed';
  let page = 1;
  let q = query.get('q') || '';
  let category = query.get('category') || '';
  let status = query.get('status') || '';
  let level = query.get('level') || '';
  let parcours = query.get('parcours') || '';

  root.innerHTML = String(html`
    <div class="page-header">
      <div>
        <h1 class="page-title">Annonces et publications</h1>
        <p class="page-sub">Informations officielles, pédagogiques et scientifiques diffusées par le département selon leurs destinataires.</p>
      </div>
      ${manageAllowed ? html`<div class="page-actions"><a class="btn btn-primary" href="#/annonces/nouvelle">${icon('plus')} Nouvelle publication</a></div>` : ''}
    </div>
    ${manageAllowed ? html`
      <div class="tabs" role="tablist">
        <button class="tab ${scope === 'feed' ? 'active' : ''}" data-scope="feed" role="tab" aria-selected="${scope === 'feed'}">Fil d’actualité</button>
        <button class="tab ${scope === 'manage' ? 'active' : ''}" data-scope="manage" role="tab" aria-selected="${scope === 'manage'}">Gérer mes publications</button>
      </div>` : ''}
    <div class="toolbar">
      <div class="field search-field">
        <label class="label sr-only" for="pub-search">Rechercher</label>
        <div class="search-input">${icon('search')}<input class="input" id="pub-search" type="search" placeholder="Rechercher une publication…" value="${q}"></div>
      </div>
      <div class="field">
        <label class="label sr-only" for="pub-category">Catégorie</label>
        <select class="select" id="pub-category"><option value="">Toutes les catégories</option></select>
      </div>
      <div class="field" id="status-filter-wrap" ${scope === 'manage' ? '' : 'hidden'}>
        <label class="label sr-only" for="pub-status">Statut</label>
        <select class="select" id="pub-status">
          <option value="">Tous les statuts</option>
          <option value="draft">Brouillon</option>
          <option value="scheduled">Programmée</option>
          <option value="published">Publiée</option>
          <option value="archived">Archivée</option>
        </select>
      </div>
      <div class="field">
        <label class="label sr-only" for="pub-level">Niveau</label>
        <select class="select" id="pub-level"><option value="">Tous les niveaux</option></select>
      </div>
      <div class="field">
        <label class="label sr-only" for="pub-parcours">Parcours</label>
        <select class="select" id="pub-parcours"><option value="">Tous les parcours</option></select>
      </div>
    </div>
    <div id="pub-list-box">${loading()}</div>
    <div class="flex between mt2" id="pub-pager"></div>
  `);

  const cats = state.categories || (await api('/categories').then((d) => (state.categories = d.categories)).catch(() => []));
  const catSelect = document.getElementById('pub-category');
  catSelect.innerHTML += cats.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  catSelect.value = category;

  const st = state.structure || (await api('/structure').then((d) => (state.structure = d)).catch(() => ({ levels: [], parcours: [] })));
  const levelSelect = document.getElementById('pub-level');
  levelSelect.innerHTML += st.levels.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
  levelSelect.value = level;
  const parcoursSelect = document.getElementById('pub-parcours');
  parcoursSelect.innerHTML += st.parcours.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  parcoursSelect.value = parcours;

  const statusSelect = document.getElementById('pub-status');
  statusSelect.value = status;
  const box = document.getElementById('pub-list-box');
  const pager = document.getElementById('pub-pager');

  const load = async (append = false) => {
    if (!append) { box.innerHTML = String(loading()); page = 1; }
    const params = new URLSearchParams({ scope, page: String(page), limit: '15' });
    if (q) params.set('q', q);
    if (category) params.set('category', category);
    if (status && scope === 'manage') params.set('status', status);
    if (level) params.set('level', level);
    if (parcours) params.set('parcours', parcours);
    try {
      const data = await api(`/publications?${params.toString()}`);
      const list = data.publications;
      const markup = list.length
        ? html`<div class="pub-list" id="pub-cards">
            ${list.map((p) => html`
              <a class="pub-card priority-${p.priority}" href="#/annonces/${p.id}">
                <div class="pub-top">
                  ${p.category_name ? html`<span class="badge" style="background:${p.category_color}1a;color:${p.category_color}">${p.category_name}</span>` : html`<span class="badge badge-gris">Publication</span>`}
                  ${p.priority !== 'normale' ? html`<span class="badge ${p.priority === 'urgente' ? 'badge-err' : 'badge-warn'}">${priorityLabel[p.priority]}</span>` : ''}
                  ${p.pinned ? html`<span class="badge badge-or">${icon('pin')} Épinglée</span>` : ''}
                  ${scope === 'manage' ? statusBadge(p.status) : ''}
                  <span class="muted tiny" style="margin-left:auto">${timeAgo(p.published_at || p.publish_at || p.created_at)}</span>
                </div>
                <h3 class="pub-title">${p.title}</h3>
                <p class="pub-excerpt">${p.body_preview || 'Publication sans texte.'}</p>
                <div class="pub-meta">
                  <span>${icon('user')} ${p.author_name}</span>
                  ${p.published_at ? html`<span>${icon('calendar')} ${fmtDate(p.published_at)}</span>` : p.publish_at ? html`<span>${icon('clock')} Programme : ${fmtDateTime(p.publish_at)}</span>` : ''}
                  <span>${icon('eye')} ${p.view_count} vue(s)</span>
                  ${p.file_count ? html`<span>${icon('paperclip')} ${p.file_count} pièce(s)</span>` : ''}
                </div>
                ${p.audiences?.length ? html`<div class="audience-line">${icon('users')} ${p.audiences.map((a) => html`<span class="chip">${a.label}</span>`)}</div>` : ''}
              </a>`)}
          </div>`
        : String(emptyState(
            scope === 'manage' ? 'Aucune publication dans cet espace' : 'Aucune publication pour vous',
            scope === 'manage'
              ? 'Créez une première publication ou ajustez les filtres.'
              : 'Les publications adressées à votre niveau, votre parcours, votre rôle ou à tous les utilisateurs apparaîtront ici.',
            'megaphone',
            can('publications.create') ? html`<a class="btn btn-primary mt2" href="#/annonces/nouvelle">${icon('plus')} Créer une publication</a>` : ''
          ));
      if (append) {
        document.getElementById('pub-cards')?.insertAdjacentHTML('beforeend', String(markup).replace(/^<div class="pub-list" id="pub-cards">|<\/div>$/g, ''));
      } else {
        box.innerHTML = String(markup);
      }
      const shown = Math.min(page * 15, data.total);
      pager.innerHTML = String(html`
        <span class="muted small">${shown} sur ${data.total} publication(s)</span>
        <span class="flex">
          <button class="btn btn-secondary btn-sm" id="prev-page" ${page === 1 ? 'disabled' : ''}>${icon('arrow-left')} Précédent</button>
          <button class="btn btn-secondary btn-sm" id="next-page" ${page * 15 >= data.total ? 'disabled' : ''}>Suivant ${icon('arrow-right')}</button>
        </span>`);
      document.getElementById('prev-page')?.addEventListener('click', () => { page -= 1; load(); window.scrollTo({ top: 0 }); });
      document.getElementById('next-page')?.addEventListener('click', () => { page += 1; load(); window.scrollTo({ top: 0 }); });
    } catch (err) {
      box.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>${err.message}</div></div>`);
    }
  };

  let searchTimer;
  document.getElementById('pub-search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { q = e.target.value.trim(); load(); }, 300);
  });
  catSelect.addEventListener('change', () => { category = catSelect.value; load(); });
  statusSelect.addEventListener('change', () => { status = statusSelect.value; load(); });
  levelSelect.addEventListener('change', () => { level = levelSelect.value; load(); });
  parcoursSelect.addEventListener('change', () => { parcours = parcoursSelect.value; load(); });
  root.querySelectorAll('[data-scope]').forEach((tab) => {
    tab.addEventListener('click', () => {
      scope = tab.dataset.scope;
      root.querySelectorAll('[data-scope]').forEach((t) => {
        t.classList.toggle('active', t === tab);
        t.setAttribute('aria-selected', String(t === tab));
      });
      document.getElementById('status-filter-wrap').toggleAttribute('hidden', scope !== 'manage');
      load();
    });
  });
  await load();
}

/* ------------------------------ Détail ------------------------------ */
export async function renderPublicationDetail(root, id) {
  root.innerHTML = String(loading());
  let data;
  try {
    data = await api(`/publications/${id}`);
  } catch (err) {
    root.innerHTML = String(html`<a class="back-link" href="#/annonces">${icon('arrow-left')} Retour aux annonces</a>
      <div class="alert alert-err">${icon('alert')}<div>${err.message}</div></div>`);
    return;
  }
  const p = data.publication;
  const isAuthor = p.created_by === state.user.id;
  const manageAll = can('publications.manage_all');
  const canEdit = isAuthor || manageAll;
  const canViewers = isAuthor || manageAll || can('stats.view');
  api(`/publications/${id}/view`, { method: 'POST' }).catch(() => {});

  root.innerHTML = String(html`
    <a class="back-link" href="#/annonces">${icon('arrow-left')} Retour aux annonces</a>
    <article class="card">
      <div class="card-body">
        <div class="pub-top">
          ${p.category_name ? html`<span class="badge" style="background:${p.category_color}1a;color:${p.category_color}">${p.category_name}</span>` : ''}
          ${p.priority !== 'normale' ? html`<span class="badge ${p.priority === 'urgente' ? 'badge-err' : 'badge-warn'}">${priorityLabel[p.priority]}</span>` : ''}
          ${p.pinned ? html`<span class="badge badge-or">${icon('pin')} Épinglée</span>` : ''}
          ${p.status !== 'published' ? statusBadge(p.status) : ''}
          <span class="muted tiny" style="margin-left:auto">${p.published_at ? fmtDateTime(p.published_at) : 'Non publiée'}</span>
        </div>
        <h1 class="page-title" style="margin:.4rem 0 .7rem">${p.title}</h1>
        <div class="pub-meta mb2">
          <span>${icon('user')} ${p.author_name}</span>
          ${p.published_at ? html`<span>${icon('calendar')} ${fmtDate(p.published_at)}</span>` : ''}
          ${p.publish_at && p.status === 'scheduled' ? html`<span>${icon('clock')} Diffusion prévue : ${fmtDateTime(p.publish_at)}</span>` : ''}
          <span>${icon('eye')} <span id="view-count">${p.view_count}</span> vue(s)</span>
        </div>
        ${p.audiences?.length ? html`<div class="audience-line mb2">${icon('users')} <strong class="small">Destinataires :</strong> ${p.audiences.map((a) => html`<span class="chip">${a.label}</span>`)}</div>` : ''}
        <div class="sep"></div>
        <div class="body-text">${p.body || 'Aucun texte.'}</div>
        ${p.files?.length ? html`
          <div class="mt3">
            <h2 style="font-size:1rem">Pièces jointes</h2>
            ${p.files.map((f) => html`
              <div class="attachment">
                ${icon('file')}
                <div class="name"><strong>${f.filename}</strong><div class="tiny muted">${fileSize(f.size)}</div></div>
                ${/^application\/pdf$|^image\//.test(f.mime) ? html`<a class="btn btn-secondary btn-sm" href="${fileUrl(f.id, true)}" target="_blank" rel="noopener">${icon('eye')} Aperçu</a>` : ''}
                <a class="btn btn-secondary btn-sm" href="${fileUrl(f.id)}">${icon('download')} Télécharger</a>
              </div>`)}
          </div>` : ''}
      </div>
      ${canEdit || canViewers ? html`
        <div class="card-head" style="justify-content:flex-end;border-top:1px solid var(--bord-2);border-bottom:0">
          ${canViewers ? html`<button class="btn btn-secondary btn-sm" id="viewers-btn">${icon('users')} Consultations</button>` : ''}
          ${canEdit ? html`<a class="btn btn-secondary btn-sm" href="#/annonces/${p.id}/modifier">${icon('edit')} Modifier</a>` : ''}
          ${canEdit && p.status !== 'published' && p.status !== 'archived' ? html`<button class="btn btn-primary btn-sm" id="publish-now">${icon('send')} Publier maintenant</button>` : ''}
          ${canEdit && p.status === 'published' ? html`<button class="btn btn-secondary btn-sm" id="archive-pub">${icon('archive')} Archiver</button>` : ''}
          ${canEdit ? html`<button class="btn btn-danger btn-sm" id="delete-pub">${icon('trash')} Supprimer</button>` : ''}
        </div>` : ''}
    </article>
  `);

  document.getElementById('publish-now')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    setLoading(btn, true, 'Publication…');
    try {
      const res = await api(`/publications/${id}/publish`, { method: 'POST' });
      toast(res.message, 'success');
      renderPublicationDetail(root, id);
    } catch (err) {
      toast(err.message, 'error');
      setLoading(btn, false);
    }
  });
  document.getElementById('archive-pub')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Archiver cette publication ? Elle ne sera plus visible des destinataires mais restera consultable dans votre espace.', { confirmLabel: 'Archiver' }))) return;
    try {
      await api(`/publications/${id}/archive`, { method: 'POST' });
      toast('Publication archivée.', 'success');
      navigate('/annonces');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  document.getElementById('delete-pub')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Supprimer définitivement cette publication ? Cette action est irréversible.', { title: 'Supprimer la publication', confirmLabel: 'Supprimer', danger: true }))) return;
    try {
      await api(`/publications/${id}`, { method: 'DELETE' });
      toast('Publication supprimée.', 'success');
      navigate('/annonces');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  document.getElementById('viewers-btn')?.addEventListener('click', async () => {
    try {
      const res = await api(`/publications/${id}/viewers`);
      modal({
        title: 'Consultations de la publication',
        wide: true,
        body: res.viewers.length
          ? html`<p class="small muted">${res.total} personne(s) ont ouvert cette publication. Plusieurs ouvertures d’une même personne comptent pour une personne.</p>
            <div class="table-wrap"><table class="data"><thead><tr><th>Personne</th><th>Rôle</th><th>Niveau</th><th>Première consultation</th><th>Ouvertures</th></tr></thead>
            <tbody>${res.viewers.map((v) => html`<tr><td>${v.full_name}</td><td>${v.role_name}</td><td>${v.level_name || '—'}</td><td>${fmtDateTime(v.first_viewed_at)}</td><td>${v.view_count}</td></tr>`)}</tbody></table></div>`
          : emptyState('Aucune consultation enregistrée', 'Les ouvertures réelles de cette publication seront comptabilisées ici.', 'eye'),
      });
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

/* ------------------------------ Éditeur ------------------------------ */
export async function renderPublicationEditor(root, id) {
  const isEdit = Boolean(id);
  let pub = null;
  let roles = [];
  let scopes = [];
  try {
    const [cats, structure, rolesData] = await Promise.all([
      state.categories ? Promise.resolve({ categories: state.categories }) : api('/categories'),
      state.structure ? Promise.resolve(state.structure) : api('/structure'),
      can('publications.audience_all') ? api('/roles-lite') : Promise.resolve({ roles: [] }),
    ]);
    state.categories = cats.categories;
    state.structure = structure;
    roles = rolesData.roles || [];
    if (isEdit) {
      const data = await api(`/publications/${id}`);
      pub = data.publication;
      const isAuthor = pub.created_by === state.user.id;
      if (!isAuthor && !can('publications.manage_all')) throw new Error('Vous ne pouvez pas modifier cette publication.');
    }
    if (!can('publications.audience_all')) {
      const profile = await api('/profile');
      scopes = profile.scopes || [];
    }
  } catch (err) {
    root.innerHTML = String(html`<a class="back-link" href="#/annonces">${icon('arrow-left')} Retour</a>
      <div class="alert alert-err">${icon('alert')}<div>${err.message}</div></div>`);
    return;
  }

  const categories = state.categories || [];
  const structure = state.structure || { levels: [], parcours: [], groups: [] };
  const allAudiences = can('publications.audience_all');
  const selected = new Set((pub?.audiences || []).map((a) => `${a.kind}:${a.target_id || a.target_text}`));
  const hasAudience = (kind, value) => selected.has(`${kind}:${value}`);
  const scopeType = (type, id) => scopes.some((s) => s.type === type && Number(s.id) === Number(id));

  const allowedLevels = allAudiences ? structure.levels : structure.levels.filter((l) => scopeType('level', l.id));
  const allowedParcours = allAudiences ? structure.parcours : structure.parcours.filter((p) => scopeType('parcours', p.id));
  const allowedGroups = allAudiences ? structure.groups : structure.groups.filter((g) => scopeType('group', g.id));
  const attachedFiles = [...(pub?.files || [])];
  const defaultStatus = pub ? (pub.status === 'archived' ? 'draft' : pub.status) : 'draft';

  root.innerHTML = String(html`
    <a class="back-link" href="${isEdit ? `#/annonces/${id}` : '#/annonces'}">${icon('arrow-left')} Retour</a>
    <div class="page-header">
      <div>
        <h1 class="page-title">${isEdit ? 'Modifier la publication' : 'Nouvelle publication'}</h1>
        <p class="page-sub">Le texte et les pièces jointes seront visibles uniquement par les destinataires choisis.</p>
      </div>
    </div>
    <div id="editor-error"></div>
    <form id="pub-form" class="stack" novalidate>
      <section class="card card-pad">
        <div class="field">
          <label class="label" for="f-title">Titre <span class="req">*</span></label>
          <input class="input" id="f-title" name="title" maxlength="200" required value="${pub?.title || ''}" placeholder="Objet de la publication">
        </div>
        <div class="form-grid">
          <div class="field">
            <label class="label" for="f-category">Catégorie</label>
            <select class="select" id="f-category" name="category_id">
              <option value="">Sans catégorie</option>
              ${categories.map((c) => html`<option value="${c.id}" ${pub?.category_id === c.id ? 'selected' : ''}>${c.name}</option>`)}
            </select>
          </div>
          <div class="field">
            <label class="label" for="f-priority">Priorité</label>
            <select class="select" id="f-priority" name="priority">
              <option value="normale" ${(pub?.priority || 'normale') === 'normale' ? 'selected' : ''}>Normale</option>
              <option value="haute" ${pub?.priority === 'haute' ? 'selected' : ''}>Haute</option>
              <option value="urgente" ${pub?.priority === 'urgente' ? 'selected' : ''}>Urgente</option>
            </select>
          </div>
        </div>
        <div class="field">
          <label class="label" for="f-body">Texte de la publication</label>
          <textarea class="textarea" id="f-body" name="body" rows="9" maxlength="30000" placeholder="Rédigez le contenu…">${pub?.body || ''}</textarea>
          <div class="hint">Le texte conserve les retours à la ligne. Vous pouvez joindre un ou plusieurs fichiers ci-dessous.</div>
        </div>
        ${allAudiences ? html`<label class="check"><input type="checkbox" id="f-pinned" ${pub?.pinned ? 'checked' : ''}> Épingler cette publication en tête du fil</label>` : ''}
      </section>

      <section class="card card-pad">
        <h2 style="font-size:1.05rem">Destinataires <span class="req">*</span></h2>
        <p class="hint mb2">Choisissez au moins une audience. Les notifications sont créées uniquement pour « Tous les utilisateurs », les rôles, niveaux, parcours et groupes.</p>
        ${!allAudiences && !scopes.length ? html`<div class="alert alert-warn">${icon('alert')}<div>Aucun périmètre ne vous est attribué. Contactez l’administration pour recevoir le ou les niveaux, parcours ou groupes sur lesquels vous pouvez publier.</div></div>` : ''}
        <div class="form-grid">
          ${allAudiences ? html`
            <div>
              <label class="check"><input type="checkbox" data-aud data-kind="public" ${hasAudience('public', '') ? 'checked' : ''}> <span><strong>Public</strong><br><span class="tiny muted">Visible sur la page d’accueil sans connexion</span></span></label>
              <label class="check"><input type="checkbox" data-aud data-kind="all" ${hasAudience('all', '') ? 'checked' : ''}> <span><strong>Tous les utilisateurs</strong><br><span class="tiny muted">Tous les comptes actifs</span></span></label>
            </div>
            <div>
              <div class="label">Rôles</div>
              ${roles.map((r) => html`<label class="check"><input type="checkbox" data-aud data-kind="role" value="${r.slug}" ${hasAudience('role', r.slug) ? 'checked' : ''}> ${r.name}</label>`)}
            </div>` : ''}
          <div>
            <div class="label">Niveaux ${!allAudiences ? html`<span class="tiny muted">(votre périmètre)</span>` : ''}</div>
            ${allowedLevels.length ? allowedLevels.map((l) => html`<label class="check"><input type="checkbox" data-aud data-kind="level" value="${l.id}" ${hasAudience('level', l.id) ? 'checked' : ''}> ${l.name}</label>`) : html`<p class="hint">Aucun niveau disponible.</p>`}
          </div>
          <div>
            <div class="label">Parcours ${!allAudiences ? html`<span class="tiny muted">(votre périmètre)</span>` : ''}</div>
            ${allowedParcours.length ? allowedParcours.map((p) => html`<label class="check"><input type="checkbox" data-aud data-kind="parcours" value="${p.id}" ${hasAudience('parcours', p.id) ? 'checked' : ''}> ${p.name}</label>`) : html`<p class="hint">Aucun parcours disponible.</p>`}
          </div>
          <div>
            <div class="label">Groupes ${!allAudiences ? html`<span class="tiny muted">(votre périmètre)</span>` : ''}</div>
            ${allowedGroups.length ? allowedGroups.map((g) => html`<label class="check"><input type="checkbox" data-aud data-kind="group" value="${g.name}" ${hasAudience('group', g.name) ? 'checked' : ''}> ${g.name}</label>`) : html`<p class="hint">Aucun groupe disponible.</p>`}
          </div>
        </div>
      </section>

      <section class="card card-pad">
        <h2 style="font-size:1.05rem">Pièces jointes</h2>
        <p class="hint">PDF, images, documents Office, audio. Taille maximale : ${state.settings.max_upload_mb || 8} Mo par fichier.</p>
        <div id="file-list">${attachedFiles.map((f) => html`
          <div class="attachment" data-file="${f.id}">${icon('file')}<div class="name">${f.filename} <span class="tiny muted">${fileSize(f.size)}</span></div>
            <button type="button" class="btn btn-icon" data-remove-file="${f.id}" aria-label="Retirer">${icon('close')}</button></div>`)}
        </div>
        <label class="btn btn-secondary btn-sm mt1" style="cursor:pointer">
          ${icon('paperclip')} Ajouter un fichier
          <input type="file" id="file-input" multiple hidden accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.pptx,.xlsx,.txt,.mp3,.wav,.ogg">
        </label>
        <div id="upload-status" class="hint"></div>
      </section>

      <section class="card card-pad">
        <h2 style="font-size:1.05rem">Diffusion</h2>
        <div class="role-choice" style="grid-template-columns:repeat(3,1fr)">
          <label data-status-label="draft" class="${defaultStatus === 'draft' ? 'selected' : ''}"><input type="radio" name="status" value="draft" ${defaultStatus === 'draft' ? 'checked' : ''}><span><strong>Brouillon</strong><span class="tiny muted">Non visible</span></span></label>
          <label data-status-label="published" class="${defaultStatus === 'published' ? 'selected' : ''}"><input type="radio" name="status" value="published" ${defaultStatus === 'published' ? 'checked' : ''}><span><strong>Publier</strong><span class="tiny muted">Notification immédiate</span></span></label>
          <label data-status-label="scheduled" class="${defaultStatus === 'scheduled' ? 'selected' : ''}"><input type="radio" name="status" value="scheduled" ${defaultStatus === 'scheduled' ? 'checked' : ''}><span><strong>Programmer</strong><span class="tiny muted">Date et heure</span></span></label>
        </div>
        <div class="field mt2 ${defaultStatus === 'scheduled' ? '' : 'hidden'}" id="schedule-field">
          <label class="label" for="f-publish-at">Date et heure de publication <span class="req">*</span></label>
          <input class="input" type="datetime-local" id="f-publish-at" value="${pub?.publish_at ? new Date(new Date(pub.publish_at).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''}">
        </div>
        ${isEdit && pub?.status === 'published' ? html`<div class="alert alert-info" style="margin-bottom:0">${icon('info')}<div class="small">Cette publication est déjà diffusée. Une modification de texte ou de pièce jointe ne renvoie pas de nouvelle notification aux mêmes destinataires.</div></div>` : ''}
      </section>

      <div class="flex end">
        <a class="btn btn-secondary" href="${isEdit ? `#/annonces/${id}` : '#/annonces'}">Annuler</a>
        <button class="btn btn-primary" type="submit" id="save-pub">${icon('save')} ${isEdit ? 'Enregistrer' : 'Créer la publication'}</button>
      </div>
    </form>
  `);

  const updateStatusLabels = () => {
    root.querySelectorAll('[data-status-label]').forEach((label) => {
      label.classList.toggle('selected', label.querySelector('input').checked);
    });
    const checked = root.querySelector('input[name="status"]:checked')?.value;
    document.getElementById('schedule-field').classList.toggle('hidden', checked !== 'scheduled');
  };
  root.querySelectorAll('input[name="status"]').forEach((r) => r.addEventListener('change', updateStatusLabels));

  const fileInput = document.getElementById('file-input');
  fileInput.addEventListener('change', async () => {
    const files = [...fileInput.files];
    const status = document.getElementById('upload-status');
    for (const file of files) {
      status.textContent = `Téléversement de ${file.name}…`;
      try {
        const uploaded = await uploadFile(file);
        attachedFiles.push(uploaded);
        document.getElementById('file-list').insertAdjacentHTML('beforeend', String(html`
          <div class="attachment" data-file="${uploaded.id}">${icon('file')}<div class="name">${uploaded.filename} <span class="tiny muted">${fileSize(uploaded.size)}</span></div>
          <button type="button" class="btn btn-icon" data-remove-file="${uploaded.id}" aria-label="Retirer">${icon('close')}</button></div>`));
        bindRemove();
        status.textContent = `${file.name} ajouté.`;
      } catch (err) {
        status.textContent = '';
        toast(`${file.name} : ${err.message}`, 'error');
      }
    }
    fileInput.value = '';
  });
  const bindRemove = () => {
    root.querySelectorAll('[data-remove-file]').forEach((btn) => {
      btn.onclick = () => {
        const fid = Number(btn.dataset.removeFile);
        const idx = attachedFiles.findIndex((f) => f.id === fid);
        if (idx >= 0) attachedFiles.splice(idx, 1);
        root.querySelector(`[data-file="${fid}"]`)?.remove();
      };
    });
  };
  bindRemove();

  document.getElementById('pub-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const errorBox = document.getElementById('editor-error');
    errorBox.innerHTML = '';
    const title = document.getElementById('f-title').value.trim();
    const body = document.getElementById('f-body').value.trim();
    if (title.length < 3) return (errorBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>Le titre doit contenir au moins 3 caractères.</div></div>`));
    if (!body && !attachedFiles.length) return (errorBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>Ajoutez un texte ou au moins une pièce jointe.</div></div>`));
    const audiences = [...root.querySelectorAll('[data-aud]:checked')].map((el) => {
      const kind = el.dataset.kind;
      if (kind === 'level' || kind === 'parcours') return { kind, target_id: Number(el.value) };
      if (kind === 'role') return { kind, target_text: el.value };
      if (kind === 'group') return { kind, target_text: el.value };
      return { kind };
    });
    if (!audiences.length) return (errorBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>Choisissez au moins un destinataire.</div></div>`));
    const status = root.querySelector('input[name="status"]:checked').value;
    const publishAtValue = document.getElementById('f-publish-at').value;
    if (status === 'scheduled' && !publishAtValue) return (errorBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>Choisissez la date et l’heure de publication programmée.</div></div>`));
    const payload = {
      title,
      body,
      category_id: form.category_id.value || null,
      priority: form.priority.value,
      status,
      publish_at: status === 'scheduled' ? new Date(publishAtValue).toISOString() : null,
      pinned: Boolean(document.getElementById('f-pinned')?.checked),
      audiences,
      file_ids: attachedFiles.map((f) => f.id),
    };
    const btn = document.getElementById('save-pub');
    setLoading(btn, true, 'Enregistrement…');
    try {
      const res = isEdit
        ? await api(`/publications/${id}`, { method: 'PUT', body: payload })
        : await api('/publications', { method: 'POST', body: payload });
      toast(res.message, 'success');
      navigate(`/annonces/${isEdit ? id : res.id}`);
    } catch (err) {
      showFormError(root, err.message);
      setLoading(btn, false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });
}
