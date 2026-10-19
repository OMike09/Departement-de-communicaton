import {
  state, api, html, icon, modal, toast, fmtDateTime, timeAgo,
  loading, emptyState, setLoading,
} from '../api.js';

export async function renderMessages(root, threadId) {
  root.innerHTML = String(loading());
  let threads = [];
  let contacts = [];
  try {
    const [t, c] = await Promise.all([api('/messages/threads'), api('/messages/contacts')]);
    threads = t.threads;
    contacts = c.contacts;
  } catch (err) {
    root.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>${err.message}</div></div>`);
    return;
  }

  let threadData = null;
  if (threadId) {
    try {
      threadData = await api(`/messages/threads/${threadId}`);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  root.innerHTML = String(html`
    <div class="page-header">
      <div>
        <h1 class="page-title">Messagerie interne</h1>
        <p class="page-sub">Échanges privés entre les membres autorisés du département. Les conversations ne sont visibles que par leurs participants.</p>
      </div>
      <div class="page-actions"><button class="btn btn-primary" id="new-thread">${icon('plus')} Nouveau message</button></div>
    </div>
    <div class="msg-layout ${threadData ? 'has-thread' : ''}">
      <section class="thread-list" aria-label="Conversations">
        ${threads.length ? threads.map((t) => html`
          <a class="thread-item ${threadId === t.id ? 'active' : ''}" href="#/messages/${t.id}">
            <div class="flex between">
              <p class="thread-subject">${t.subject}</p>
              ${t.unread ? html`<span class="badge badge-warn">${t.unread}</span>` : ''}
            </div>
            <p class="thread-preview">${t.last_body || ''}</p>
            <div class="thread-meta"><span>${t.others || ''}</span><span>${timeAgo(t.last_at || t.created_at)}</span></div>
          </a>`) : emptyState('Aucune conversation', 'Démarrez un échange avec un responsable ou un enseignant.', 'message')}
      </section>
      <section class="chat" aria-label="Conversation">
        ${threadData ? html`
          <div class="chat-head">
            <div class="flex between flex-wrap">
              <div>
                <h2 style="margin:0;font-size:1.02rem">${threadData.thread.subject}</h2>
                <div class="tiny muted">${threadData.participants.map((p) => p.full_name).join(' · ')}</div>
              </div>
              <a class="btn btn-ghost btn-sm" href="#/messages">${icon('close')} Fermer</a>
            </div>
          </div>
          <div class="chat-body" id="chat-body">
            ${threadData.messages.map((m) => html`
              <div class="bubble ${m.sender_id === state.user.id ? 'me' : ''}">
                ${m.body}
                <span class="bubble-meta">${m.sender_id === state.user.id ? 'Vous' : m.sender_name} · ${fmtDateTime(m.created_at)}</span>
              </div>`)}
          </div>
          <form class="chat-form" id="reply-form">
            <label class="sr-only" for="reply-input">Votre message</label>
            <input class="input" id="reply-input" maxlength="5000" placeholder="Écrire un message…" autocomplete="off">
            <button class="btn btn-primary" type="submit" aria-label="Envoyer">${icon('send')}</button>
          </form>` : html`
          <div class="chat-body" style="align-items:center;justify-content:center">
            ${emptyState('Sélectionnez une conversation', 'Ou choisissez un destinataire pour envoyer un nouveau message.', 'message')}
          </div>`}
      </section>
    </div>
  `);

  const chatBody = document.getElementById('chat-body');
  if (chatBody) chatBody.scrollTop = chatBody.scrollHeight;

  document.getElementById('new-thread').addEventListener('click', () => openNewThread(contacts, (newId) => { location.hash = newId ? `#/messages/${newId}` : '#/messages'; }));

  document.getElementById('reply-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('reply-input');
    const body = input.value.trim();
    if (!body) return;
    const btn = e.currentTarget.querySelector('button');
    setLoading(btn, true, '');
    try {
      await api(`/messages/threads/${threadId}/messages`, { method: 'POST', body: { body } });
      input.value = '';
      await renderMessages(root, threadId);
    } catch (err) {
      toast(err.message, 'error');
      setLoading(btn, false);
    }
  });
}

function openNewThread(contacts, onSent) {
  modal({
    title: 'Nouveau message',
    body: html`
      <div id="msg-form-error"></div>
      <form id="msg-form">
        <div class="field"><label class="label" for="msg-recipient">Destinataire <span class="req">*</span></label>
          <select class="select" id="msg-recipient">
            <option value="">Choisir un destinataire…</option>
            ${contacts.map((c) => html`<option value="${c.id}">${c.full_name} — ${c.role_name}${c.level_name ? ` (${c.level_name})` : ''}</option>`)}
          </select>
          ${!contacts.length ? html`<div class="hint" style="color:var(--warn)">Aucun destinataire disponible pour votre profil.</div>` : ''}
        </div>
        <div class="field"><label class="label" for="msg-subject">Objet <span class="req">*</span></label>
          <input class="input" id="msg-subject" maxlength="200" placeholder="Objet du message"></div>
        <div class="field"><label class="label" for="msg-body">Message <span class="req">*</span></label>
          <textarea class="textarea" id="msg-body" rows="5" maxlength="5000" placeholder="Votre message…"></textarea></div>
        <div class="hint">Les étudiants ne peuvent écrire qu’aux responsables et enseignants du département.</div>
      </form>`,
    footer: html`<button class="btn btn-secondary" data-close>Annuler</button><button class="btn btn-primary" id="msg-submit">${icon('send')} Envoyer</button>`,
    onMount(overlay, close) {
      overlay.querySelector('#msg-submit').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const errBox = overlay.querySelector('#msg-form-error');
        errBox.innerHTML = '';
        const recipient = overlay.querySelector('#msg-recipient').value;
        const subject = overlay.querySelector('#msg-subject').value.trim();
        const body = overlay.querySelector('#msg-body').value.trim();
        if (!recipient) return (errBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>Choisissez un destinataire.</div></div>`));
        if (subject.length < 2) return (errBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>Indiquez un objet.</div></div>`));
        if (!body) return (errBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>Écrivez votre message.</div></div>`));
        setLoading(btn, true, 'Envoi…');
        try {
          const res = await api('/messages/threads', { method: 'POST', body: { recipient_id: recipient, subject, body } });
          toast(res.message, 'success');
          close();
          onSent(res.id);
        } catch (err) {
          errBox.innerHTML = String(html`<div class="alert alert-err">${icon('alert')}<div>${err.message}</div></div>`);
          setLoading(btn, false);
        }
      });
    },
  });
}
