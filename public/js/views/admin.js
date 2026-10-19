import {
  state, api, uploadFile, html, icon, esc, modal, confirmDialog, toast, fmtDate, fmtDateTime,
  can, statusBadge, fileSize, loading, emptyState, setLoading, navigate,
} from '../api.js';

/* =====================================================================
   UTILISATEURS
   ===================================================================== */
export async function renderAdminUsers(root) {
  let q = '';
  let status = new URLSearchParams(location.hash.split('?')[1] || '').get('status') || '';
  let role = '';
  let level = '';
  let page = 1;
  let roles = [];
  let structure = { levels: [], parcours: [], groups: [] };

  root.innerHTML = String(html`
    <div class="page-header">
      <div>
        <h1 class="page-title">Utilisateurs et comptes</h1>
        <p class="page-sub">Créez, validez, modifiez, suspendez ou réactivez les comptes du département.</p>
      </div>
      <div class="page-actions">
        ${can('users.manage') ? html`<button class="btn btn-primary" id="new-user">${icon('plus')} Créer un compte</button>` : ''}
      </div>
    </div>
    <div class="toolbar">
      <div class="field search-field"><label class="label sr-only" for="u-search">Rechercher</label>
        <div class="search-input">${icon('search')}<input class="input" id="u-search" type="search" placeholder="Nom, téléphone, e-mail, matricule…"></div></div>
      <div class="field"><label class="label sr-only" for="u-status">Statut</label>
        <select class="select" id="u-status"><option value="">Tous les statuts</option>
          <option value="pending">En attente</option><option value="active">Actifs</option>
          <option value="suspended">Suspendus</option><option value="rejected">Rejetés</option></select></div>
      <div class="field"><label class="label sr-only" for="u-role">Rôle</label>
        <select class="select" id="u-role"><option value="">Tous les rôles</option></select></div>
      <div class="field"><label class="label sr-only" for="u-level">Niveau</label>
        <select class="select" id="u-level"><option value="">Tous les niveaux</option></select></div>
    </div>
    <div id="users-box">${loading()}</div>
    <div class="flex between mt2"><span class="muted small" id="users-total"></span>
      <span class="flex"><button class="btn btn-secondary btn-sm" id="u-prev">Précédent</button><button class="btn btn-secondary btn-sm" id="u-next">Suivant</button></span></div>
  `);

  try {
    const [r, s] = await Promise.all([api('/roles-lite'), api('/structure')]);
    roles = r.roles;
    structure = s;
  } catch {}
  const roleSelect = document.getElementById('u-role');
  roleSelect.innerHTML += roles.map((r) => `<option value="${r.slug}">${esc(r.name)}</option>`).join('');
  const levelSelect = document.getElementById('u-level');
  levelSelect.innerHTML += structure.levels.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
  roleSelect.value = role;
  levelSelect.value = level;
  document.getElementById('u-status').value = status;

  const box = document.getElementById('users-box');
  const totalLabel = document.getElementById('users-total');

  const load = async () => {
    box.innerHTML = String(loading());
    const params = new URLSearchParams({ page: String(page), limit: '25' });
    if (q) params.set('q', q);
    if (status) params.set('status', status);
    if (role) params.set('role', role);
    if (level) params.set('level', level);
    try {
      const data = await api(`/admin/users?${params.toString()}`);
      totalLabel.textContent = `${data.total} compte(s)`;
      if (!data.users.length) {
        box.innerHTML = String(emptyState('Aucun compte', 'Aucun utilisateur ne correspond à ces filtres.', 'users'));
        return;
      }
      box.innerHTML = String(html`
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Nom</th><th>Téléphone</th><th>Rôle</th><th>Niveau / parcours</th><th>Statut</th><th>Inscription</th><th>Actions</th></tr></thead>
          <tbody>${data.users.map((u) => html`
            <tr class="${u.status === 'pending' ? 'row-warn' : ''}">
              <td><strong>${u.full_name}</strong>${u.email ? html`<div class="tiny muted">${u.email}</div>` : ''}</td>
              <td class="nowrap">${u.phone}</td>
              <td>${u.role_name}</td>
              <td>${u.level_name || '—'}${u.parcours_name ? html`<div class="tiny muted">${u.parcours_name}</div>` : ''}</td>
              <td>${statusBadge(u.status)}</td>
              <td class="nowrap">${fmtDate(u.created_at)}</td>
              <td><div class="actions">
                ${u.status === 'pending' && can('users.approve') ? html`<button class="btn btn-primary btn-sm" data-approve="${u.id}">${icon('check')} Approuver</button>
                  <button class="btn btn-ghost btn-sm" data-reject="${u.id}">${icon('close')} Rejeter</button>` : ''}
                ${can('users.manage') ? html`<button class="btn btn-secondary btn-sm" data-edit-user="${u.id}">${icon('edit')} Modifier</button>` : ''}
                ${can('users.manage') && u.status === 'active' && u.id !== state.user.id ? html`<button class="btn btn-ghost btn-sm" data-suspend="${u.id}">${icon('lock')} Suspendre</button>` : ''}
                ${can('users.manage') && u.status === 'suspended' ? html`<button class="btn btn-ghost btn-sm" data-activate="${u.id}">${icon('check-circle')} Activer</button>` : ''}
              </div></td>
            </tr>`)}</tbody>
        </table></div>`);

      box.querySelectorAll('[data-approve]').forEach((btn) => btn.addEventListener('click', async () => {
        try {
          const res = await api(`/admin/users/${btn.dataset.approve}/approve`, { method: 'POST' });
          toast(res.message, 'success');
          load();
        } catch (err) { toast(err.message, 'error'); }
      }));
      box.querySelectorAll('[data-reject]').forEach((btn) => btn.addEventListener('click', async () => {
        if (!(await confirmDialog('Rejeter cette demande de compte ? La personne ne pourra pas se connecter.', { confirmLabel: 'Rejeter', danger: true }))) return;
        try {
          const res = await api(`/admin/users/${btn.dataset.reject}/reject`, { method: 'POST' });
          toast(res.message, 'success');
          load();
        } catch (err) { toast(err.message, 'error'); }
      }));
      box.querySelectorAll('[data-suspend]').forEach((btn) => btn.addEventListener('click', async () => {
        if (!(await confirmDialog('Suspendre ce compte ? Ses sessions seront fermées immédiatement.', { confirmLabel: 'Suspendre', danger: true }))) return;
        try {
          const res = await api(`/admin/users/${btn.dataset.suspend}/status`, { method: 'POST', body: { status: 'suspended' } });
          toast(res.message, 'success');
          load();
        } catch (err) { toast(err.message, 'error'); }
      }));
      box.querySelectorAll('[data-activate]').forEach((btn) => btn.addEventListener('click', async () => {
        try {
          const res = await api(`/admin/users/${btn.dataset.activate}/status`, { method: 'POST', body: { status: 'active' } });
          toast(res.message, 'success');
          load();
        } catch (err) { toast(err.message, 'error'); }
      }));
      box.querySelectorAll('[data-edit-user]').forEach((btn) => btn.addEventListener('click', () => openUserForm(Number(btn.dataset.editUser), roles, structure, load)));
    } catch (err) {
      box.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>${err.message}</div></div>`);
    }
  };

  document.getElementById('new-user')?.addEventListener('click', () => openUserForm(null, roles, structure, load));
  let timer;
  document.getElementById('u-search').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { q = e.target.value.trim(); page = 1; load(); }, 300);
  });
  document.getElementById('u-status').addEventListener('change', (e) => { status = e.target.value; page = 1; load(); });
  roleSelect.addEventListener('change', (e) => { role = e.target.value; page = 1; load(); });
  levelSelect.addEventListener('change', (e) => { level = e.target.value; page = 1; load(); });
  document.getElementById('u-prev').addEventListener('click', () => { if (page > 1) { page -= 1; load(); } });
  document.getElementById('u-next').addEventListener('click', () => { page += 1; load(); });
  await load();
}

async function openUserForm(userId, roles, structure, onSaved) {
  let user = null;
  let scopes = [];
  if (userId) {
    try {
      const data = await api(`/admin/users/${userId}`);
      user = data.user;
      scopes = data.scopes || [];
    } catch (err) {
      toast(err.message, 'error');
      return;
    }
  }
  const scopeSet = new Set(scopes.map((s) => `${s.scope_type}:${s.scope_id}`));
  const isChefTarget = user?.role_slug === 'chef';

  modal({
    title: user ? `Modifier — ${user.full_name}` : 'Créer un compte',
    wide: true,
    body: html`
      <div id="user-form-error"></div>
      <form id="user-form">
        <div class="form-grid">
          <div class="field"><label class="label" for="us-name">Nom complet <span class="req">*</span></label><input class="input" id="us-name" value="${user?.full_name || ''}"></div>
          <div class="field"><label class="label" for="us-phone">Téléphone <span class="req">*</span></label><input class="input" id="us-phone" type="tel" value="${user?.phone || ''}" placeholder="+225…"></div>
          <div class="field"><label class="label" for="us-email">E-mail</label><input class="input" id="us-email" type="email" value="${user?.email || ''}"></div>
          <div class="field"><label class="label" for="us-matricule">Matricule</label><input class="input" id="us-matricule" value="${user?.matricule || ''}"></div>
          <div class="field"><label class="label" for="us-role">Rôle <span class="req">*</span></label>
            <select class="select" id="us-role">${roles.map((r) => html`<option value="${r.slug}" ${user?.role_slug === r.slug ? 'selected' : ''}>${r.name}</option>`)}</select></div>
          <div class="field"><label class="label" for="us-status">Statut</label>
            <select class="select" id="us-status">
              <option value="pending" ${user?.status === 'pending' ? 'selected' : ''}>En attente</option>
              <option value="active" ${user?.status === 'active' ? 'selected' : ''}>Actif</option>
              <option value="suspended" ${user?.status === 'suspended' ? 'selected' : ''}>Suspendu</option>
              <option value="rejected" ${user?.status === 'rejected' ? 'selected' : ''}>Rejeté</option>
            </select></div>
          <div class="field"><label class="label" for="us-level">Niveau</label>
            <select class="select" id="us-level"><option value="">Aucun</option>${structure.levels.map((l) => html`<option value="${l.id}" ${user?.level_id === l.id ? 'selected' : ''}>${l.name}</option>`)}</select></div>
          <div class="field"><label class="label" for="us-parcours">Parcours</label>
            <select class="select" id="us-parcours"><option value="">Aucun</option>${structure.parcours.map((p) => html`<option value="${p.id}" ${user?.parcours_id === p.id ? 'selected' : ''}>${p.name}</option>`)}</select></div>
          <div class="field"><label class="label" for="us-group">Groupe</label><input class="input" id="us-group" value="${user?.group_name || ''}"></div>
          <div class="field"><label class="label" for="us-password">${user ? 'Nouveau mot de passe (facultatif)' : 'Mot de passe (6 chiffres)'} ${user ? '' : '<span class="req">*</span>'}</label>
            <input class="input" id="us-password" type="text" inputmode="numeric" maxlength="6" placeholder="6 chiffres" autocomplete="off">
            <div class="hint">${user ? 'Laisser vide pour conserver le mot de passe actuel. Toute modification ferme les sessions du compte.' : 'Exactement 6 chiffres. Communiquez-le à la personne par un canal sûr.'}</div></div>
        </div>
        <div class="field"><label class="label" for="us-note">Note interne</label><textarea class="textarea" id="us-note" rows="2" maxlength="1000">${user?.note || ''}</textarea></div>
        <fieldset>
          <legend>Périmètres de gestion (responsables et enseignants)</legend>
          <p class="hint">Un enseignant ou responsable sans périmètre ne peut pas publier vers un niveau, un parcours ou un groupe.</p>
          <div class="form-grid">
            <div><div class="label">Niveaux</div>${structure.levels.map((l) => html`<label class="check"><input type="checkbox" data-scope="level" value="${l.id}" ${scopeSet.has(`level:${l.id}`) ? 'checked' : ''}> ${l.name}</label>`)}</div>
            <div><div class="label">Parcours</div>${structure.parcours.map((p) => html`<label class="check"><input type="checkbox" data-scope="parcours" value="${p.id}" ${scopeSet.has(`parcours:${p.id}`) ? 'checked' : ''}> ${p.name}</label>`)}</div>
            <div><div class="label">Groupes</div>${structure.groups.length ? structure.groups.map((g) => html`<label class="check"><input type="checkbox" data-scope="group" value="${g.id}" ${scopeSet.has(`group:${g.id}`) ? 'checked' : ''}> ${g.name}</label>`) : '<p class="hint">Aucun groupe.</p>'}</div>
          </div>
        </fieldset>
        ${user ? html`<button type="button" class="btn btn-secondary btn-sm" id="reset-link">${icon('key')} Générer un lien de réinitialisation</button>` : ''}
      </form>`,
    footer: html`<button class="btn btn-secondary" data-close>Annuler</button><button class="btn btn-primary" id="us-submit">${icon('save')} ${user ? 'Enregistrer' : 'Créer le compte'}</button>`,
    onMount(overlay, close) {
      overlay.querySelector('#us-submit').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const errBox = overlay.querySelector('#user-form-error');
        errBox.innerHTML = '';
        const payload = {
          full_name: overlay.querySelector('#us-name').value,
          phone: overlay.querySelector('#us-phone').value,
          email: overlay.querySelector('#us-email').value,
          matricule: overlay.querySelector('#us-matricule').value,
          role_id: null,
          status: overlay.querySelector('#us-status').value,
          level_id: overlay.querySelector('#us-level').value || null,
          parcours_id: overlay.querySelector('#us-parcours').value || null,
          group_name: overlay.querySelector('#us-group').value,
          note: overlay.querySelector('#us-note').value,
          scopes: [...overlay.querySelectorAll('[data-scope]:checked')].map((el) => ({ type: el.dataset.scope, id: Number(el.value) })),
        };
        const roleSlug = overlay.querySelector('#us-role').value;
        const selectedRole = roles.find((r) => r.slug === roleSlug);
        if (!selectedRole) return (errBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>Rôle invalide.</div></div>`));
        payload.role_id = selectedRole.id;
        const pwd = overlay.querySelector('#us-password').value;
        if (!user && !/^\d{6}$/.test(pwd)) return (errBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>Le mot de passe doit contenir exactement 6 chiffres.</div></div>`));
        if (pwd) payload.password = pwd;
        setLoading(btn, true, 'Enregistrement…');
        try {
          const res = user
            ? await api(`/admin/users/${user.id}`, { method: 'PUT', body: payload })
            : await api('/admin/users', { method: 'POST', body: payload });
          toast(res.message, 'success');
          close();
          onSaved();
        } catch (err) {
          errBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>${err.message}</div></div>`);
          setLoading(btn, false);
        }
      });
      overlay.querySelector('#reset-link')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        setLoading(btn, true, 'Génération…');
        try {
          const res = await api(`/admin/users/${user.id}/reset-link`, { method: 'POST' });
          close();
          modal({
            title: 'Lien de réinitialisation',
            body: html`<div class="alert alert-info">${icon('info')}<div>${res.message}</div></div>
              <div class="field"><label class="label" for="reset-url">Lien à transmettre</label>
                <input class="input" id="reset-url" readonly value="${res.url}"></div>
              <p class="hint">Expire le ${fmtDateTime(res.expires_at)}. La personne devra choisir un nouveau mot de passe de 6 chiffres.</p>`,
            footer: html`<button class="btn btn-secondary" data-close>Fermer</button><button class="btn btn-primary" id="copy-reset">${icon('key')} Copier le lien</button>`,
            onMount(ov, cl) {
              ov.querySelector('#copy-reset').addEventListener('click', async () => {
                try {
                  await navigator.clipboard.writeText(res.url);
                  toast('Lien copié.', 'success');
                } catch {
                  const input = ov.querySelector('#reset-url');
                  input.select();
                  document.execCommand('copy');
                  toast('Lien copié.', 'success');
                }
                cl();
              });
            },
          });
        } catch (err) {
          toast(err.message, 'error');
          setLoading(btn, false);
        }
      });
    },
  });
}

