import {
  state, api, uploadFile, html, icon, esc, modal, confirmDialog, toast,
  fmtDate, can, fileUrl, fileSize, loading, emptyState, setLoading, showFormError,
} from '../api.js';

const VISIBILITY = {
  public: 'Public', all: 'Tous les utilisateurs', etudiant: 'Étudiants', enseignant: 'Enseignants',
  personnel: 'Personnel administratif', level: 'Niveau précis', parcours: 'Parcours précis',
};
const DOC_CATEGORIES = ['Cours', 'TD et exercices', 'Présentation', 'Note administrative', 'Calendrier', 'Recherche', 'Mémoire / thèse', 'Formulaire', 'Document'];

function fileIconName(mime) {
  if (!mime) return 'file';
  if (mime.startsWith('image/')) return 'eye';
  if (mime.includes('pdf')) return 'file';
  if (mime.includes('presentation') || mime.includes('powerpoint')) return 'chart';
  return 'file';
}

export async function renderDocuments(root) {
  const canUpload = can('documents.upload');
  const manage = can('documents.manage');
  let q = '';
  let category = '';
  let level = '';
  let parcours = '';
  let mine = false;
  let archived = false;

  root.innerHTML = String(html`
    <div class="page-header">
      <div>
        <h1 class="page-title">Bibliothèque documentaire</h1>
        <p class="page-sub">Cours, supports, notes administratives, calendriers et documents utiles, classés et protégés selon vos droits.</p>
      </div>
      ${canUpload ? html`<div class="page-actions"><button class="btn btn-primary" id="add-doc">${icon('upload')} Ajouter un document</button></div>` : ''}
    </div>
    <div class="toolbar">
      <div class="field search-field">
        <label class="label sr-only" for="doc-search">Rechercher</label>
        <div class="search-input">${icon('search')}<input class="input" id="doc-search" type="search" placeholder="Rechercher un document…"></div>
      </div>
      <div class="field"><label class="label sr-only" for="doc-cat">Catégorie</label><select class="select" id="doc-cat"><option value="">Toutes les catégories</option></select></div>
      <div class="field"><label class="label sr-only" for="doc-level">Niveau</label><select class="select" id="doc-level"><option value="">Tous les niveaux</option></select></div>
      <div class="field"><label class="label sr-only" for="doc-parcours">Parcours</label><select class="select" id="doc-parcours"><option value="">Tous les parcours</option></select></div>
      ${canUpload ? html`<label class="check" style="padding-bottom:.6rem"><input type="checkbox" id="doc-mine"> Mes dépôts</label>` : ''}
      ${manage ? html`<label class="check" style="padding-bottom:.6rem"><input type="checkbox" id="doc-archived"> Archives</label>` : ''}
    </div>
    <div id="doc-summary" class="muted small mb2"></div>
    <div id="doc-box">${loading()}</div>
  `);

  const structure = state.structure || (await api('/structure').then((s) => (state.structure = s)).catch(() => ({ levels: [], parcours: [] })));
  const levelSelect = document.getElementById('doc-level');
  levelSelect.innerHTML += structure.levels.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
  const parcoursSelect = document.getElementById('doc-parcours');
  parcoursSelect.innerHTML += structure.parcours.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');

  const box = document.getElementById('doc-box');
  const summary = document.getElementById('doc-summary');
  let catsLoaded = false;

  const load = async () => {
    box.innerHTML = String(loading());
    const params = new URLSearchParams({ limit: '60' });
    if (q) params.set('q', q);
    if (category) params.set('category', category);
    if (level) params.set('level', level);
    if (parcours) params.set('parcours', parcours);
    if (mine) params.set('mine', '1');
    if (archived && manage) params.set('archived', '1');
    try {
      const data = await api(`/documents?${params.toString()}`);
      if (!catsLoaded) {
        catsLoaded = true;
        const catSelect = document.getElementById('doc-cat');
        const all = [...new Set([...DOC_CATEGORIES, ...data.categories])];
        catSelect.innerHTML = `<option value="">Toutes les catégories</option>` + all.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
        catSelect.value = category;
      }
      summary.textContent = `${data.total} document(s) accessible(s)`;
      if (!data.documents.length) {
        box.innerHTML = String(emptyState('Aucun document', q || category || level || parcours ? 'Aucun document ne correspond à ces filtres.' : 'La bibliothèque est vide pour le moment. Les documents déposés par les enseignants et l’administration apparaîtront ici.', 'folder'));
        return;
      }
      box.innerHTML = String(html`<div class="doc-grid">
        ${data.documents.map((d) => html`
          <article class="doc-card">
            <div class="flex between">
              <div class="doc-icon">${icon(fileIconName(d.mime))}</div>
              <div class="flex" style="gap:.25rem">
                ${d.archived ? html`<span class="badge badge-err">Archivé</span>` : ''}
                <span class="badge badge-gris">${VISIBILITY[d.visibility] || d.visibility}</span>
              </div>
            </div>
            <h3 class="doc-title">${d.title}</h3>
            ${d.description ? html`<p class="small muted" style="margin:0">${d.description.length > 110 ? `${d.description.slice(0, 110)}…` : d.description}</p>` : ''}
            <div class="doc-meta">
              <span class="badge" style="background:var(--bleu-clair)">${d.category}</span>
              ${d.level_name ? html`<span>${icon('graduation')} ${d.level_name}</span>` : ''}
              ${d.parcours_name ? html`<span>${d.parcours_name}</span>` : ''}
              <span>${fileSize(d.size)}</span>
              <span>${fmtDate(d.created_at)}</span>
            </div>
            <div class="doc-meta">${icon('user')} ${d.uploader_name}</div>
            <div class="doc-actions">
              ${/^application\/pdf$|^image\//.test(d.mime) ? html`<a class="btn btn-secondary btn-sm" href="${fileUrl(d.file_id, true)}" target="_blank" rel="noopener">${icon('eye')} Aperçu</a>` : ''}
              <a class="btn btn-primary btn-sm" href="${fileUrl(d.file_id)}">${icon('download')} Télécharger</a>
              ${(d.uploaded_by === state.user.id || manage) ? html`<button class="btn btn-ghost btn-sm" data-edit-doc="${d.id}">${icon('edit')} Modifier</button>
                <button class="btn btn-ghost btn-sm" data-archive-doc="${d.id}" data-archived="${d.archived ? '1' : '0'}">${icon(d.archived ? 'refresh' : 'archive')} ${d.archived ? 'Restaurer' : 'Archiver'}</button>` : ''}
            </div>
          </article>`)}
      </div>`);

      box.querySelectorAll('[data-edit-doc]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const doc = data.documents.find((x) => x.id === Number(btn.dataset.editDoc));
          if (doc) openDocumentForm(doc, load);
        });
      });
      box.querySelectorAll('[data-archive-doc]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const isArchived = btn.dataset.archived === '1';
          const ok = await confirmDialog(isArchived ? 'Restaurer ce document ? Il redeviendra visible selon sa visibilité.' : 'Archiver ce document ? Il ne sera plus visible des utilisateurs (l’historique est conservé).', { confirmLabel: isArchived ? 'Restaurer' : 'Archiver' });
          if (!ok) return;
          try {
            const res = await api(`/documents/${btn.dataset.archiveDoc}/archive`, { method: 'POST', body: { archived: !isArchived } });
            toast(res.message, 'success');
            load();
          } catch (err) {
            toast(err.message, 'error');
          }
        });
      });
    } catch (err) {
      box.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>${err.message}</div></div>`);
    }
  };

  document.getElementById('add-doc')?.addEventListener('click', () => openDocumentForm(null, load));
  let timer;
  document.getElementById('doc-search').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { q = e.target.value.trim(); load(); }, 300);
  });
  document.getElementById('doc-cat').addEventListener('change', (e) => { category = e.target.value; load(); });
  levelSelect.addEventListener('change', (e) => { level = e.target.value; load(); });
  parcoursSelect.addEventListener('change', (e) => { parcours = e.target.value; load(); });
  document.getElementById('doc-mine')?.addEventListener('change', (e) => { mine = e.target.checked; load(); });
  document.getElementById('doc-archived')?.addEventListener('change', (e) => { archived = e.target.checked; load(); });
  await load();
}

async function openDocumentForm(doc, onSaved) {
  const manage = can('documents.manage');
  const structure = state.structure || { levels: [], parcours: [] };
  const visOptions = manage
    ? ['all', 'public', 'etudiant', 'enseignant', 'personnel', 'level', 'parcours']
    : ['all', 'etudiant', 'enseignant', 'personnel', 'level', 'parcours'];
  const m = modal({
    title: doc ? 'Modifier le document' : 'Ajouter un document',
    wide: true,
    body: html`
      <div id="doc-form-error"></div>
      <form id="doc-form" novalidate>
        <div class="field">
          <label class="label" for="d-title">Titre <span class="req">*</span></label>
          <input class="input" id="d-title" maxlength="200" required value="${doc?.title || ''}" placeholder="Intitulé du document">
        </div>
        <div class="field">
          <label class="label" for="d-desc">Description</label>
          <textarea class="textarea" id="d-desc" rows="3" maxlength="3000" placeholder="Objet et contenu du document…">${doc?.description || ''}</textarea>
        </div>
        <div class="form-grid">
          <div class="field">
            <label class="label" for="d-category">Catégorie</label>
            <input class="input" id="d-category" list="doc-cat-list" value="${doc?.category || 'Document'}">
            <datalist id="doc-cat-list">${DOC_CATEGORIES.map((c) => html`<option value="${c}"></option>`)}</datalist>
          </div>
          <div class="field">
            <label class="label" for="d-visibility">Visibilité <span class="req">*</span></label>
            <select class="select" id="d-visibility">
              ${visOptions.map((v) => html`<option value="${v}" ${doc?.visibility === v ? 'selected' : ''}>${VISIBILITY[v]}</option>`)}
            </select>
          </div>
          <div class="field">
            <label class="label" for="d-level">Niveau concerné</label>
            <select class="select" id="d-level"><option value="">Tous / non précisé</option>
              ${structure.levels.map((l) => html`<option value="${l.id}" ${doc?.level_id === l.id ? 'selected' : ''}>${l.name}</option>`)}
            </select>
          </div>
          <div class="field">
            <label class="label" for="d-parcours">Parcours concerné</label>
            <select class="select" id="d-parcours"><option value="">Tous / non précisé</option>
              ${structure.parcours.map((p) => html`<option value="${p.id}" ${doc?.parcours_id === p.id ? 'selected' : ''}>${p.name}</option>`)}
            </select>
          </div>
        </div>
        ${doc ? '' : html`<div class="field">
          <label class="label" for="d-file">Fichier <span class="req">*</span></label>
          <input class="input" type="file" id="d-file" accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.pptx,.xlsx,.txt,.mp3,.wav,.ogg">
          <div class="hint">PDF, images, Office, audio · max ${state.settings.max_upload_mb || 8} Mo.</div>
        </div>`}
        <div class="hint">${manage ? 'En tant que gestionnaire, vous pouvez publier un document visible publiquement.' : 'La visibilité « Public » est réservée à la direction. Les documents « Niveau » ou « Parcours » doivent relever de votre périmètre.'}</div>
      </form>`,
    footer: html`<button class="btn btn-secondary" data-close>Annuler</button>
      <button class="btn btn-primary" id="d-submit">${icon('save')} ${doc ? 'Enregistrer' : 'Déposer le document'}</button>`,
    onMount(overlay, close) {
      const vis = overlay.querySelector('#d-visibility');
      const levelField = overlay.querySelector('#d-level').closest('.field');
      const parcoursField = overlay.querySelector('#d-parcours').closest('.field');
      const syncVisibility = () => {
        const v = vis.value;
        levelField.style.display = v === 'level' ? '' : 'none';
        parcoursField.style.display = v === 'parcours' ? '' : 'none';
      };
      vis.addEventListener('change', syncVisibility);
      if (doc) {
        levelField.style.display = doc.visibility === 'level' ? '' : 'none';
        parcoursField.style.display = doc.visibility === 'parcours' ? '' : 'none';
      } else syncVisibility();

      overlay.querySelector('#d-submit').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const errBox = overlay.querySelector('#doc-form-error');
        errBox.innerHTML = '';
        const title = overlay.querySelector('#d-title').value.trim();
        const visibility = vis.value;
        const file = overlay.querySelector('#d-file')?.files?.[0];
        if (title.length < 2) {
          errBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>Indiquez un titre.</div></div>`);
          return;
        }
        if (!doc && !file) {
          errBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>Choisissez un fichier à déposer.</div></div>`);
          return;
        }
        setLoading(btn, true, doc ? 'Enregistrement…' : 'Téléversement…');
        try {
          let fileId = doc?.file_id;
          if (file) {
            const uploaded = await uploadFile(file);
            fileId = uploaded.id;
          }
          const payload = {
            title,
            description: overlay.querySelector('#d-desc').value,
            category: overlay.querySelector('#d-category').value,
            visibility,
            level_id: visibility === 'level' ? overlay.querySelector('#d-level').value : null,
            parcours_id: visibility === 'parcours' ? overlay.querySelector('#d-parcours').value : null,
            file_id: fileId,
          };
          const res = doc
            ? await api(`/documents/${doc.id}`, { method: 'PUT', body: payload })
            : await api('/documents', { method: 'POST', body: payload });
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
  return m;
}
