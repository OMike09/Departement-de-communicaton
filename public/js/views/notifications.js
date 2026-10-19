import {
  state, api, html, icon, fmtDateTime, timeAgo, navigate, toast,
  loading, emptyState, enableBrowserNotifications, playSound,
} from '../api.js';

const TYPE_ICONS = {
  publication: 'megaphone', result: 'award', request: 'book', message: 'message',
  timetable: 'calendar', account: 'user', info: 'info',
};

export async function renderNotifications(root) {
  let unreadOnly = false;
  let page = 1;

  root.innerHTML = String(html`
    <div class="page-header">
      <div>
        <h1 class="page-title">Notifications</h1>
        <p class="page-sub">Retrouvez les publications, résultats, messages et demandes qui vous concernent.</p>
      </div>
      <div class="page-actions"><button class="btn btn-secondary" id="read-all">${icon('check')} Tout marquer comme lu</button></div>
    </div>
    <div class="tabs" role="tablist">
      <button class="tab active" data-unread="0" role="tab">Toutes</button>
      <button class="tab" data-unread="1" role="tab">Non lues <span class="badge badge-warn" id="unread-tab-count">${state.notif.unread}</span></button>
    </div>
    <div class="card" style="overflow:hidden">
      <div class="notif-list" id="notif-box">${loading()}</div>
    </div>
    <div class="flex between mt2">
      <span class="muted small" id="notif-total"></span>
      <button class="btn btn-secondary btn-sm" id="load-more" hidden>Charger plus</button>
    </div>
    <section class="card card-pad mt3">
      <h2 style="font-size:1rem">${icon('bell')} Notifications système (facultatives)</h2>
      <p class="small muted">Vous pouvez autoriser le navigateur à afficher une alerte lorsque l’application est ouverte ou en arrière-plan. Cette fonction dépend du navigateur et du téléphone : elle peut être bloquée par le système lorsque l’application est totalement fermée. Le son de notification se règle dans <a href="#/profil">Mon profil</a>.</p>
      <div class="flex flex-wrap">
        <button class="btn btn-secondary btn-sm" id="enable-browser">${icon('bell')} Autoriser les notifications système</button>
        <button class="btn btn-ghost btn-sm" id="test-sound">${icon('volume')} Tester mon son</button>
      </div>
      <div class="hint" id="browser-status"></div>
    </section>
  `);

  const box = document.getElementById('notif-box');
  const more = document.getElementById('load-more');
  const totalLabel = document.getElementById('notif-total');
  let total = 0;

  const load = async (append = false) => {
    if (!append) { box.innerHTML = String(loading()); page = 1; }
    try {
      const data = await api(`/notifications?page=${page}&limit=30${unreadOnly ? '&unread=1' : ''}`);
      total = data.total;
      const items = data.notifications;
      const htmlItems = items.map((n) => html`
        <div class="notif-item ${n.read_at ? '' : 'unread'}" data-notif="${n.id}">
          <div class="notif-icon">${icon(TYPE_ICONS[n.type] || 'info')}</div>
          <div class="notif-body">
            <p class="notif-title">${n.publication_title || n.title}</p>
            <p class="notif-sub">${n.body || ''}${n.author_name ? ` — ${n.author_name}` : ''}</p>
            <div class="notif-time">${timeAgo(n.created_at)} · ${n.created_at ? fmtDateTime(n.created_at) : ''} ${n.opened_at ? '· Ouverte' : n.read_at ? '· Lue' : ''}</div>
            ${n.publication_id ? html`<button class="btn btn-ghost btn-sm" data-open-notif="${n.id}" data-pub="${n.publication_id}">Ouvrir la publication ${icon('arrow-right')}</button>` : ''}
            ${n.type === 'message' ? html`<a class="btn btn-ghost btn-sm" href="#/messages">Ouvrir la messagerie ${icon('arrow-right')}</a>` : ''}
            ${n.type === 'request' ? html`<a class="btn btn-ghost btn-sm" href="#/demandes">Ouvrir les demandes ${icon('arrow-right')}</a>` : ''}
            ${n.type === 'result' ? html`<a class="btn btn-ghost btn-sm" href="#/resultats">Ouvrir les résultats ${icon('arrow-right')}</a>` : ''}
          </div>
          <div class="notif-actions">
            ${!n.read_at ? html`<button class="btn btn-icon" data-read="${n.id}" aria-label="Marquer comme lue" title="Marquer comme lue">${icon('check')}</button>` : ''}
          </div>
        </div>`);
      if (append) box.insertAdjacentHTML('beforeend', String(html`${htmlItems}`));
      else if (!items.length) box.innerHTML = String(unreadOnly ? emptyState('Aucune notification non lue', 'Toutes vos notifications ont été lues.', 'bell') : emptyState('Aucune notification', 'Les alertes de nouvelles publications apparaîtront ici.', 'bell'));
      else box.innerHTML = String(html`${htmlItems}`);
      totalLabel.textContent = `${Math.min(page * 30, total)} sur ${total} notification(s)`;
      more.hidden = page * 30 >= total;

      box.querySelectorAll('[data-read]').forEach((btn) => btn.addEventListener('click', async () => {
        try {
          await api(`/notifications/${btn.dataset.read}/read`, { method: 'POST' });
          const count = await api('/notifications/count');
          state.notif.unread = count.unread;
          updateBadge();
          load();
        } catch (err) { toast(err.message, 'error'); }
      }));
      box.querySelectorAll('[data-open-notif]').forEach((btn) => btn.addEventListener('click', async () => {
        try {
          await api(`/notifications/${btn.dataset.openNotif}/read`, { method: 'POST' }).catch(() => {});
          const count = await api('/notifications/count');
          state.notif.unread = count.unread;
          updateBadge();
          navigate(`/annonces/${btn.dataset.pub}`);
        } catch (err) { toast(err.message, 'error'); }
      }));
      box.querySelectorAll('[data-notif]').forEach((item) => {
        item.addEventListener('click', (e) => {
          if (e.target.closest('button, a')) return;
        });
      });
    } catch (err) {
      box.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>${err.message}</div></div>`);
    }
  };

  const updateBadge = () => {
    document.getElementById('unread-tab-count').textContent = String(state.notif.unread);
    for (const id of ['top-notif-count', 'nav-notif-count']) {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = String(state.notif.unread);
        el.classList.toggle('hidden', !state.notif.unread);
      }
    }
  };

  root.querySelectorAll('[data-unread]').forEach((tab) => tab.addEventListener('click', () => {
    unreadOnly = tab.dataset.unread === '1';
    root.querySelectorAll('[data-unread]').forEach((t) => t.classList.toggle('active', t === tab));
    load();
  }));
  document.getElementById('read-all').addEventListener('click', async () => {
    try {
      const res = await api('/notifications/read-all', { method: 'POST' });
      toast(res.message, 'success');
      state.notif.unread = 0;
      updateBadge();
      load();
    } catch (err) { toast(err.message, 'error'); }
  });
  more.addEventListener('click', () => { page += 1; load(true); });
  document.getElementById('enable-browser').addEventListener('click', async () => {
    await enableBrowserNotifications();
    updateBrowserStatus();
  });
  document.getElementById('test-sound').addEventListener('click', () => {
    playSound(state.user?.sound_pref || 'classique');
    toast('Son de notification testé.', 'success');
  });
  const updateBrowserStatus = () => {
    const el = document.getElementById('browser-status');
    if (!('Notification' in window)) {
      el.textContent = 'Ce navigateur ne prend pas en charge les notifications système. Les alertes restent visibles dans l’application.';
    } else if (Notification.permission === 'granted') {
      el.textContent = 'Notifications système autorisées. Une alerte peut s’afficher lorsque l’application est en arrière-plan, selon le navigateur.';
    } else if (Notification.permission === 'denied') {
      el.textContent = 'Notifications système bloquées dans le navigateur. Vous pouvez les réautoriser dans les réglages du site.';
    } else {
      el.textContent = 'Notifications système non configurées. Les alertes dans l’application fonctionnent dans tous les cas.';
    }
  };
  updateBrowserStatus();
  await load();
}
