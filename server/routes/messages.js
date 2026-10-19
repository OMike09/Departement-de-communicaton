import express from 'express';
import { query, one } from '../db.js';
import { requireAuth, requireCsrf } from '../auth.js';
import { ah } from './util.js';
import { str, intId } from '../validation.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { audit } from '../audit.js';
import { notifyUsers } from '../services/notify.js';

const router = express.Router();

router.get('/messages/contacts', requireAuth, ah(async (req, res) => {
  const student = req.user.role_slug === 'etudiant';
  const rows = await query(
    `SELECT u.id, u.full_name, r.name AS role_name, r.slug AS role_slug, l.name AS level_name
     FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN levels l ON l.id = u.level_id
     WHERE u.status = 'active' AND u.id <> $1 ${student ? "AND r.slug <> 'etudiant'" : ''}
     ORDER BY CASE r.slug WHEN 'chef' THEN 0 WHEN 'secretariat' THEN 1 WHEN 'enseignant' THEN 2 ELSE 3 END, u.full_name
     LIMIT 300`,
    [req.user.id]
  );
  res.json({ contacts: rows });
}));

router.get('/messages/unread-count', requireAuth, ah(async (req, res) => {
  const row = await one(
    `SELECT COUNT(*)::int AS n FROM messages m
     JOIN thread_participants tp ON tp.thread_id = m.thread_id AND tp.user_id = $1
     WHERE m.sender_id <> $1 AND (tp.last_read_at IS NULL OR m.created_at > tp.last_read_at)`,
    [req.user.id]
  );
  res.json({ unread: row.n });
}));

router.get('/messages/threads', requireAuth, ah(async (req, res) => {
  const rows = await query(
    `SELECT t.id, t.subject, t.created_at,
       (SELECT COUNT(*)::int FROM messages m WHERE m.thread_id = t.id AND m.sender_id <> $1
          AND (tp.last_read_at IS NULL OR m.created_at > tp.last_read_at)) AS unread,
       (SELECT MAX(m.created_at) FROM messages m WHERE m.thread_id = t.id) AS last_at,
       (SELECT m.body FROM messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_body,
       (SELECT STRING_AGG(u.full_name, ', ' ORDER BY u.full_name)
          FROM thread_participants p2 JOIN users u ON u.id = p2.user_id
          WHERE p2.thread_id = t.id AND p2.user_id <> $1) AS others
     FROM threads t
     JOIN thread_participants tp ON tp.thread_id = t.id AND tp.user_id = $1
     ORDER BY COALESCE((SELECT MAX(m.created_at) FROM messages m WHERE m.thread_id = t.id), t.created_at) DESC
     LIMIT 100`,
    [req.user.id]
  );
  res.json({ threads: rows });
}));

router.post('/messages/threads', requireAuth, requireCsrf, ah(async (req, res) => {
  const subject = str(req.body.subject, { required: true, min: 2, max: 200, field: 'L’objet' });
  const body = str(req.body.body, { required: true, min: 1, max: 5000, field: 'Le message' });
  const recipientId = intId(req.body.recipient_id, { field: 'Le destinataire' });
  if (recipientId === req.user.id) throw badRequest('Vous ne pouvez pas vous écrire à vous-même.');
  const recipient = await one(
    `SELECT u.id, u.full_name, r.slug AS role_slug FROM users u JOIN roles r ON r.id=u.role_id
     WHERE u.id = $1 AND u.status = 'active'`,
    [recipientId]
  );
  if (!recipient) throw badRequest('Destinataire introuvable ou suspendu.');
  if (req.user.role_slug === 'etudiant' && recipient.role_slug === 'etudiant') {
    throw forbidden('Les étudiants ne peuvent écrire qu’aux responsables et enseignants du département.');
  }
  const thread = await one('INSERT INTO threads (subject, created_by) VALUES ($1,$2) RETURNING id', [subject, req.user.id]);
  await query('INSERT INTO thread_participants (thread_id, user_id, last_read_at) VALUES ($1,$2,now()), ($1,$3,NULL)', [
    thread.id, req.user.id, recipientId,
  ]);
  await query('INSERT INTO messages (thread_id, sender_id, body) VALUES ($1,$2,$3)', [thread.id, req.user.id, body]);
  await notifyUsers([recipientId], {
    type: 'message',
    title: `Nouveau message de ${req.user.full_name}`,
    body: subject,
  });
  await audit(req, 'message.create', 'thread', thread.id, { recipientId });
  res.status(201).json({ message: 'Message envoyé.', id: thread.id });
}));

async function loadThread(userId, threadId) {
  const participant = await one('SELECT * FROM thread_participants WHERE thread_id = $1 AND user_id = $2', [threadId, userId]);
  if (!participant) throw notFound('Conversation introuvable.');
  const thread = await one('SELECT * FROM threads WHERE id = $1', [threadId]);
  if (!thread) throw notFound('Conversation introuvable.');
  return { thread, participant };
}

router.get('/messages/threads/:id', requireAuth, ah(async (req, res) => {
  const id = intId(req.params.id);
  const { thread } = await loadThread(req.user.id, id);
  const participants = await query(
    `SELECT u.id, u.full_name, r.name AS role_name FROM thread_participants p
     JOIN users u ON u.id = p.user_id JOIN roles r ON r.id = u.role_id WHERE p.thread_id = $1`,
    [id]
  );
  const messages = await query(
    `SELECT m.id, m.body, m.created_at, m.sender_id, u.full_name AS sender_name
     FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.thread_id = $1 ORDER BY m.created_at ASC`,
    [id]
  );
  await query('UPDATE thread_participants SET last_read_at = now() WHERE thread_id = $1 AND user_id = $2', [id, req.user.id]);
  res.json({ thread, participants, messages, me: req.user.id });
}));

router.post('/messages/threads/:id/messages', requireAuth, requireCsrf, ah(async (req, res) => {
  const id = intId(req.params.id);
  await loadThread(req.user.id, id);
  const body = str(req.body.body, { required: true, min: 1, max: 5000, field: 'Le message' });
  await query('INSERT INTO messages (thread_id, sender_id, body) VALUES ($1,$2,$3)', [id, req.user.id, body]);
  await query('UPDATE thread_participants SET last_read_at = now() WHERE thread_id = $1 AND user_id = $2', [id, req.user.id]);
  const others = await query('SELECT user_id FROM thread_participants WHERE thread_id = $1 AND user_id <> $2', [id, req.user.id]);
  await notifyUsers(others.map((o) => o.user_id), {
    type: 'message',
    title: `Nouveau message de ${req.user.full_name}`,
    body: body.slice(0, 200),
  });
  res.status(201).json({ message: 'Réponse envoyée.' });
}));

export default router;
