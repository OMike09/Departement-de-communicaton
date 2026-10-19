import express from 'express';
import { one, query } from '../db.js';
import { requireAuth, requireCsrf } from '../auth.js';
import { hasAny } from '../permissions.js';
import { forbidden } from '../errors.js';
import { ah } from './util.js';
import { saveFile, readFileRow, getFileBuffer, contentDisposition, maxUploadBytes } from '../services/storage.js';
import { canAccessFile } from '../services/access.js';
import { badRequest, notFound } from '../errors.js';
import { audit } from '../audit.js';
import { intId } from '../validation.js';

const router = express.Router();

/**
 * Téléversement en deux temps : POST /api/uploads (corps binaire),
 * puis référencement du fichier retourné dans une publication,
 * un document, un résultat ou un emploi du temps.
 */
router.post('/uploads', requireAuth, requireCsrf, async (req, res, next) => {
  try {
    if (!hasAny(req.user, ['documents.upload', 'publications.create', 'results.manage', 'timetables.manage', 'settings.manage', 'users.manage'])) {
      throw forbidden('Votre compte ne dispose pas du droit de déposer des fichiers.');
    }
    const limit = await maxUploadBytes();
    const raw = express.raw({ type: () => true, limit });
    raw(req, res, async (err) => {
      if (err) {
        if (err.type === 'entity.too.large') {
          return next(badRequest(`Fichier trop volumineux (maximum ${Math.round(limit / 1024 / 1024)} Mo).`));
        }
        return next(err);
      }
      try {
        const mime = req.get('content-type') || 'application/octet-stream';
        const filename = decodeURIComponent(req.get('x-file-name') || 'fichier');
        const file = await saveFile(req.body, { filename, mime, uploadedBy: req.user.id });
        await audit(req, 'file.upload', 'file', file.id, { filename: file.filename, size: file.size });
        res.status(201).json({ file });
      } catch (error) {
        next(error);
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get('/files/:id', ah(async (req, res) => {
  const id = intId(req.params.id);
  const file = await readFileRow(id);
  if (!file) throw notFound('Fichier introuvable.');
  const access = await canAccessFile(req.user, id);
  if (!access.ok) throw notFound('Fichier introuvable ou non accessible.');
  const inline = req.query.inline === '1' && /^(application\/pdf|image\/|audio\/|video\/)/.test(file.mime);
  const buffer = await getFileBuffer(file);
  res.setHeader('Content-Type', file.mime);
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('Content-Disposition', contentDisposition(file.filename, inline));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', access.inline && file.storage === 'db' ? 'private, max-age=300' : 'private, no-store');
  res.end(buffer);
}));

router.get('/public/logo', ah(async (req, res) => {
  const setting = await one("SELECT value FROM settings WHERE key = 'logo_file_id'");
  const id = setting ? Number(setting.value) : 0;
  if (!id) throw notFound('Aucun logo défini.');
  const file = await readFileRow(id);
  if (!file) throw notFound('Logo introuvable.');
  const buffer = await getFileBuffer(file);
  res.setHeader('Content-Type', file.mime);
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('Cache-Control', 'public, max-age=600');
  res.end(buffer);
}));

router.get('/files', requireAuth, ah(async (req, res) => {
  if (!['chef', 'secretariat'].includes(req.user.role_slug) && !(req.user.permissions || []).includes('documents.manage')) {
    return res.json({ files: [] });
  }
  const rows = await query(
    `SELECT f.id, f.filename, f.mime, f.size, f.created_at, u.full_name AS uploaded_by_name,
       (SELECT COUNT(*)::int FROM documents d WHERE d.file_id = f.id) AS documents,
       (SELECT COUNT(*)::int FROM publication_files pf WHERE pf.file_id = f.id) AS publications,
       (SELECT COUNT(*)::int FROM results r WHERE r.file_id = f.id) AS results,
       (SELECT COUNT(*)::int FROM timetables t WHERE t.file_id = f.id) AS timetables
     FROM files f LEFT JOIN users u ON u.id = f.uploaded_by
     ORDER BY f.created_at DESC LIMIT 200`
  );
  res.json({ files: rows });
}));

export default router;
