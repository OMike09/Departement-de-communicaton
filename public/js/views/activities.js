import {
  state, api, html, icon, modal, confirmDialog, toast, fmtDate, can,
  loading, emptyState, setLoading,
} from '../api.js';

const CATS = {
  recherche: 'Recherche', publication_scientifique: 'Publication scientifique', conference: 'Conférence',
  seminaire: 'Séminaire', atelier: 'Atelier / formation', soutenance: 'Soutenance', partenariat: 'Partenariat',
  association: 'Association étudiante', stage: 'Stage', opportunite: 'Opportunité professionnelle', autre: 'Autre',
};

export async function renderActivities(root) {
  const manage = can('activities.manage');
  let category = '';

  root.innerHTML = String(html`
    <div class="page-header">
      <div>
        <h1 class="page-title">Recherche et vie du département</h1>
        <p class="page-sub">Projets, publications, conférences, soutenances, partenariats et opportunités publiés par le département.</p>
      </div>
      ${manage ? html`<div class="page-actions"><button class="btn btn-primary" id="add-activity">${icon('plus')} Ajouter une activité</button></div>` : ''}
    </div>
    <div class="toolbar">
      <div class="field"><label class="label sr-only" for="act-category">Catégorie</label>
        <select class="select" id="act-category"><option value="">Toutes les rubriques</option>
          ${Object.entries(CATS).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select></div>
    </div>
    <div id="act-box">${loading()}</div>
  `);

  const box = document.getElementById('act-box');
  const load = async () => {
    box.innerHTML = String(loading());
    try {
      const data = await api(`/activities${category ? `?category=${category}` : ''}`);
      if (!data.activities.length) {
        box.innerHTML = String(emptyState('Aucune activité publiée', manage ? 'Ajoutez un projet, une conférence, une soutenance ou un partenariat.' : 'Les activités scientifiques et professionnelles validées apparaîtront ici.', 'graduation'));
        return;
      }
      box.innerHTML = String(html`<div class="grid cols-2">
        ${data.activities.map((a) => html`
          <article class="card card-pad">
            <div class="flex between mb1 flex-wrap">
              <span class="badge">${CATS[a.category] || a.category}</span>
              <span class="muted tiny">${a.date_start ? fmtDate(a.date_start) : 'Date non précisée'}${a.date_end ? ` → ${fmtDate(a.date_end)}` : ''}</span>
            </div>
            <h3 style="margin:.2rem 0 .3rem">${a.title}</h3>
            ${a.description ? html`<p class="small" style="color:var(--texte-2)">${a.description}</p>` : ''}
            <div class="doc-meta mb1">
              ${a.organizer ? html`<span>${icon('users')} ${a.organizer}</span>` : ''}
              ${a.location ? html`<span>${icon('map-pin')} ${a.location}</span>` : ''}
            </div>
            <div class="doc-actions">
              ${a.link ? html`<a class="btn btn-secondary btn-sm" href="${a.link}" target="_blank" rel="noopener noreferrer">${icon('link')} En savoir plus</a>` : ''}
              ${manage ? html`<button class="btn btn-ghost btn-sm" data-edit-act="${a.id}">${icon('edit')} Modifier</button>
                <button class="btn btn-ghost btn-sm" data-del-act="${a.id}">${icon('trash')} Supprimer</button>` : ''}
            </div>
          </article>`)}
      </div>`);
      box.querySelectorAll('[data-edit-act]').forEach((btn) => btn.addEventListener('click', () => {
        const a = data.activities.find((x) => x.id === Number(btn.dataset.editAct));
        if (a) openActivityForm(a, load);
      }));
      box.querySelectorAll('[data-del-act]').forEach((btn) => btn.addEventListener('click', async () => {
        if (!(await confirmDialog('Supprimer cette activité ?', { confirmLabel: 'Supprimer', danger: true }))) return;
        try {
          await api(`/activities/${btn.dataset.delAct}`, { method: 'DELETE' });
          toast('Activité supprimée.', 'success');
          load();
        } catch (err) { toast(err.message, 'error'); }
      }));
    } catch (err) {
      box.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>${err.message}</div></div>`);
    }
  };

  document.getElementById('add-activity')?.addEventListener('click', () => openActivityForm(null, load));
  document.getElementById('act-category').addEventListener('change', (e) => { category = e.target.value; load(); });
  await load();
}

function openActivityForm(activity, onSaved) {
  modal({
    title: activity ? 'Modifier l’activité' : 'Ajouter une activité',
    wide: true,
    body: html`
      <div id="act-form-error"></div>
      <form id="act-form">
        <div class="field"><label class="label" for="a-title">Titre <span class="req">*</span></label>
          <input class="input" id="a-title" maxlength="200" value="${activity?.title || ''}"></div>
        <div class="form-grid">
          <div class="field"><label class="label" for="a-category">Rubrique</label>
            <select class="select" id="a-category">${Object.entries(CATS).map(([k, v]) => html`<option value="${k}" ${activity?.category === k ? 'selected' : ''}>${v}</option>`)}</select></div>
          <div class="field"><label class="label" for="a-organizer">Organisateur / responsable</label>
            <input class="input" id="a-organizer" value="${activity?.organizer || ''}" placeholder="Laisser vide si non précisé"></div>
          <div class="field"><label class="label" for="a-start">Date de début</label><input class="input" type="date" id="a-start" value="${activity?.date_start ? String(activity.date_start).slice(0, 10) : ''}"></div>
          <div class="field"><label class="label" for="a-end">Date de fin</label><input class="input" type="date" id="a-end" value="${activity?.date_end ? String(activity.date_end).slice(0, 10) : ''}"></div>
          <div class="field"><label class="label" for="a-location">Lieu</label><input class="input" id="a-location" value="${activity?.location || ''}"></div>
          <div class="field"><label class="label" for="a-link">Lien utile</label><input class="input" id="a-link" value="${activity?.link || ''}" placeholder="https://…"></div>
        </div>
        <div class="field"><label class="label" for="a-desc">Description</label><textarea class="textarea" id="a-desc" rows="5" maxlength="5000">${activity?.description || ''}</textarea></div>
        <div class="hint">Ne publiez que des informations confirmées par le département. Les données issues du document officiel doivent rester distinctes des contenus ajoutés ultérieurement.</div>
      </form>`,
    footer: html`<button class="btn btn-secondary" data-close>Annuler</button><button class="btn btn-primary" id="a-submit">${icon('save')} Enregistrer</button>`,
    onMount(overlay, close) {
      overlay.querySelector('#a-submit').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const errBox = overlay.querySelector('#act-form-error');
        errBox.innerHTML = '';
        const title = overlay.querySelector('#a-title').value.trim();
        if (title.length < 2) return (errBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>Indiquez un titre.</div></div>`));
        setLoading(btn, true, 'Enregistrement…');
        try {
          const payload = {
            title,
            category: overlay.querySelector('#a-category').value,
            organizer: overlay.querySelector('#a-organizer').value,
            date_start: overlay.querySelector('#a-start').value || null,
            date_end: overlay.querySelector('#a-end').value || null,
            location: overlay.querySelector('#a-location').value,
            link: overlay.querySelector('#a-link').value,
            description: overlay.querySelector('#a-desc').value,
          };
          const res = activity
            ? await api(`/activities/${activity.id}`, { method: 'PUT', body: payload })
            : await api('/activities', { method: 'POST', body: payload });
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
