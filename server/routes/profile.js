import express from 'express';
import { query, one } from '../db.js';
import { requireAuth, requireCsrf } from '../auth.js';
import { ah, publicUser } from './util.js';
import { str, email as vemail } from '../validation.js';
import { getSettings } from '../settings.js';
import { audit } from '../audit.js';
import { badRequest } from '../errors.js';

const router = express.Router();

const SOUNDS = ['classique', 'discret', 'doux', 'academique', 'dynamique', 'defaut', 'aucun'];

router.get('/profile', requireAuth, ah(async (req, res) => {
  const row = await one(
    `SELECT u.*, r.name AS role_name, r.slug AS role_slug, r.permissions,
            l.name AS level_name, p.name AS parcours_name
     FROM users u JOIN roles r ON r.id=u.role_id
     LEFT JOIN levels l ON l.id=u.level_id LEFT JOIN parcours p ON p.id=u.parcours_id
     WHERE u.id=$1`,
    [req.user.id]
  );
  const scopes = await query(
    `SELECT us.scope_type, us.scope_id,
       CASE WHEN us.scope_type='level' THEN (SELECT name FROM levels WHERE id=us.scope_id)
            WHEN us.scope_type='parcours' THEN (SELECT name FROM parcours WHERE id=us.scope_id)
            WHEN us.scope_type='group' THEN (SELECT name FROM groups WHERE id=us.scope_id) END AS label
     FROM user_scopes us WHERE us.user_id=$1`,
    [req.user.id]
  );
  res.json({
    user: {
      ...publicUser({ ...row, permissions: typeof row.permissions === 'string' ? JSON.parse(row.permissions) : row.permissions }),
      sound_pref: row.sound_pref,
      vibration: row.vibration,
      text_scale: Number(row.text_scale),
      level_name: row.level_name,
      parcours_name: row.parcours_name,
    },
    scopes,
    sounds: SOUNDS,
  });
}));

router.put('/profile', requireAuth, requireCsrf, ah(async (req, res) => {
  const current = await one('SELECT * FROM users WHERE id = $1', [req.user.id]);
  const fullName = str(req.body.full_name ?? current.full_name, { required: true, min: 3, max: 120, field: 'Le nom complet' });
  const mail = req.body.email === undefined ? current.email : vemail(req.body.email);
  await query('UPDATE users SET full_name=$1, email=$2, updated_at=now() WHERE id=$3', [fullName, mail, req.user.id]);
  await audit(req, 'profile.update', 'user', req.user.id, {});
  res.json({ message: 'Profil mis à jour.' });
}));

router.put('/profile/preferences', requireAuth, requireCsrf, ah(async (req, res) => {
  const current = await one('SELECT * FROM users WHERE id = $1', [req.user.id]);
  const settings = await getSettings();
  let sound = current.sound_pref;
  if (req.body.sound_pref !== undefined) {
    sound = String(req.body.sound_pref);
    if (!SOUNDS.includes(sound)) throw badRequest('Son de notification invalide.');
  }
  let vibration = current.vibration;
  if (req.body.vibration !== undefined) vibration = Boolean(req.body.vibration);
  let scale = Number(current.text_scale);
  if (req.body.text_scale !== undefined) {
    const s = Number(req.body.text_scale);
    const min = Number(settings.text_scale_min || 0.9);
    const max = Number(settings.text_scale_max || 1.4);
    if (!Number.isFinite(s) || s < min || s > max) {
      throw badRequest(`La taille du texte doit être comprise entre ${Math.round(min * 100)} % et ${Math.round(max * 100)} %.`);
    }
    scale = s;
  }
  await query('UPDATE users SET sound_pref=$1, vibration=$2, text_scale=$3, updated_at=now() WHERE id=$4', [
    sound, vibration, scale, req.user.id,
  ]);
  await audit(req, 'profile.preferences', 'user', req.user.id, { sound, vibration, scale });
  res.json({ message: 'Préférences enregistrées.', preferences: { sound_pref: sound, vibration, text_scale: scale } });
}));

export default router;