/* =====================================================================
   RÔLES
   ===================================================================== */
export async function renderAdminRoles(root) {
  root.innerHTML = String(loading());
  let roles = [];
  let groups = [];
  try {
    const [r, p] = await Promise.all([api('/admin/roles'), api('/admin/permissions')]);
    roles = r.roles;
    groups = p.groups;
  } catch (err) {
    root.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>${err.message}</div></div>`);
    return;
  }

  const render = () => {
    root.innerHTML = String(html`
      <div class="page-header">
        <div>
          <h1 class="page-title">Rôles et permissions</h1>
          <p class="page-sub">Chaque permission est vérifiée côté serveur. Le rôle de chef de département conserve toujours le contrôle général.</p>
        </div>
        <div class="page-actions"><button class="btn btn-primary" id="new-role">${icon('plus')} Créer un rôle</button></div>
      </div>
      <div class="grid cols-2">
        ${roles.map((r) => {
          const perms = Array.isArray(r.permissions) ? r.permissions : [];
          return html`
          <article class="card card-pad">
            <div class="flex between flex-wrap mb1">
              <h2 style="margin:0;font-size:1.05rem">${r.name}</h2>
              <div class="flex" style="gap:.3rem">
                ${r.slug === 'chef' ? html`<span class="badge badge-or">${icon('shield')} Contrôle général</span>` : ''}
                ${r.is_system ? html`<span class="badge badge-gris">Rôle système</span>` : html`<span class="badge">Personnalisé</span>`}
              </div>
            </div>
            <p class="small muted">${r.description || 'Aucune description.'}</p>
            <div class="flex wrap mb2">
              <span class="chip">${icon('users')} ${r.user_count} compte(s)</span>
              <span class="chip">${icon('key')} ${perms.includes('*') ? 'Toutes les permissions' : `${perms.length} permission(s)`}</span>
            </div>
            <div class="flex">
              <button class="btn btn-secondary btn-sm" data-edit-role="${r.id}">${icon('edit')} Modifier</button>
              ${!r.is_system ? html`<button class="btn btn-ghost btn-sm" data-del-role="${r.id}">${icon('trash')} Supprimer</button>` : ''}
            </div>
          </article>`;
        })}
      </div>`);

    root.querySelectorAll('[data-edit-role]').forEach((btn) => btn.addEventListener('click', () => {
      const role = roles.find((r) => r.id === Number(btn.dataset.editRole));
      if (role) openRoleForm(role, groups, () => renderAdminRoles(root));
    }));
    root.querySelectorAll('[data-del-role]').forEach((btn) => btn.addEventListener('click', async () => {
      if (!(await confirmDialog('Supprimer ce rôle ? Seuls les rôles sans compte attribué peuvent être supprimés.', { confirmLabel: 'Supprimer', danger: true }))) return;
      try {
        const res = await api(`/admin/roles/${btn.dataset.delRole}`, { method: 'DELETE' });
        toast(res.message, 'success');
        renderAdminRoles(root);
      } catch (err) { toast(err.message, 'error'); }
    }));
    document.getElementById('new-role').addEventListener('click', () => openRoleForm(null, groups, () => renderAdminRoles(root)));
  };
  render();
}

function openRoleForm(role, groups, onSaved) {
  const isChef = role?.slug === 'chef';
  const perms = new Set(Array.isArray(role?.permissions) ? role.permissions : []);
  const disabled = isChef ? 'disabled' : '';
  modal({
    title: role ? `Rôle — ${role.name}` : 'Créer un rôle',
    wide: true,
    body: html`
      <div id="role-form-error"></div>
      ${isChef ? html`<div class="alert alert-info">${icon('shield')}<div>Le rôle de chef de département ne peut pas être modifié : il doit conserver toutes les permissions afin de garder le contrôle de l’application.</div></div>` : ''}
      <form id="role-form">
        <div class="form-grid">
          <div class="field"><label class="label" for="ro-name">Nom du rôle <span class="req">*</span></label><input class="input" id="ro-name" value="${role?.name || ''}" ${disabled} maxlength="80"></div>
          <div class="field"><label class="label" for="ro-desc">Description</label><input class="input" id="ro-desc" value="${role?.description || ''}" ${disabled} maxlength="500"></div>
        </div>
        ${groups.map((g) => html`
          <div class="perm-group">
            <h4>${g.label}</h4>
            <div class="perm-list">
              ${g.items.map((item) => html`<label class="check"><input type="checkbox" data-perm="${item.key}" ${perms.has(item.key) || perms.has('*') ? 'checked' : ''} ${disabled}> ${item.label}</label>`)}
            </div>
          </div>`)}
      </form>`,
    footer: isChef ? html`<button class="btn btn-secondary" data-close>Fermer</button>` : html`<button class="btn btn-secondary" data-close>Annuler</button><button class="btn btn-primary" id="ro-submit">${icon('save')} Enregistrer</button>`,
    onMount(overlay, close) {
      overlay.querySelector('#ro-submit')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const errBox = overlay.querySelector('#role-form-error');
        errBox.innerHTML = '';
        const name = overlay.querySelector('#ro-name').value.trim();
        if (name.length < 2) return (errBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>Indiquez un nom de rôle.</div></div>`));
        const permissions = [...overlay.querySelectorAll('[data-perm]:checked')].map((el) => el.dataset.perm);
        setLoading(btn, true, 'Enregistrement…');
        try {
          const res = role
            ? await api(`/admin/roles/${role.id}`, { method: 'PUT', body: { name, description: overlay.querySelector('#ro-desc').value, permissions } })
            : await api('/admin/roles', { method: 'POST', body: { name, description: overlay.querySelector('#ro-desc').value, permissions } });
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

/* =====================================================================
   STRUCTURE ACADÉMIQUE
   ===================================================================== */
let structureTab = 'levels';

export async function renderAdminStructure(root) {
  let tab = structureTab;
  let structure = { levels: [], parcours: [], groups: [] };
  try {
    structure = await api('/admin/structure');
    state.structure = await api('/structure');
  } catch (err) {
    root.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>${err.message}</div></div>`);
    return;
  }

  const render = () => {
    root.innerHTML = String(html`
      <div class="page-header">
        <div>
          <h1 class="page-title">Structure académique</h1>
          <p class="page-sub">Niveaux, filières, parcours et groupes. Ces informations alimentent l’inscription, les publications et les documents.</p>
        </div>
        <div class="page-actions"><button class="btn btn-primary" id="add-struct">${icon('plus')} ${tab === 'levels' ? 'Ajouter un niveau' : tab === 'parcours' ? 'Ajouter un parcours' : 'Ajouter un groupe'}</button></div>
      </div>
      <div class="alert alert-info">${icon('info')}<div>${state.settings.source_pdf_note || 'Les informations de structure doivent être saisies par la direction à partir des documents officiels du département.'}</div></div>
      <div class="tabs">
        <button class="tab ${tab === 'levels' ? 'active' : ''}" data-tab="levels">Niveaux (${structure.levels.length})</button>
        <button class="tab ${tab === 'parcours' ? 'active' : ''}" data-tab="parcours">Parcours (${structure.parcours.length})</button>
        <button class="tab ${tab === 'groups' ? 'active' : ''}" data-tab="groups">Groupes (${structure.groups.length})</button>
      </div>
      <div id="struct-box"></div>
    `);
    const box = document.getElementById('struct-box');
    if (tab === 'levels') {
      box.innerHTML = structure.levels.length ? String(html`<div class="table-wrap"><table class="data"><thead><tr><th>Niveau</th><th>Code</th><th>Ordre</th><th>État</th><th>Actions</th></tr></thead><tbody>
        ${structure.levels.map((l) => html`<tr><td><strong>${l.name}</strong>${l.description ? html`<div class="tiny muted">${l.description}</div>` : ''}</td><td>${l.code || '—'}</td><td>${l.order_index}</td><td>${l.active ? html`<span class="badge badge-ok">Actif</span>` : html`<span class="badge badge-gris">Archivé</span>`}</td>
        <td><div class="actions"><button class="btn btn-secondary btn-sm" data-edit-level="${l.id}">${icon('edit')} Modifier</button><button class="btn btn-ghost btn-sm" data-del-level="${l.id}">${icon('trash')} Supprimer</button></div></td></tr>`)}
      </tbody></table></div>`) : String(emptyState('Aucun niveau', 'Créez les niveaux d’études officiels du département.', 'graduation'));
      box.querySelectorAll('[data-edit-level]').forEach((btn) => btn.addEventListener('click', () => openLevelForm(structure.levels.find((l) => l.id === Number(btn.dataset.editLevel)), () => renderAdminStructure(root))));
      box.querySelectorAll('[data-del-level]').forEach((btn) => btn.addEventListener('click', () => deleteStructure('levels', btn.dataset.delLevel, root)));
    } else if (tab === 'parcours') {
      box.innerHTML = structure.parcours.length ? String(html`<div class="table-wrap"><table class="data"><thead><tr><th>Parcours</th><th>Parent</th><th>Niveaux</th><th>État</th><th>Actions</th></tr></thead><tbody>
        ${structure.parcours.map((p) => html`<tr><td><strong>${p.name}</strong>${p.code ? html`<div class="tiny muted">${p.code}</div>` : ''}</td><td>${structure.parcours.find((x) => x.id === p.parent_id)?.name || '—'}</td><td>${(p.level_ids || []).map((id) => structure.levels.find((l) => l.id === Number(id))?.name).filter(Boolean).map((n) => html`<span class="chip">${n}</span> `)}</td><td>${p.active ? html`<span class="badge badge-ok">Actif</span>` : html`<span class="badge badge-gris">Archivé</span>`}</td>
        <td><div class="actions"><button class="btn btn-secondary btn-sm" data-edit-parcours="${p.id}">${icon('edit')} Modifier</button><button class="btn btn-ghost btn-sm" data-del-parcours="${p.id}">${icon('trash')} Supprimer</button></div></td></tr>`)}
      </tbody></table></div>`) : String(emptyState('Aucun parcours', 'Créez les filières et parcours officiels du département.', 'book'));
      box.querySelectorAll('[data-edit-parcours]').forEach((btn) => btn.addEventListener('click', () => openParcoursForm(structure.parcours.find((p) => p.id === Number(btn.dataset.editParcours)), () => renderAdminStructure(root))));
      box.querySelectorAll('[data-del-parcours]').forEach((btn) => btn.addEventListener('click', () => deleteStructure('parcours', btn.dataset.delParcours, root)));
    } else {
      box.innerHTML = structure.groups.length ? String(html`<div class="table-wrap"><table class="data"><thead><tr><th>Groupe</th><th>Niveau</th><th>Parcours</th><th>Année</th><th>État</th><th>Actions</th></tr></thead><tbody>
        ${structure.groups.map((g) => html`<tr><td><strong>${g.name}</strong></td><td>${structure.levels.find((l) => l.id === g.level_id)?.name || '—'}</td><td>${structure.parcours.find((p) => p.id === g.parcours_id)?.name || '—'}</td><td>${g.academic_year || '—'}</td><td>${g.active ? html`<span class="badge badge-ok">Actif</span>` : html`<span class="badge badge-gris">Archivé</span>`}</td>
        <td><div class="actions"><button class="btn btn-secondary btn-sm" data-edit-group="${g.id}">${icon('edit')} Modifier</button></div></td></tr>`)}
      </tbody></table></div>`) : String(emptyState('Aucun groupe', 'Les groupes permettent de cibler des promotions ou des sous-groupes.', 'users'));
      box.querySelectorAll('[data-edit-group]').forEach((btn) => btn.addEventListener('click', () => openGroupForm(structure.groups.find((g) => g.id === Number(btn.dataset.editGroup)), () => renderAdminStructure(root))));
    }
    root.querySelectorAll('[data-tab]').forEach((t) => t.addEventListener('click', () => { tab = t.dataset.tab; structureTab = tab; render(); }));
    document.getElementById('add-struct').addEventListener('click', () => {
      if (tab === 'levels') openLevelForm(null, () => renderAdminStructure(root));
      else if (tab === 'parcours') openParcoursForm(null, () => renderAdminStructure(root));
      else openGroupForm(null, () => renderAdminStructure(root));
    });
  };
  render();
}

async function deleteStructure(kind, id, root) {
  if (!(await confirmDialog('Supprimer cet élément ? S’il est utilisé par des données existantes, il sera archivé et l’historique conservé.', { confirmLabel: 'Supprimer', danger: true }))) return;
  try {
    const res = await api(`/admin/${kind}/${id}`, { method: 'DELETE' });
    toast(res.message, res.archived ? 'warning' : 'success');
    renderAdminStructure(root);
  } catch (err) { toast(err.message, 'error'); }
}

function openLevelForm(level, onSaved) {
  modal({
    title: level ? 'Modifier le niveau' : 'Ajouter un niveau',
    body: html`
      <div id="level-error"></div>
      <div class="field"><label class="label" for="lv-name">Nom du niveau <span class="req">*</span></label><input class="input" id="lv-name" value="${level?.name || ''}" placeholder="Ex. Licence 1"></div>
      <div class="form-grid">
        <div class="field"><label class="label" for="lv-code">Code</label><input class="input" id="lv-code" value="${level?.code || ''}" maxlength="40"></div>
        <div class="field"><label class="label" for="lv-order">Ordre d’affichage</label><input class="input" type="number" id="lv-order" value="${level?.order_index ?? 0}"></div>
      </div>
      <div class="field"><label class="label" for="lv-desc">Description</label><textarea class="textarea" id="lv-desc" rows="2">${level?.description || ''}</textarea></div>
      ${level ? html`<label class="check"><input type="checkbox" id="lv-active" ${level.active ? 'checked' : ''}> Niveau actif</label>` : ''}`,
    footer: html`<button class="btn btn-secondary" data-close>Annuler</button><button class="btn btn-primary" id="lv-submit">${icon('save')} Enregistrer</button>`,
    onMount(overlay, close) {
      overlay.querySelector('#lv-submit').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const errBox = overlay.querySelector('#level-error');
        errBox.innerHTML = '';
        const payload = {
          name: overlay.querySelector('#lv-name').value.trim(),
          code: overlay.querySelector('#lv-code').value,
          description: overlay.querySelector('#lv-desc').value,
          order_index: Number(overlay.querySelector('#lv-order').value) || 0,
          active: overlay.querySelector('#lv-active') ? overlay.querySelector('#lv-active').checked : true,
        };
        if (payload.name.length < 1) return (errBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>Indiquez un nom.</div></div>`));
        setLoading(btn, true, 'Enregistrement…');
        try {
          const res = level ? await api(`/admin/levels/${level.id}`, { method: 'PUT', body: payload }) : await api('/admin/levels', { method: 'POST', body: payload });
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

function openParcoursForm(parcours, onSaved) {
  const structure = state.structure || { levels: [], parcours: [] };
  const all = [...(structure.parcours || [])];
  if (parcours && !all.find((p) => p.id === parcours.id)) all.push(parcours);
  modal({
    title: parcours ? 'Modifier le parcours' : 'Ajouter un parcours',
    wide: true,
    body: html`
      <div id="parcours-error"></div>
      <div class="field"><label class="label" for="pa-name">Nom du parcours <span class="req">*</span></label><input class="input" id="pa-name" value="${parcours?.name || ''}"></div>
      <div class="form-grid">
        <div class="field"><label class="label" for="pa-code">Code</label><input class="input" id="pa-code" value="${parcours?.code || ''}" maxlength="40"></div>
        <div class="field"><label class="label" for="pa-parent">Parcours parent (sous-parcours)</label>
          <select class="select" id="pa-parent"><option value="">Aucun</option>
            ${all.filter((p) => p.id !== parcours?.id).map((p) => html`<option value="${p.id}" ${parcours?.parent_id === p.id ? 'selected' : ''}>${p.name}</option>`)}</select></div>
        <div class="field"><label class="label" for="pa-order">Ordre</label><input class="input" type="number" id="pa-order" value="${parcours?.order_index ?? 0}"></div>
      </div>
      <div class="field"><label class="label" for="pa-desc">Description</label><textarea class="textarea" id="pa-desc" rows="2">${parcours?.description || ''}</textarea></div>
      <fieldset><legend>Niveaux associés</legend>
        <div class="perm-list">${structure.levels.map((l) => html`<label class="check"><input type="checkbox" data-pa-level="${l.id}" ${(parcours?.level_ids || []).map(Number).includes(Number(l.id)) ? 'checked' : ''}> ${l.name}</label>`)}</div>
      </fieldset>
      ${parcours ? html`<label class="check"><input type="checkbox" id="pa-active" ${parcours.active ? 'checked' : ''}> Parcours actif</label>` : ''}`,
    footer: html`<button class="btn btn-secondary" data-close>Annuler</button><button class="btn btn-primary" id="pa-submit">${icon('save')} Enregistrer</button>`,
    onMount(overlay, close) {
      overlay.querySelector('#pa-submit').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const errBox = overlay.querySelector('#parcours-error');
        errBox.innerHTML = '';
        const payload = {
          name: overlay.querySelector('#pa-name').value.trim(),
          code: overlay.querySelector('#pa-code').value,
          description: overlay.querySelector('#pa-desc').value,
          parent_id: overlay.querySelector('#pa-parent').value || null,
          order_index: Number(overlay.querySelector('#pa-order').value) || 0,
          level_ids: [...overlay.querySelectorAll('[data-pa-level]:checked')].map((el) => Number(el.dataset.paLevel)),
          active: overlay.querySelector('#pa-active') ? overlay.querySelector('#pa-active').checked : true,
        };
        if (payload.name.length < 1) return (errBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>Indiquez un nom.</div></div>`));
        setLoading(btn, true, 'Enregistrement…');
        try {
          const res = parcours ? await api(`/admin/parcours/${parcours.id}`, { method: 'PUT', body: payload }) : await api('/admin/parcours', { method: 'POST', body: payload });
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

function openGroupForm(group, onSaved) {
  const structure = state.structure || { levels: [], parcours: [] };
  modal({
    title: group ? 'Modifier le groupe' : 'Ajouter un groupe',
    body: html`
      <div id="group-error"></div>
      <div class="field"><label class="label" for="gr-name">Nom du groupe <span class="req">*</span></label><input class="input" id="gr-name" value="${group?.name || ''}" placeholder="Ex. Groupe A"></div>
      <div class="form-grid">
        <div class="field"><label class="label" for="gr-level">Niveau</label>
          <select class="select" id="gr-level"><option value="">Aucun</option>${structure.levels.map((l) => html`<option value="${l.id}" ${group?.level_id === l.id ? 'selected' : ''}>${l.name}</option>`)}</select></div>
        <div class="field"><label class="label" for="gr-parcours">Parcours</label>
          <select class="select" id="gr-parcours"><option value="">Aucun</option>${structure.parcours.map((p) => html`<option value="${p.id}" ${group?.parcours_id === p.id ? 'selected' : ''}>${p.name}</option>`)}</select></div>
        <div class="field"><label class="label" for="gr-year">Année académique</label><input class="input" id="gr-year" value="${group?.academic_year || state.settings.academic_year || ''}"></div>
      </div>
      ${group ? html`<label class="check"><input type="checkbox" id="gr-active" ${group.active ? 'checked' : ''}> Groupe actif</label>` : ''}`,
    footer: html`<button class="btn btn-secondary" data-close>Annuler</button><button class="btn btn-primary" id="gr-submit">${icon('save')} Enregistrer</button>`,
    onMount(overlay, close) {
      overlay.querySelector('#gr-submit').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const errBox = overlay.querySelector('#group-error');
        errBox.innerHTML = '';
        const payload = {
          name: overlay.querySelector('#gr-name').value.trim(),
          level_id: overlay.querySelector('#gr-level').value || null,
          parcours_id: overlay.querySelector('#gr-parcours').value || null,
          academic_year: overlay.querySelector('#gr-year').value,
          active: overlay.querySelector('#gr-active') ? overlay.querySelector('#gr-active').checked : true,
        };
        if (payload.name.length < 1) return (errBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>Indiquez un nom.</div></div>`));
        setLoading(btn, true, 'Enregistrement…');
        try {
          const res = group ? await api(`/admin/groups/${group.id}`, { method: 'PUT', body: payload }) : await api('/admin/groups', { method: 'POST', body: payload });
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

/* =====================================================================
   PARAMÈTRES
   ===================================================================== */
export async function renderAdminSettings(root) {
  let settings;
  let roles = [];
  let categories = [];
  try {
    const [s, r, c] = await Promise.all([
      api('/admin/settings'),
      api('/roles-lite'),
      api('/admin/categories').catch(() => ({ categories: [] })),
    ]);
    settings = s.settings;
    roles = r.roles;
    categories = c.categories || [];
  } catch (err) {
    root.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>${err.message}</div></div>`);
    return;
  }
  let modules = {};
  let notificationTypes = {};
  let activityCategories = {};
  try { modules = JSON.parse(settings.modules || '{}'); } catch {}
  try { notificationTypes = JSON.parse(settings.notification_types || '{}'); } catch {}
  try { activityCategories = JSON.parse(settings.activity_categories || '{}'); } catch {}
  const logoUrl = settings.logo_file_id ? `/api/public/logo?v=${Date.now()}` : '';
  const coverUrl = settings.cover_file_id ? `/api/public/cover?v=${Date.now()}` : '';

  root.innerHTML = String(html`
    <div class="page-header">
      <div>
        <h1 class="page-title">Paramètres de l’application</h1>
        <p class="page-sub">Identité, présentation, contacts, inscriptions, rubriques et accessibilité. Les modifications sont enregistrées en base et visibles immédiatement.</p>
      </div>
    </div>
    <div id="settings-alert"></div>
    <form id="settings-form" class="stack">
      <section class="card card-pad">
        <h2 style="font-size:1.05rem">${icon('globe')} Identité de l’établissement</h2>
        <div class="form-grid">
          <div class="field"><label class="label" for="se-name">Nom complet affiché</label><input class="input" id="se-name" value="${settings.app_name || ''}"></div>
          <div class="field"><label class="label" for="se-short">Nom court</label><input class="input" id="se-short" value="${settings.app_short || ''}"></div>
          <div class="field"><label class="label" for="se-institution">Établissement</label><input class="input" id="se-institution" value="${settings.institution || ''}"></div>
          <div class="field"><label class="label" for="se-year">Année académique</label><input class="input" id="se-year" value="${settings.academic_year || ''}" placeholder="À compléter par la direction"></div>
        </div>
        <div class="field">
          <label class="label">Logo officiel</label>
          <div class="flex">
            <img class="logo-preview" id="logo-preview" src="${logoUrl || '/icons/icon-192.png'}" alt="Logo actuel">
            <div>
              <input type="file" id="logo-input" accept="image/png,image/jpeg,image/webp" class="input">
              <div class="hint">Image PNG, JPG ou WEBP. Le logo officiel doit être fourni par la direction ; l’application n’en crée pas.</div>
            </div>
            ${settings.logo_file_id ? html`<button type="button" class="btn btn-ghost btn-sm" id="remove-logo">Retirer</button>` : ''}
          </div>
        </div>
        <div class="field">
          <label class="label">Photo de couverture (bandeau d’accueil)</label>
          <div class="flex" style="align-items:flex-start">
            <div class="cover-preview" id="cover-preview">${coverUrl ? html`<img src="${coverUrl}" alt="Photo de couverture actuelle">` : html`<span class="muted small">Aucune image</span>`}</div>
            <div style="flex:1;min-width:0">
              <input type="file" id="cover-input" accept="image/png,image/jpeg,image/webp" class="input">
              <div class="hint">Image panoramique (idéalement 1200 × 500 px). Elle illustre le bandeau de la barre latérale et la carte d’accueil. Sans image, un visuel neutre est affiché : l’application ne fabrique aucune photo du département.</div>
              ${settings.cover_file_id ? html`<button type="button" class="btn btn-ghost btn-sm mt1" id="remove-cover">Retirer la photo</button>` : ''}
            </div>
          </div>
        </div>
      </section>

      <section class="card card-pad">
        <h2 style="font-size:1.05rem">${icon('megaphone')} Présentation du département</h2>
        <div class="field"><label class="label" for="se-presentation">Présentation officielle</label>
          <textarea class="textarea" id="se-presentation" rows="7" placeholder="Présentation institutionnelle…">${settings.presentation || ''}</textarea>
          <div class="hint">Aucune présentation n’est inventée par l’application : ce champ doit être rédigé à partir des documents officiels du département.</div></div>
        <div class="field"><label class="label" for="se-extra">Informations complémentaires</label>
          <textarea class="textarea" id="se-extra" rows="4">${settings.presentation_extra || ''}</textarea></div>
      </section>

      <section class="card card-pad">
        <h2 style="font-size:1.05rem">${icon('phone')} Coordonnées officielles</h2>
        <div class="form-grid">
          <div class="field"><label class="label" for="se-email">E-mail</label><input class="input" id="se-email" type="email" value="${settings.contact_email || ''}"></div>
          <div class="field"><label class="label" for="se-phone">Téléphone</label><input class="input" id="se-phone" value="${settings.contact_phone || ''}"></div>
          <div class="field"><label class="label" for="se-address">Adresse</label><input class="input" id="se-address" value="${settings.contact_address || ''}"></div>
          <div class="field"><label class="label" for="se-hours">Horaires</label><input class="input" id="se-hours" value="${settings.contact_hours || ''}"></div>
        </div>
      </section>

      <section class="card card-pad">
        <h2 style="font-size:1.05rem">${icon('users')} Inscriptions et validation</h2>
        <label class="check"><input type="checkbox" id="se-approval" ${settings.require_approval === '1' ? 'checked' : ''}> Les nouvelles inscriptions doivent être validées par l’administration</label>
        <label class="check"><input type="checkbox" id="se-registration" ${settings.registration_open === '1' ? 'checked' : ''}> Les inscriptions sont ouvertes</label>
        <div class="form-grid mt1">
          <div class="field"><label class="label" for="se-default-role">Rôle par défaut des inscriptions</label>
            <select class="select" id="se-default-role">${roles.map((r) => html`<option value="${r.slug}" ${settings.default_signup_role === r.slug ? 'selected' : ''}>${r.name}</option>`)}</select></div>
        </div>
        <div class="field"><label class="label" for="se-help">Message affiché sur le formulaire d’inscription</label><textarea class="textarea" id="se-help" rows="3">${settings.signup_help || ''}</textarea></div>
      </section>

      <section class="card card-pad">
        <h2 style="font-size:1.05rem">${icon('folder')} Rubriques facultatives</h2>
        <p class="hint">Désactivez une rubrique pour la masquer aux utilisateurs. Les données existantes sont conservées.</p>
        <div class="form-grid">
          ${[
            ['activities', 'Recherche et vie du département'],
            ['documents', 'Bibliothèque documentaire'],
            ['timetables', 'Emplois du temps et calendrier'],
            ['results', 'Résultats et informations d’examen'],
            ['requests', 'Demandes administratives'],
            ['messages', 'Messagerie interne'],
            ['notifications_sound', 'Sons de notification'],
          ].map(([key, label]) => html`<label class="check"><input type="checkbox" data-module="${key}" ${modules[key] !== false ? 'checked' : ''}> ${label}</label>`)}
        </div>
        <h3 style="font-size:.98rem;margin-top:1.2rem">Sous-rubriques de la vie du département</h3>
        <p class="hint">Chaque rubrique peut être masquée sans supprimer les activités déjà enregistrées.</p>
        <div class="form-grid">
          ${[
            ['recherche', 'Recherche'],
            ['publication_scientifique', 'Publications scientifiques'],
            ['conference', 'Conférences'],
            ['seminaire', 'Séminaires'],
            ['atelier', 'Ateliers'],
            ['soutenance', 'Soutenances'],
            ['partenariat', 'Partenariats'],
            ['association', 'Associations'],
            ['stage', 'Stages'],
            ['opportunite', 'Opportunités'],
            ['autre', 'Autres activités'],
          ].map(([key, label]) => html`<label class="check"><input type="checkbox" data-actcat="${key}" ${activityCategories[key] !== false ? 'checked' : ''}> ${label}</label>`)}
        </div>
        <h3 style="font-size:.98rem;margin-top:1.2rem">Types de notifications</h3>
        <p class="hint">Désactiver un type empêche la création de nouvelles notifications de ce type. Les notifications déjà reçues restent consultables.</p>
        <div class="form-grid">
          ${[
            ['publication', 'Nouvelles publications'],
            ['result', 'Publication de résultats'],
            ['timetable', 'Emplois du temps et calendrier'],
            ['request', 'Suivi des demandes administratives'],
            ['message', 'Nouveaux messages internes'],
          ].map(([key, label]) => html`<label class="check"><input type="checkbox" data-ntype="${key}" ${notificationTypes[key] !== false ? 'checked' : ''}> ${label}</label>`)}
        </div>
      </section>

      <section class="card card-pad">
        <h2 style="font-size:1.05rem">${icon('tag')} Catégories de publications</h2>
        <p class="hint">Les catégories servent à classer et filtrer les annonces. Une catégorie utilisée ne peut pas être supprimée : elle est archivée.</p>
        <div id="category-rows">
          ${categories.length ? categories.map((cat) => html`
            <div class="attachment">
              ${icon('tag')}
              <div class="name"><span class="badge" style="background:${cat.color}1a;color:${cat.color}">${cat.name}</span>
                <span class="tiny muted"> · ${cat.publication_count} publication(s)${cat.active ? '' : ' · archivée'}</span></div>
              <button type="button" class="btn btn-ghost btn-sm" data-cat-edit="${cat.id}">${icon('edit')} Modifier</button>
              <button type="button" class="btn btn-ghost btn-sm" data-cat-toggle="${cat.id}">${cat.active ? 'Archiver' : 'Réactiver'}</button>
            </div>`) : html`<p class="hint">Aucune catégorie pour le moment.</p>`}
        </div>
        <div class="form-grid mt2">
          <div class="field"><label class="label" for="new-cat-name">Nouvelle catégorie</label><input class="input" id="new-cat-name" maxlength="80" placeholder="Ex. Vie du département"></div>
          <div class="field"><label class="label" for="new-cat-color">Couleur</label><input class="input" id="new-cat-color" type="color" value="#1f4e79" style="height:2.7rem"></div>
          <div class="field" style="align-self:end"><button type="button" class="btn btn-secondary" id="new-cat-add">${icon('plus')} Ajouter la catégorie</button></div>
        </div>
      </section>

      <section class="card card-pad">
        <h2 style="font-size:1.05rem">${icon('settings')} Accessibilité et fichiers</h2>
        <div class="form-grid">
          <div class="field"><label class="label" for="se-scale-min">Taille de texte minimale (ex. 0.9)</label><input class="input" type="number" step="0.05" min="0.8" max="1.4" id="se-scale-min" value="${settings.text_scale_min || '0.9'}"></div>
          <div class="field"><label class="label" for="se-scale-max">Taille de texte maximale (ex. 1.4)</label><input class="input" type="number" step="0.05" min="1" max="1.6" id="se-scale-max" value="${settings.text_scale_max || '1.4'}"></div>
          <div class="field"><label class="label" for="se-max-upload">Taille maximale des fichiers (Mo)</label><input class="input" type="number" min="1" max="50" id="se-max-upload" value="${settings.max_upload_mb || '8'}"></div>
          <div class="field"><label class="label" for="se-retention">Conservation des notifications lues et du journal (jours)</label><input class="input" type="number" min="0" max="3650" id="se-retention" value="${settings.data_retention_days || '0'}"><div class="hint">0 = conservation illimitée. La purge s’exécute chaque jour.</div></div>
        </div>
      </section>

      <section class="card card-pad">
        <h2 style="font-size:1.05rem">${icon('info')} Notes et source documentaire</h2>
        <div class="field"><label class="label" for="se-footer">Note de pied de page</label><input class="input" id="se-footer" value="${settings.footer_note || ''}"></div>
        <div class="field"><label class="label" for="se-source">Note sur la source des informations</label><textarea class="textarea" id="se-source" rows="3">${settings.source_pdf_note || ''}</textarea>
          <div class="hint">Rappel : le document de référence fourni est un cahier technique et ne contient pas la structure officielle du Département de Communication.</div></div>
        <label class="check"><input type="checkbox" id="se-demo" ${settings.demo_mode === '1' ? 'checked' : ''}> Afficher le bandeau « mode démonstration »</label>
      </section>

      <div class="flex end" style="position:sticky;bottom:1rem;z-index:5">
        <button class="btn btn-primary" type="submit" id="settings-save">${icon('save')} Enregistrer les paramètres</button>
      </div>
    </form>
  `);

  document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('settings-save');
    const alertBox = document.getElementById('settings-alert');
    alertBox.innerHTML = '';
    const modulesPayload = {};
    document.querySelectorAll('[data-module]').forEach((el) => { modulesPayload[el.dataset.module] = el.checked; });
    const payload = {
      app_name: document.getElementById('se-name').value,
      app_short: document.getElementById('se-short').value,
      institution: document.getElementById('se-institution').value,
      academic_year: document.getElementById('se-year').value,
      presentation: document.getElementById('se-presentation').value,
      presentation_extra: document.getElementById('se-extra').value,
      contact_email: document.getElementById('se-email').value,
      contact_phone: document.getElementById('se-phone').value,
      contact_address: document.getElementById('se-address').value,
      contact_hours: document.getElementById('se-hours').value,
      require_approval: document.getElementById('se-approval').checked,
      registration_open: document.getElementById('se-registration').checked,
      default_signup_role: document.getElementById('se-default-role').value,
      signup_help: document.getElementById('se-help').value,
      modules: modulesPayload,
      notification_types: Object.fromEntries([...document.querySelectorAll('[data-ntype]')].map((el) => [el.dataset.ntype, el.checked])),
      activity_categories: Object.fromEntries([...document.querySelectorAll('[data-actcat]')].map((el) => [el.dataset.actcat, el.checked])),
      data_retention_days: document.getElementById('se-retention').value,
      text_scale_min: document.getElementById('se-scale-min').value,
      text_scale_max: document.getElementById('se-scale-max').value,
      max_upload_mb: document.getElementById('se-max-upload').value,
      footer_note: document.getElementById('se-footer').value,
      source_pdf_note: document.getElementById('se-source').value,
      demo_mode: document.getElementById('se-demo').checked,
    };
    setLoading(btn, true, 'Enregistrement…');
    try {
      const res = await api('/admin/settings', { method: 'PUT', body: payload });
      state.settings = { ...state.settings, ...res.settings, modules: JSON.parse(res.settings.modules || '{}') };
      state.modules = state.settings.modules;
      toast(res.message, 'success');
      setLoading(btn, false);
      renderAdminSettings(root);
    } catch (err) {
      alertBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>${err.message}</div></div>`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      setLoading(btn, false);
    }
  });

  document.getElementById('new-cat-add')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const name = document.getElementById('new-cat-name').value.trim();
    const color = document.getElementById('new-cat-color').value;
    const alertBox = document.getElementById('settings-alert');
    if (name.length < 2) {
      alertBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>Indiquez un nom d’au moins 2 caractères.</div></div>`);
      return;
    }
    setLoading(btn, true, 'Ajout…');
    try {
      const res = await api('/admin/categories', { method: 'POST', body: { name, color } });
      toast(res.message, 'success');
      renderAdminSettings(root);
    } catch (err) {
      alertBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>${err.message}</div></div>`);
      setLoading(btn, false);
    }
  });
  root.querySelectorAll('[data-cat-toggle]').forEach((btn) => btn.addEventListener('click', async () => {
    const cat = categories.find((c) => c.id === Number(btn.dataset.catToggle));
    if (!cat) return;
    try {
      const res = await api(`/admin/categories/${cat.id}`, { method: 'PUT', body: { active: !cat.active } });
      toast(res.message, 'success');
      renderAdminSettings(root);
    } catch (err) {
      toast(err.message, 'error');
    }
  }));
  root.querySelectorAll('[data-cat-edit]').forEach((btn) => btn.addEventListener('click', () => {
    const cat = categories.find((c) => c.id === Number(btn.dataset.catEdit));
    if (!cat) return;
    const { overlay, close } = modal({
      title: 'Modifier la catégorie',
      body: html`<div id="cat-modal-error"></div>
        <div class="field"><label class="label" for="cat-name">Nom</label><input class="input" id="cat-name" maxlength="80" value="${cat.name}"></div>
        <div class="field"><label class="label" for="cat-color">Couleur</label><input class="input" id="cat-color" type="color" value="${cat.color}" style="height:2.7rem"></div>`,
      footer: html`<button type="button" class="btn btn-secondary" data-close>Annuler</button><button type="button" class="btn btn-primary" id="cat-save">${icon('save')} Enregistrer</button>`,
      onMount(overlayEl) {
        overlayEl.querySelector('#cat-save').addEventListener('click', async (ev) => {
          const b = ev.currentTarget;
          setLoading(b, true, 'Enregistrement…');
          try {
            const res = await api(`/admin/categories/${cat.id}`, {
              method: 'PUT',
              body: { name: overlayEl.querySelector('#cat-name').value.trim(), color: overlayEl.querySelector('#cat-color').value },
            });
            toast(res.message, 'success');
            close();
            renderAdminSettings(root);
          } catch (err) {
            overlayEl.querySelector('#cat-modal-error').innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>${err.message}</div></div>`);
            setLoading(b, false);
          }
        });
      },
    });
    return overlay;
  }));

  document.getElementById('logo-input').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const alertBox = document.getElementById('settings-alert');
    try {
      const uploaded = await uploadFile(file);
      await api('/admin/settings', { method: 'PUT', body: { logo_file_id: uploaded.id } });
      document.getElementById('logo-preview').src = `/api/public/logo?v=${Date.now()}`;
      state.settings.logo = { id: uploaded.id, url: '/api/public/logo' };
      toast('Logo enregistré.', 'success');
    } catch (err) {
      alertBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>${err.message}</div></div>`);
    }
  });
  document.getElementById('cover-input').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const alertBox = document.getElementById('settings-alert');
    try {
      const uploaded = await uploadFile(file);
      await api('/admin/settings', { method: 'PUT', body: { cover_file_id: uploaded.id } });
      state.settings.cover = { id: uploaded.id, url: '/api/public/cover' };
      toast('Photo de couverture enregistrée.', 'success');
      renderAdminSettings(root);
    } catch (err) {
      alertBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>${err.message}</div></div>`);
    }
  });
  document.getElementById('remove-cover')?.addEventListener('click', async () => {
    try {
      await api('/admin/settings', { method: 'PUT', body: { cover_file_id: '' } });
      state.settings.cover = null;
      toast('Photo de couverture retirée.', 'success');
      renderAdminSettings(root);
    } catch (err) { toast(err.message, 'error'); }
  });
  document.getElementById('remove-logo')?.addEventListener('click', async () => {
    try {
      await api('/admin/settings', { method: 'PUT', body: { logo_file_id: '' } });
      state.settings.logo = null;
      toast('Logo retiré.', 'success');
      renderAdminSettings(root);
    } catch (err) { toast(err.message, 'error'); }
  });
}

/* =====================================================================
   STATISTIQUES
   ===================================================================== */
export async function renderAdminStats(root) {
  root.innerHTML = String(loading());
  let s;
  try {
    s = await api('/stats/overview');
  } catch (err) {
    root.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>${err.message}</div></div>`);
    return;
  }
  const maxDay = Math.max(1, ...s.activity.map((d) => Number(d.views) || 0));
  const readRate = s.notifications.total ? Math.round((s.notifications.read / s.notifications.total) * 100) : 0;

  root.innerHTML = String(html`
    <div class="page-header">
      <div>
        <h1 class="page-title">Statistiques et suivi</h1>
        <p class="page-sub">Chiffres calculés à partir des événements réellement enregistrés dans l’application. Aucune valeur fictive.</p>
      </div>
      <div class="page-actions"><button class="btn btn-secondary btn-sm" id="refresh-stats">${icon('refresh')} Actualiser</button></div>
    </div>
    <div class="stat-grid">
      <div class="stat-card accent"><div class="stat-label">Comptes actifs</div><div class="stat-value">${s.byStatus.active}</div><div class="stat-note">${s.byStatus.pending} en attente · ${s.byStatus.suspended} suspendus</div></div>
      <div class="stat-card"><div class="stat-label">Publications diffusées</div><div class="stat-value">${s.publications.published}</div><div class="stat-note">${s.publications.last30} sur 30 jours</div></div>
      <div class="stat-card"><div class="stat-label">Consultations</div><div class="stat-value">${s.views.total}</div><div class="stat-note">ouvertures de publications</div></div>
      <div class="stat-card"><div class="stat-label">Documents</div><div class="stat-value">${s.documents.active}</div><div class="stat-note">${fileSize(s.files.bytes)} stockés</div></div>
      <div class="stat-card"><div class="stat-label">Notifications</div><div class="stat-value">${s.notifications.total}</div><div class="stat-note">${readRate} % lues</div></div>
      <div class="stat-card"><div class="stat-label">Demandes</div><div class="stat-value">${s.requests.recue + s.requests.en_cours}</div><div class="stat-note">${s.requests.traitee} traitées</div></div>
      <div class="stat-card"><div class="stat-label">Résultats</div><div class="stat-value">${s.results.published}</div><div class="stat-note">${s.results.draft} brouillon(s)</div></div>
      <div class="stat-card"><div class="stat-label">Fichiers</div><div class="stat-value">${s.files.total}</div><div class="stat-note">dans la base et le stockage</div></div>
    </div>

    <div class="grid cols-2">
      <section class="card card-pad">
        <h2 style="font-size:1.05rem">Activité des 14 derniers jours</h2>
        <div class="bars">
          ${s.activity.map((d) => html`
            <div class="bar-col" title="${d.day} · ${d.views} vue(s) · ${d.publications} publication(s) · ${d.inscriptions} inscription(s)">
              <div class="bar" style="height:${Math.max(3, Math.round((Number(d.views) / maxDay) * 100))}%"></div>
              <span class="bar-label">${new Date(d.day).getDate()}</span>
            </div>`)}
        </div>
        <div class="legend"><span><span class="dot" style="background:var(--bleu)"></span>Consultations par jour</span><span>Publiques : ${s.activity.reduce((a, d) => a + Number(d.publications), 0)} · Inscriptions : ${s.activity.reduce((a, d) => a + Number(d.inscriptions), 0)}</span></div>
        <div class="table-wrap mt2">
          <table class="data"><thead><tr><th>Jour</th><th>Publications</th><th>Vues</th><th>Inscriptions</th><th>Demandes</th></tr></thead>
          <tbody>${s.activity.slice().reverse().map((d) => html`<tr><td>${fmtDate(d.day)}</td><td>${d.publications}</td><td>${d.views}</td><td>${d.inscriptions}</td><td>${d.demandes}</td></tr>`)}</tbody></table>
        </div>
      </section>

      <div class="stack">
        <section class="card card-pad">
          <h2 style="font-size:1.05rem">Comptes par rôle</h2>
          <div class="table-wrap"><table class="data"><thead><tr><th>Rôle</th><th>Actifs</th><th>En attente</th></tr></thead>
            <tbody>${s.byRole.map((r) => html`<tr><td>${r.name}</td><td>${r.active}</td><td>${r.pending}</td></tr>`)}</tbody></table></div>
        </section>
        <section class="card card-pad">
          <h2 style="font-size:1.05rem">Étudiants par niveau</h2>
          ${s.byLevel.length ? html`<div class="table-wrap"><table class="data"><thead><tr><th>Niveau</th><th>Étudiants</th></tr></thead><tbody>${s.byLevel.map((l) => html`<tr><td>${l.name}</td><td>${l.n}</td></tr>`)}</tbody></table></div>` : '<p class="muted small">Aucun niveau enregistré.</p>'}
        </section>
        <section class="card card-pad">
          <h2 style="font-size:1.05rem">Étudiants par parcours</h2>
          ${s.byParcours.length ? html`<div class="table-wrap"><table class="data"><thead><tr><th>Parcours</th><th>Étudiants</th></tr></thead><tbody>${s.byParcours.map((p) => html`<tr><td>${p.name}</td><td>${p.n}</td></tr>`)}</tbody></table></div>` : '<p class="muted small">Aucun parcours enregistré.</p>'}
        </section>
        <section class="card card-pad">
          <h2 style="font-size:1.05rem">Notifications</h2>
          <p class="small">${s.notifications.total} envoyées · ${s.notifications.read} lues · ${s.notifications.opened} ouvertes</p>
          <div style="height:10px;background:var(--bord);border-radius:999px;overflow:hidden"><div style="height:100%;width:${readRate}%;background:var(--ok)"></div></div>
          <p class="hint mt1">Une notification « ouverte » signifie que la publication liée a réellement été consultée.</p>
        </section>
      </div>
    </div>
  `);
  document.getElementById('refresh-stats').addEventListener('click', () => renderAdminStats(root));
}

/* =====================================================================
   JOURNAL
   ===================================================================== */
export async function renderAdminAudit(root) {
  let action = '';
  let page = 1;
  let entity = '';
  root.innerHTML = String(html`
    <div class="page-header">
      <div>
        <h1 class="page-title">Journal d’activité</h1>
        <p class="page-sub">Traçabilité des opérations sensibles : comptes, publications, résultats, documents, paramètres.</p>
      </div>
    </div>
    <div class="toolbar">
      <div class="field search-field"><label class="label sr-only" for="au-search">Action</label>
        <div class="search-input">${icon('search')}<input class="input" id="au-search" type="search" placeholder="Filtrer par action (ex. user.suspend)…"></div></div>
      <div class="field"><label class="label sr-only" for="au-entity">Entité</label>
        <select class="select" id="au-entity"><option value="">Toutes les entités</option>
          ${['user', 'publication', 'document', 'result', 'timetable', 'request', 'settings', 'role', 'level', 'parcours', 'event', 'activity', 'backup'].map((e) => html`<option value="${e}">${e}</option>`)}</select></div>
    </div>
    <div id="audit-box">${loading()}</div>
    <div class="flex between mt2"><span class="muted small" id="audit-total"></span>
      <span class="flex"><button class="btn btn-secondary btn-sm" id="au-prev">Précédent</button><button class="btn btn-secondary btn-sm" id="au-next">Suivant</button></span></div>
  `);
  const box = document.getElementById('audit-box');
  const load = async () => {
    box.innerHTML = String(loading());
    const params = new URLSearchParams({ page: String(page), limit: '40' });
    if (action) params.set('action', action);
    if (entity) params.set('entity', entity);
    try {
      const data = await api(`/admin/audit?${params.toString()}`);
      document.getElementById('audit-total').textContent = `${data.total} entrée(s)`;
      if (!data.logs.length) {
        box.innerHTML = String(emptyState('Aucune entrée', 'Aucune opération ne correspond à ces filtres.', 'history'));
        return;
      }
      box.innerHTML = String(html`<div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th>Acteur</th><th>Action</th><th>Entité</th><th>Détails</th></tr></thead>
        <tbody>${data.logs.map((l) => html`<tr>
          <td class="nowrap">${fmtDateTime(l.created_at)}</td>
          <td>${l.actor_name || 'Système'}<div class="tiny muted">${l.actor_role || ''}</div></td>
          <td><code>${l.action}</code></td>
          <td>${l.entity_type || '—'}${l.entity_id ? html`<span class="tiny muted"> #${l.entity_id}</span>` : ''}</td>
          <td class="tiny muted" style="max-width:320px;overflow-wrap:anywhere">${l.details && Object.keys(l.details).length ? JSON.stringify(l.details) : '—'}</td>
        </tr>`)}</tbody></table></div>`);
    } catch (err) {
      box.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>${err.message}</div></div>`);
    }
  };
  let timer;
  document.getElementById('au-search').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { action = e.target.value.trim(); page = 1; load(); }, 300);
  });
  document.getElementById('au-entity').addEventListener('change', (e) => { entity = e.target.value; page = 1; load(); });
  document.getElementById('au-prev').addEventListener('click', () => { if (page > 1) { page -= 1; load(); } });
  document.getElementById('au-next').addEventListener('click', () => { page += 1; load(); });
  await load();
}

/* =====================================================================
   SAUVEGARDE
   ===================================================================== */
export async function renderAdminBackup(root) {
  root.innerHTML = String(html`<div class="loader"><span class="spinner"></span> Chargement…</div>`);
  let health = null;
  try { health = await api('/admin/health'); } catch {}
  root.innerHTML = String(html`
    <div class="page-header">
      <div>
        <h1 class="page-title">Sauvegarde et exploitation</h1>
        <p class="page-sub">Export des données et état technique de l’application.</p>
      </div>
      <div class="page-actions"><a class="btn btn-primary" href="/api/admin/backup" download>${icon('download')} Exporter les données (JSON)</a></div>
    </div>
    <div class="alert alert-warn">${icon('alert')}<div><strong>À conserver hors du serveur.</strong> Le stockage local de Render peut être éphémère. Téléchargez régulièrement la sauvegarde PostgreSQL et conservez-la dans un espace sécurisé. L’export JSON contient les données sensibles (comptes, demandes, messages) : ne le partagez pas.</div></div>
    <div class="grid cols-2">
      <section class="card card-pad">
        <h2 style="font-size:1.05rem">${icon('database')} État de l’application</h2>
        ${health ? html`<dl class="key-value">
          <dt>Version</dt><dd>${health.version}</dd>
          <dt>Base de données</dt><dd>${health.database === 'pg' ? 'PostgreSQL' : 'PostgreSQL embarqué (développement)'}</dd>
          <dt>Stockage des fichiers</dt><dd>${health.storage === 'supabase' ? 'Supabase (privé)' : health.storage === 'db' ? 'PostgreSQL' : 'Disque local'}</dd>
          <dt>Comptes</dt><dd>${health.counts.users}</dd>
          <dt>Publications</dt><dd>${health.counts.publications}</dd>
          <dt>Documents</dt><dd>${health.counts.documents}</dd>
          <dt>Fichiers</dt><dd>${health.counts.files}</dd>
          <dt>Notifications</dt><dd>${health.counts.notifications}</dd>
          <dt>Uptime serveur</dt><dd>${Math.floor(health.uptime_seconds / 60)} min</dd>
          <dt>Mémoire utilisée</dt><dd>${health.memory_mb} Mo</dd>
        </dl>` : `<p class="muted">${icon('info')} État technique indisponible.</p>`}
        <button class="btn btn-secondary btn-sm mt2" id="reload-health">${icon('refresh')} Actualiser</button>
      </section>
      <section class="card card-pad">
        <h2 style="font-size:1.05rem">${icon('shield')} Procédure de sauvegarde</h2>
        <ol class="small">
          <li>Utilisez de préférence la sauvegarde native PostgreSQL fournie par votre hébergeur (<code>pg_dump</code>), qui inclut les fichiers stockés en base.</li>
          <li>Téléchargez l’export JSON ci-dessus pour archiver les données hors du serveur.</li>
          <li>Conservez également les fichiers du stockage objet (Supabase) si ce mode est activé.</li>
          <li>Testez la restauration sur une base <strong>vide et distincte</strong> avant toute mise en production.</li>
          <li>Les procédures détaillées figurent dans <code>docs/EXPLOITATION.md</code> du projet.</li>
        </ol>
        <div class="alert alert-info" style="margin-bottom:0">${icon('info')}<div class="small">Aucun effacement automatique des comptes, résultats, documents ou historiques n’est effectué par l’application.</div></div>
      </section>
    </div>
  `);
  document.getElementById('reload-health').addEventListener('click', () => renderAdminBackup(root));
}
