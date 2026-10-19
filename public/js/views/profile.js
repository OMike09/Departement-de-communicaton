import {
  state, api, html, icon, fmtDateTime, toast, applyScale, playSound,
  enableBrowserNotifications, initials, setLoading,
} from '../api.js';
import { bindPasswordToggles } from './public.js';

const SOUND_LABELS = {
  classique: 'Classique', discret: 'Discret', doux: 'Doux', academique: 'Académique',
  dynamique: 'Dynamique', defaut: 'Par défaut', aucun: 'Aucun son',
};

export async function renderProfile(root) {
  root.innerHTML = String(html`<div class="loader"><span class="spinner"></span> Chargement du profil…</div>`);
  let data;
  try {
    data = await api('/profile');
  } catch (err) {
    root.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>${err.message}</div></div>`);
    return;
  }
  const u = data.user;
  const minScale = Number(state.settings.text_scale_min || 0.9);
  const maxScale = Number(state.settings.text_scale_max || 1.4);
  const scale = Math.min(maxScale, Math.max(minScale, Number(u.text_scale) || 1));
  const sound = u.sound_pref || 'classique';

  root.innerHTML = String(html`
    <div class="page-header">
      <div>
        <h1 class="page-title">Mon profil</h1>
        <p class="page-sub">Vos informations personnelles, vos préférences d’affichage et de notifications, et la sécurité de votre compte.</p>
      </div>
    </div>

    <div class="grid cols-2">
      <section class="card card-pad">
        <div class="flex mb2" style="gap:1rem">
          <div class="avatar avatar-lg">${initials(u.full_name)}</div>
          <div>
            <h2 style="margin:0">${u.full_name}</h2>
            <div class="muted small">${u.role_name}</div>
            <div class="flex flex-wrap mt1">
              <span class="badge badge-ok">Compte actif</span>
              ${u.level_name ? html`<span class="badge">${u.level_name}</span>` : ''}
              ${u.parcours_name ? html`<span class="badge badge-gris">${u.parcours_name}</span>` : ''}
              ${u.group_name ? html`<span class="chip">${u.group_name}</span>` : ''}
            </div>
          </div>
        </div>
        <dl class="key-value">
          <dt>Téléphone (identifiant)</dt><dd>${u.phone}</dd>
          <dt>E-mail</dt><dd>${u.email || 'Non renseigné'}</dd>
          <dt>Matricule</dt><dd>${u.matricule || 'Non renseigné'}</dd>
          <dt>Compte créé le</dt><dd>${fmtDateTime(u.created_at)}</dd>
          <dt>Dernière connexion</dt><dd>${u.last_login_at ? fmtDateTime(u.last_login_at) : 'Première connexion'}</dd>
          ${data.scopes.length ? html`<dt>Périmètres attribués</dt><dd>${data.scopes.map((s) => html`<span class="chip">${s.label}</span> `)}</dd>` : ''}
        </dl>
        <div class="hint">Le numéro de téléphone, le rôle, le niveau et le parcours sont modifiés uniquement par l’administration.</div>
      </section>

      <section class="card card-pad">
        <h2 style="font-size:1.05rem">${icon('user')} Informations personnelles</h2>
        <div id="profile-error"></div>
        <form id="profile-form">
          <div class="field"><label class="label" for="p-name">Nom complet <span class="req">*</span></label>
            <input class="input" id="p-name" value="${u.full_name}" required></div>
          <div class="field"><label class="label" for="p-email">Adresse e-mail</label>
            <input class="input" id="p-email" type="email" value="${u.email || ''}" placeholder="nom@exemple.com"></div>
          <button class="btn btn-primary" type="submit" id="p-save">${icon('save')} Enregistrer</button>
        </form>
        <div class="sep"></div>
        <h2 style="font-size:1.05rem">${icon('shield')} Sécurité</h2>
        <p class="small muted">Le mot de passe doit contenir exactement 6 chiffres, conformément à la règle retenue par le département.</p>
        <div id="pw-error"></div>
        <form id="pw-form">
          <div class="field"><label class="label" for="pw-current">Mot de passe actuel</label>
            <div class="pw-wrap"><input class="input" id="pw-current" type="password" inputmode="numeric" maxlength="6" autocomplete="current-password">
              <button type="button" class="btn btn-icon pw-toggle" data-toggle-pw="pw-current" aria-label="Afficher" aria-pressed="false">${icon('eye')}</button></div></div>
          <div class="form-grid">
            <div class="field"><label class="label" for="pw-new">Nouveau mot de passe</label>
              <div class="pw-wrap"><input class="input" id="pw-new" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password">
                <button type="button" class="btn btn-icon pw-toggle" data-toggle-pw="pw-new" aria-label="Afficher" aria-pressed="false">${icon('eye')}</button></div></div>
            <div class="field"><label class="label" for="pw-confirm">Confirmer</label>
              <div class="pw-wrap"><input class="input" id="pw-confirm" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password">
                <button type="button" class="btn btn-icon pw-toggle" data-toggle-pw="pw-confirm" aria-label="Afficher" aria-pressed="false">${icon('eye')}</button></div></div>
          </div>
          <button class="btn btn-secondary" type="submit" id="pw-save">${icon('key')} Modifier le mot de passe</button>
        </form>
      </section>
    </div>

    <section class="card card-pad mt2">
      <h2 style="font-size:1.05rem">${icon('settings')} Préférences d’affichage</h2>
      <div class="pref-block">
        <div class="pref-row">
          <div><strong>Taille du texte</strong><div class="hint">Ajustez la taille pour une lecture confortable sur votre appareil. Bornes définies par l’administration : ${Math.round(minScale * 100)} % à ${Math.round(maxScale * 100)} %.</div></div>
          <span class="badge" id="scale-value">${Math.round(scale * 100)} %</span>
        </div>
        <input type="range" id="scale-range" min="${minScale}" max="${maxScale}" step="0.05" value="${scale}" aria-label="Taille du texte">
        <div class="card card-pad mt1" id="scale-preview" style="background:#fff">
          <strong>Aperçu de lecture</strong>
          <p class="mb0">Les annonces, documents et informations du département s’afficheront à cette taille.</p>
        </div>
      </div>

      <div class="pref-block">
        <div class="pref-row">
          <div><strong>Son de notification</strong><div class="hint">Utilisé lorsqu’une nouvelle alerte arrive pendant que l’application est ouverte. Le son du système, en arrière-plan, dépend du téléphone ou du navigateur.</div></div>
          ${state.modules?.notifications_sound === false ? html`<span class="badge badge-warn">Désactivé par l’administration</span>` : ''}
        </div>
        <div class="sound-options" id="sound-options">
          ${Object.entries(SOUND_LABELS).map(([key, label]) => html`
            <div class="sound-option ${sound === key ? 'selected' : ''}" data-sound="${key}" role="button" tabindex="0" aria-pressed="${sound === key}">
              <span>${label}</span>
              ${key === 'aucun' ? html`<span class="muted">${icon('volume-off')}</span>` : html`<button type="button" class="btn btn-icon btn-sm" data-play="${key}" aria-label="Écouter ${label}">${icon('volume')}</button>`}
            </div>`)}
        </div>
        <label class="check mt1"><input type="checkbox" id="vibration" ${u.vibration ? 'checked' : ''}> Vibreur lors des notifications (si l’appareil le permet)</label>
        <div class="flex end mt2">
          <button class="btn btn-secondary" id="test-notification">${icon('bell')} Tester l’alerte</button>
          <button class="btn btn-primary" id="save-prefs">${icon('save')} Enregistrer les préférences</button>
        </div>
      </div>

      <div class="pref-block" style="margin-bottom:0">
        <div class="pref-row">
          <div><strong>Notifications système</strong><div class="hint">Autorisation du navigateur pour afficher une alerte hors de l’onglet. Les limites d’iOS et Android s’appliquent : une application totalement fermée ne garantit pas la réception.</div></div>
          <button class="btn btn-secondary btn-sm" id="enable-browser">${icon('bell')} Autoriser</button>
        </div>
      </div>
    </section>

    <section class="card card-pad mt2">
      <h2 style="font-size:1.05rem">${icon('info')} À propos de votre compte</h2>
      <dl class="key-value">
        <dt>Rôle</dt><dd>${u.role_name}</dd>
        <dt>Statut</dt><dd>Actif</dd>
        <dt>Rubriques accessibles</dt><dd>${data.scopes.length ? data.scopes.map((s) => s.label).join(' · ') : (u.role_slug === 'etudiant' ? 'Selon votre niveau et votre parcours' : 'Selon vos permissions')}</dd>
      </dl>
      <div class="hint">Pour toute correction de nom officiel, de numéro, de niveau ou de parcours, adressez une demande administrative au secrétariat.</div>
    </section>
  `);

  bindPasswordToggles(root);

  document.getElementById('profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('profile-error');
    errBox.innerHTML = '';
    const btn = document.getElementById('p-save');
    setLoading(btn, true, 'Enregistrement…');
    try {
      const res = await api('/profile', { method: 'PUT', body: { full_name: document.getElementById('p-name').value, email: document.getElementById('p-email').value } });
      toast(res.message, 'success');
      state.user.full_name = document.getElementById('p-name').value.trim();
      document.querySelector('.user-meta strong').textContent = state.user.full_name;
      document.querySelector('.avatar').textContent = initials(state.user.full_name);
      setLoading(btn, false);
    } catch (err) {
      errBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>${err.message}</div></div>`);
      setLoading(btn, false);
    }
  });

  document.getElementById('pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('pw-error');
    errBox.innerHTML = '';
    const current = document.getElementById('pw-current').value;
    const pwd = document.getElementById('pw-new').value;
    const confirm = document.getElementById('pw-confirm').value;
    if (pwd !== confirm) return (errBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>Les mots de passe ne correspondent pas.</div></div>`));
    if (!/^\d{6}$/.test(pwd)) return (errBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>Le mot de passe doit contenir exactement 6 chiffres.</div></div>`));
    const btn = document.getElementById('pw-save');
    setLoading(btn, true, 'Modification…');
    try {
      const res = await api('/auth/change-password', { method: 'POST', body: { current_password: current, password: pwd, password_confirm: confirm } });
      toast(res.message, 'success');
      document.getElementById('pw-form').reset();
      setLoading(btn, false);
    } catch (err) {
      errBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>${err.message}</div></div>`);
      setLoading(btn, false);
    }
  });

  const range = document.getElementById('scale-range');
  const scaleValue = document.getElementById('scale-value');
  range.addEventListener('input', () => {
    const value = Number(range.value);
    scaleValue.textContent = `${Math.round(value * 100)} %`;
    applyScale(value);
  });
  range.addEventListener('change', async () => {
    // Enregistrement immédiat de la taille du texte pour la conserver après reconnexion.
    try {
      await api('/profile/preferences', { method: 'PUT', body: { text_scale: Number(range.value) } });
      state.user.text_scale = Number(range.value);
      state.scale = Number(range.value);
    } catch {
      /* l'utilisateur peut réessayer avec le bouton Enregistrer */
    }
  });

  document.querySelectorAll('[data-sound]').forEach((option) => {
    const select = () => {
      document.querySelectorAll('[data-sound]').forEach((o) => {
        o.classList.toggle('selected', o === option);
        o.setAttribute('aria-pressed', String(o === option));
      });
    };
    option.addEventListener('click', (e) => {
      if (e.target.closest('[data-play]')) return;
      select();
    });
    option.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); } });
  });
  document.querySelectorAll('[data-play]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = btn.dataset.play;
      const option = btn.closest('[data-sound]');
      option.parentElement.querySelectorAll('[data-sound]').forEach((o) => o.classList.toggle('selected', o === option));
      playSound(key);
    });
  });

  document.getElementById('save-prefs').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const selected = document.querySelector('[data-sound].selected')?.dataset.sound || 'classique';
    setLoading(btn, true, 'Enregistrement…');
    try {
      const res = await api('/profile/preferences', {
        method: 'PUT',
        body: {
          sound_pref: selected,
          vibration: document.getElementById('vibration').checked,
          text_scale: Number(range.value),
        },
      });
      toast(res.message, 'success');
      state.user.sound_pref = selected;
      state.user.vibration = document.getElementById('vibration').checked;
      state.user.text_scale = Number(range.value);
      state.scale = Number(range.value);
      setLoading(btn, false);
    } catch (err) {
      toast(err.message, 'error');
      setLoading(btn, false);
    }
  });

  document.getElementById('test-notification').addEventListener('click', () => {
    const selected = document.querySelector('[data-sound].selected')?.dataset.sound || 'classique';
    playSound(selected);
    toast('Alerte de test : ceci simule une nouvelle publication.', 'info');
  });
  document.getElementById('enable-browser').addEventListener('click', async () => {
    const ok = await enableBrowserNotifications();
    if (ok) {
      new Notification('Département de Communication', { body: 'Les notifications système sont activées.', icon: '/icons/icon-192.png' });
    }
  });
}
