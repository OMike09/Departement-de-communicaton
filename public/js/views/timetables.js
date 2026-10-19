import {
  state, api, uploadFile, html, icon, esc, modal, confirmDialog, toast,
  fmtDate, fmtDateTime, fmtTime, can, fileUrl, fileSize, loading, emptyState,
  setLoading, toLocalInput,
} from '../api.js';

const EVENT_TYPES = {
  examen: 'Examen', soutenance: 'Soutenance', conference: 'Conférence', atelier: 'Atelier',
  reunion: 'Réunion', autre: 'Autre',
};
const AUDIENCES = { public: 'Public', all: 'Tous les utilisateurs', etudiant: 'Étudiants', enseignant: 'Enseignants', personnel: 'Personnel administratif' };

/* ------------------------------ Emplois du temps ------------------------------ */
export async function renderTimetables(root) {
  const manage = can('timetables.manage');
  let archived = false;
  root.innerHTML = String(html`
    <div class="page-header">
      <div>
        <h1 class="page-title">Emplois du temps</h1>
        <p class="page-sub">Emplois du temps publiés par les responsables, avec les dates, niveaux et groupes concernés.</p>
      </div>
      ${manage ? html`<div class="page-actions"><button class="btn btn-primary" id="add-tt">${icon('plus')} Publier un emploi du temps</button></div>` : ''}
    </div>
    ${manage ? html`<div class="toolbar"><label class="check"><input type="checkbox" id="tt-archived"> Afficher les archives</label></div>` : ''}
    <div id="tt-box">${loading()}</div>
  `);

  const box = document.getElementById('tt-box');
  const structure = state.structure || (await api('/structure').then((s) => (state.structure = s)).catch(() => ({ levels: [], parcours: [] })));

  const load = async () => {
    box.innerHTML = String(loading());
    try {
      const data = await api(`/timetables${archived && manage ? '?archived=1' : ''}`);
      if (!data.timetables.length) {
        box.innerHTML = String(emptyState('Aucun emploi du temps', manage ? 'Publiez le premier emploi du temps du département.' : 'Les emplois du temps concernant votre niveau ou votre parcours apparaîtront ici.', 'calendar'));
        return;
      }
      box.innerHTML = String(html`<div class="grid cols-2">
        ${data.timetables.map((t) => html`
          <article class="card card-pad">
            <div class="flex between mb1">
              <h3 style="margin:0">${t.title}</h3>
              ${t.archived ? html`<span class="badge badge-err">Archivé</span>` : html`<span class="badge badge-ok">Publié</span>`}
            </div>
            <div class="doc-meta mb1">
              ${t.level_name ? html`<span class="badge">${t.level_name}</span>` : html`<span class="badge badge-gris">Tous niveaux</span>`}
              ${t.parcours_name ? html`<span class="badge badge-gris">${t.parcours_name}</span>` : ''}
              ${t.group_name ? html`<span class="chip">${t.group_name}</span>` : ''}
              ${t.semester ? html`<span class="chip">${t.semester}</span>` : ''}
              ${t.academic_year ? html`<span class="chip">${t.academic_year}</span>` : ''}
            </div>
            ${t.date_start ? html`<p class="small muted">${fmtDate(t.date_start)}${t.date_end ? ` → ${fmtDate(t.date_end)}` : ''}</p>` : ''}
            ${t.note ? html`<p class="small">${t.note}</p>` : ''}
            <div class="doc-actions">
              ${t.file_id ? html`<a class="btn btn-primary btn-sm" href="${fileUrl(t.file_id)}">${icon('download')} Télécharger</a>
                ${/^application\/pdf$|^image\//.test(t.mime) ? html`<a class="btn btn-secondary btn-sm" href="${fileUrl(t.file_id, true)}" target="_blank" rel="noopener">${icon('eye')} Aperçu</a>` : ''}` : html`<span class="muted small">Aucun fichier joint</span>`}
              ${manage ? html`<button class="btn btn-ghost btn-sm" data-edit-tt="${t.id}">${icon('edit')} Modifier</button>
                <button class="btn btn-ghost btn-sm" data-archive-tt="${t.id}" data-archived="${t.archived ? '1' : '0'}">${icon(t.archived ? 'refresh' : 'archive')} ${t.archived ? 'Restaurer' : 'Archiver'}</button>
                <button class="btn btn-ghost btn-sm" data-delete-tt="${t.id}">${icon('trash')} Supprimer</button>` : ''}
            </div>
          </article>`)}
      </div>`);

      box.querySelectorAll('[data-edit-tt]').forEach((btn) => btn.addEventListener('click', () => {
        const tt = data.timetables.find((t) => t.id === Number(btn.dataset.editTt));
        openTimetableForm(tt, load);
      }));
      box.querySelectorAll('[data-archive-tt]').forEach((btn) => btn.addEventListener('click', async () => {
        const isArchived = btn.dataset.archived === '1';
        if (!(await confirmDialog(isArchived ? 'Restaurer cet emploi du temps ?' : 'Archiver cet emploi du temps ? Il ne sera plus visible des étudiants.', { confirmLabel: isArchived ? 'Restaurer' : 'Archiver' }))) return;
        try {
          const res = await api(`/timetables/${btn.dataset.archiveTt}/archive`, { method: 'POST', body: { archived: !isArchived } });
          toast(res.message, 'success');
          load();
        } catch (err) { toast(err.message, 'error'); }
      }));
      box.querySelectorAll('[data-delete-tt]').forEach((btn) => btn.addEventListener('click', async () => {
        if (!(await confirmDialog('Supprimer définitivement cet emploi du temps ? Préférez l’archivage pour conserver l’historique.', { title: 'Supprimer', confirmLabel: 'Supprimer', danger: true }))) return;
        try {
          await api(`/timetables/${btn.dataset.deleteTt}`, { method: 'DELETE' });
          toast('Emploi du temps supprimé.', 'success');
          load();
        } catch (err) { toast(err.message, 'error'); }
      }));
    } catch (err) {
      box.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>${err.message}</div></div>`);
    }
  };

  document.getElementById('add-tt')?.addEventListener('click', () => openTimetableForm(null, load));
  document.getElementById('tt-archived')?.addEventListener('change', (e) => { archived = e.target.checked; load(); });
  await load();
}

function openTimetableForm(tt, onSaved) {
  const structure = state.structure || { levels: [], parcours: [] };
  modal({
    title: tt ? 'Modifier l’emploi du temps' : 'Publier un emploi du temps',
    wide: true,
    body: html`
      <div id="tt-form-error"></div>
      <form id="tt-form">
        <div class="field"><label class="label" for="tt-title">Titre <span class="req">*</span></label>
          <input class="input" id="tt-title" value="${tt?.title || ''}" placeholder="Ex. Emploi du temps — Semestre 1"></div>
        <div class="form-grid">
          <div class="field"><label class="label" for="tt-level">Niveau</label>
            <select class="select" id="tt-level"><option value="">Tous niveaux</option>
              ${structure.levels.map((l) => html`<option value="${l.id}" ${tt?.level_id === l.id ? 'selected' : ''}>${l.name}</option>`)}</select></div>
          <div class="field"><label class="label" for="tt-parcours">Parcours</label>
            <select class="select" id="tt-parcours"><option value="">Tous parcours</option>
              ${structure.parcours.map((p) => html`<option value="${p.id}" ${tt?.parcours_id === p.id ? 'selected' : ''}>${p.name}</option>`)}</select></div>
          <div class="field"><label class="label" for="tt-group">Groupe</label><input class="input" id="tt-group" value="${tt?.group_name || ''}" placeholder="Laisser vide si tous les groupes"></div>
          <div class="field"><label class="label" for="tt-year">Année académique</label><input class="input" id="tt-year" value="${tt?.academic_year || state.settings.academic_year || ''}" placeholder="Ex. 2026-2027"></div>
          <div class="field"><label class="label" for="tt-semester">Semestre / session</label><input class="input" id="tt-semester" value="${tt?.semester || ''}" placeholder="Ex. Semestre 1"></div>
          <div class="field"><label class="label" for="tt-start">Date de début</label><input class="input" type="date" id="tt-start" value="${tt?.date_start ? String(tt.date_start).slice(0, 10) : ''}"></div>
          <div class="field"><label class="label" for="tt-end">Date de fin</label><input class="input" type="date" id="tt-end" value="${tt?.date_end ? String(tt.date_end).slice(0, 10) : ''}"></div>
        </div>
        <div class="field"><label class="label" for="tt-note">Note / précisions</label><textarea class="textarea" id="tt-note" rows="3">${tt?.note || ''}</textarea></div>
        <div class="field"><label class="label" for="tt-file">Fichier (PDF, image)</label><input class="input" type="file" id="tt-file" accept=".pdf,.jpg,.jpeg,.png,.webp">
          ${tt?.filename ? html`<div class="hint">Fichier actuel : ${tt.filename} (${fileSize(tt.size)})</div>` : ''}</div>
        <label class="check"><input type="checkbox" id="tt-notify" ${tt ? '' : 'checked'}> Notifier les étudiants concernés ${tt ? 'de la modification' : ''}</label>
        ${tt ? '' : html`<div class="hint">La notification est envoyée aux étudiants actifs du niveau et du parcours choisis.</div>`}
      </form>`,
    footer: html`<button class="btn btn-secondary" data-close>Annuler</button><button class="btn btn-primary" id="tt-submit">${icon('save')} ${tt ? 'Enregistrer' : 'Publier'}</button>`,
    onMount(overlay, close) {
      overlay.querySelector('#tt-submit').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const errBox = overlay.querySelector('#tt-form-error');
        errBox.innerHTML = '';
        const title = overlay.querySelector('#tt-title').value.trim();
        if (title.length < 2) return (errBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>Indiquez un titre.</div></div>`));
        setLoading(btn, true, 'Enregistrement…');
        try {
          const file = overlay.querySelector('#tt-file').files?.[0];
          let fileId = tt?.file_id;
          if (file) fileId = (await uploadFile(file)).id;
          const payload = {
            title,
            level_id: overlay.querySelector('#tt-level').value || null,
            parcours_id: overlay.querySelector('#tt-parcours').value || null,
            group_name: overlay.querySelector('#tt-group').value,
            academic_year: overlay.querySelector('#tt-year').value,
            semester: overlay.querySelector('#tt-semester').value,
            date_start: overlay.querySelector('#tt-start').value || null,
            date_end: overlay.querySelector('#tt-end').value || null,
            note: overlay.querySelector('#tt-note').value,
            file_id: fileId,
            notify: overlay.querySelector('#tt-notify').checked,
          };
          const res = tt
            ? await api(`/timetables/${tt.id}`, { method: 'PUT', body: payload })
            : await api('/timetables', { method: 'POST', body: payload });
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

/* ------------------------------ Calendrier ------------------------------ */
export async function renderCalendar(root) {
  const manage = can('timetables.manage');
  let viewDate = new Date();
  viewDate.setDate(1);

  root.innerHTML = String(html`
    <div class="page-header">
      <div>
        <h1 class="page-title">Calendrier</h1>
        <p class="page-sub">Examens, soutenances, conférences et événements validés par le département.</p>
      </div>
      ${manage ? html`<div class="page-actions"><button class="btn btn-primary" id="add-event">${icon('plus')} Ajouter un événement</button></div>` : ''}
    </div>
    <div class="cal-layout">
      <section class="card card-pad">
        <div class="cal-head">
          <button class="btn btn-icon" id="cal-prev" aria-label="Mois précédent">${icon('arrow-left')}</button>
          <h2 id="cal-title" style="margin:0;font-size:1.15rem"></h2>
          <button class="btn btn-icon" id="cal-next" aria-label="Mois suivant">${icon('arrow-right')}</button>
        </div>
        <div class="cal-grid" id="cal-grid"></div>
        <div class="hint mt1">Les événements affichés correspondent à votre niveau, votre parcours et votre rôle. Cliquez sur un événement pour le détail.</div>
      </section>
      <aside class="card">
        <div class="card-head"><h2>${icon('clock')} À venir</h2></div>
        <div class="card-body" id="cal-upcoming">${loading()}</div>
      </aside>
    </div>
  `);

  const grid = document.getElementById('cal-grid');
  const title = document.getElementById('cal-title');
  let cache = new Map();

  const rangeFor = (d) => {
    const first = new Date(d.getFullYear(), d.getMonth(), 1);
    const start = new Date(first);
    const dow = (first.getDay() + 6) % 7; // lundi = 0
    start.setDate(first.getDate() - dow);
    const end = new Date(start);
    end.setDate(start.getDate() + 41);
    return { start, end };
  };

  const openEvent = (ev) => {
    modal({
      title: ev.title,
      body: html`
        <div class="pub-meta mb2">
          <span class="badge">${EVENT_TYPES[ev.type] || ev.type}</span>
          <span>${icon('calendar')} ${fmtDateTime(ev.starts_at)}${ev.ends_at ? ` → ${fmtTime(ev.ends_at)}` : ''}</span>
          ${ev.location ? html`<span>${icon('map-pin')} ${ev.location}</span>` : ''}
          ${ev.level_name ? html`<span>${icon('graduation')} ${ev.level_name}</span>` : ''}
          ${ev.parcours_name ? html`<span>${ev.parcours_name}</span>` : ''}
        </div>
        ${ev.description ? html`<div class="body-text">${ev.description}</div>` : html`<p class="muted">Aucune description.</p>`}
        ${manage ? html`<div class="flex mt2"><button class="btn btn-secondary btn-sm" id="edit-ev">${icon('edit')} Modifier</button>
          <button class="btn btn-danger btn-sm" id="del-ev">${icon('trash')} Supprimer</button></div>` : ''}`,
      onMount(overlay, close) {
        overlay.querySelector('#edit-ev')?.addEventListener('click', () => { close(); openEventForm(ev, loadAll); });
        overlay.querySelector('#del-ev')?.addEventListener('click', async () => {
          if (!(await confirmDialog('Supprimer cet événement du calendrier ?', { confirmLabel: 'Supprimer', danger: true }))) return;
          try {
            await api(`/events/${ev.id}`, { method: 'DELETE' });
            toast('Événement supprimé.', 'success');
            close();
            loadAll();
          } catch (err) { toast(err.message, 'error'); }
        });
      },
    });
  };

  const loadMonth = async () => {
    const { start, end } = rangeFor(viewDate);
    title.textContent = viewDate.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    grid.innerHTML = '';
    for (const dow of ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']) {
      grid.insertAdjacentHTML('beforeend', `<div class="cal-dow">${dow}</div>`);
    }
    let events = [];
    try {
      const data = await api(`/events?from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(end.toISOString())}`);
      events = data.events;
    } catch {}
    cache = new Map();
    for (const ev of events) {
      const key = new Date(ev.starts_at).toDateString();
      if (!cache.has(key)) cache.set(key, []);
      cache.get(key).push(ev);
    }
    const today = new Date().toDateString();
    for (let i = 0; i < 42; i += 1) {
      const day = new Date(start);
      day.setDate(start.getDate() + i);
      const key = day.toDateString();
      const dayEvents = cache.get(key) || [];
      const cell = document.createElement('div');
      cell.className = `cal-day ${day.getMonth() !== viewDate.getMonth() ? 'other' : ''} ${key === today ? 'today' : ''}`;
      cell.innerHTML = `<div class="cal-num">${day.getDate()}</div>
        ${dayEvents.slice(0, 2).map((ev) => `<span class="cal-event" data-ev="${ev.id}" title="${esc(ev.title)}">${esc(ev.title)}</span>`).join('')}
        ${dayEvents.length > 2 ? `<span class="tiny muted">+${dayEvents.length - 2}</span>` : ''}`;
      cell.querySelectorAll('[data-ev]').forEach((el) => el.addEventListener('click', () => {
        const ev = dayEvents.find((e) => e.id === Number(el.dataset.ev));
        if (ev) openEvent(ev);
      }));
      grid.appendChild(cell);
    }
    // Cellules cliquables pour les jours avec événements (accessible)
    const upcoming = document.getElementById('cal-upcoming');
    try {
      const data = await api(`/events?from=${encodeURIComponent(new Date().toISOString())}`);
      if (!data.events.length) {
        upcoming.innerHTML = String(emptyState('Aucun événement à venir', 'Les prochains événements validés apparaîtront ici.', 'calendar'));
      } else {
        upcoming.innerHTML = String(html`${data.events.slice(0, 8).map((e) => html`
          <div class="event-item" data-up="${e.id}" role="button" tabindex="0" style="cursor:pointer">
            <div class="event-date"><div class="d">${new Date(e.starts_at).getDate()}</div><div class="m">${new Date(e.starts_at).toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '')}</div></div>
            <div><p class="event-title">${e.title}</p><p class="event-meta">${fmtTime(e.starts_at)} · ${EVENT_TYPES[e.type] || e.type}${e.location ? ` · ${e.location}` : ''}</p></div>
          </div>`)}`);
        upcoming.querySelectorAll('[data-up]').forEach((el) => {
          const ev = data.events.find((e) => e.id === Number(el.dataset.up));
          el.addEventListener('click', () => ev && openEvent(ev));
          el.addEventListener('keydown', (ev2) => { if (ev2.key === 'Enter') ev && openEvent(ev); });
        });
      }
    } catch (err) {
      upcoming.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>${err.message}</div></div>`);
    }
  };

  const loadAll = async () => {
    grid.innerHTML = String(loading());
    await loadMonth();
  };

  document.getElementById('cal-prev').addEventListener('click', () => { viewDate.setMonth(viewDate.getMonth() - 1); loadMonth(); });
  document.getElementById('cal-next').addEventListener('click', () => { viewDate.setMonth(viewDate.getMonth() + 1); loadMonth(); });
  document.getElementById('add-event')?.addEventListener('click', () => openEventForm(null, loadAll));
  await loadMonth();
}

function openEventForm(ev, onSaved) {
  const structure = state.structure || { levels: [], parcours: [] };
  modal({
    title: ev ? 'Modifier l’événement' : 'Ajouter un événement',
    wide: true,
    body: html`
      <div id="ev-form-error"></div>
      <form id="ev-form">
        <div class="field"><label class="label" for="ev-title">Titre <span class="req">*</span></label><input class="input" id="ev-title" value="${ev?.title || ''}"></div>
        <div class="form-grid">
          <div class="field"><label class="label" for="ev-type">Type</label>
            <select class="select" id="ev-type">${Object.entries(EVENT_TYPES).map(([k, v]) => html`<option value="${k}" ${ev?.type === k ? 'selected' : ''}>${v}</option>`)}</select></div>
          <div class="field"><label class="label" for="ev-location">Lieu</label><input class="input" id="ev-location" value="${ev?.location || ''}"></div>
          <div class="field"><label class="label" for="ev-start">Début <span class="req">*</span></label><input class="input" type="datetime-local" id="ev-start" value="${toLocalInput(ev?.starts_at)}"></div>
          <div class="field"><label class="label" for="ev-end">Fin</label><input class="input" type="datetime-local" id="ev-end" value="${toLocalInput(ev?.ends_at)}"></div>
          <div class="field"><label class="label" for="ev-level">Niveau</label>
            <select class="select" id="ev-level"><option value="">Tous</option>${structure.levels.map((l) => html`<option value="${l.id}" ${ev?.level_id === l.id ? 'selected' : ''}>${l.name}</option>`)}</select></div>
          <div class="field"><label class="label" for="ev-parcours">Parcours</label>
            <select class="select" id="ev-parcours"><option value="">Tous</option>${structure.parcours.map((p) => html`<option value="${p.id}" ${ev?.parcours_id === p.id ? 'selected' : ''}>${p.name}</option>`)}</select></div>
        </div>
        <div class="field"><label class="label" for="ev-audience">Audience</label>
          <select class="select" id="ev-audience">${Object.entries(AUDIENCES).map(([k, v]) => html`<option value="${k}" ${ev?.audience === k ? 'selected' : ''}>${v}</option>`)}</select></div>
        <div class="field"><label class="label" for="ev-desc">Description</label><textarea class="textarea" id="ev-desc" rows="3">${ev?.description || ''}</textarea></div>
      </form>`,
    footer: html`<button class="btn btn-secondary" data-close>Annuler</button><button class="btn btn-primary" id="ev-submit">${icon('save')} Enregistrer</button>`,
    onMount(overlay, close) {
      overlay.querySelector('#ev-submit').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const errBox = overlay.querySelector('#ev-form-error');
        errBox.innerHTML = '';
        const title = overlay.querySelector('#ev-title').value.trim();
        const start = overlay.querySelector('#ev-start').value;
        if (title.length < 2) return (errBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>Indiquez un titre.</div></div>`));
        if (!start) return (errBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>Indiquez la date de début.</div></div>`));
        setLoading(btn, true, 'Enregistrement…');
        try {
          const payload = {
            title,
            type: overlay.querySelector('#ev-type').value,
            starts_at: new Date(start).toISOString(),
            ends_at: overlay.querySelector('#ev-end').value ? new Date(overlay.querySelector('#ev-end').value).toISOString() : null,
            location: overlay.querySelector('#ev-location').value,
            level_id: overlay.querySelector('#ev-level').value || null,
            parcours_id: overlay.querySelector('#ev-parcours').value || null,
            audience: overlay.querySelector('#ev-audience').value,
            description: overlay.querySelector('#ev-desc').value,
          };
          const res = ev
            ? await api(`/events/${ev.id}`, { method: 'PUT', body: payload })
            : await api('/events', { method: 'POST', body: payload });
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
