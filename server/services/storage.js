import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { getSetting } from '../settings.js';
import { query, one } from '../db.js';
import { badRequest } from '../errors.js';

/**
 * Stockage des fichiers.
 * Priorité : Supabase Storage (si configuré) → PostgreSQL (prod/durable) → disque local.
 * Le disque local de Render est éphémère : en production sans Supabase, les
 * fichiers sont stockés en base PostgreSQL.
 */
const ALLOWED = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'text/plain': 'txt',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'video/mp4': 'mp4',
};

export const MAX_UPLOAD_MB_FALLBACK = 8;

export function driverFor() {
  if (config.storageBackend === 'supabase' && config.supabaseUrl && config.supabaseKey) return 'supabase';
  if (['postgres', 'db'].includes(config.storageDriver)) return 'db';
  if (config.storageDriver === 'local') {
    // Sur Render, le disque est éphémère : en production, on stocke en base
    // PostgreSQL pour éviter la perte silencieuse des fichiers redéployés.
    if (config.isProd) {
      console.warn('⚠️  STORAGE_DRIVER=local ignoré en production : stockage des fichiers en base PostgreSQL.');
      return 'db';
    }
    return 'local';
  }
  return config.isProd ? 'db' : 'local';
}

export async function maxUploadBytes() {
  const s = await getSetting('max_upload_mb', String(config.maxUploadMb));
  const mb = Math.min(50, Math.max(1, Number(s) || config.maxUploadMb));
  return mb * 1024 * 1024;
}

function checkSignature(buffer, mime) {
  const head = buffer.subarray(0, 8);
  if (mime === 'application/pdf') return head.subarray(0, 4).toString() === '%PDF';
  if (mime === 'image/png') return head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === 'image/jpeg') return head[0] === 0xff && head[1] === 0xd8;
  if (mime === 'image/webp') return buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP';
  return true;
}

export async function saveFile(buffer, { filename, mime, uploadedBy }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw badRequest('Aucun fichier reçu.');
  const maxBytes = await maxUploadBytes();
  if (buffer.length > maxBytes) {
    throw badRequest(`Fichier trop volumineux (maximum ${Math.round(maxBytes / 1024 / 1024)} Mo).`);
  }
  const cleanMime = String(mime || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  if (!ALLOWED[cleanMime]) {
    throw badRequest(
      "Type de fichier non autorisé. Formats acceptés : PDF, images (JPG, PNG, WEBP), Office (DOCX, PPTX, XLSX), texte, audio et vidéo MP4."
    );
  }
  if (!checkSignature(buffer, cleanMime)) throw badRequest('Le contenu du fichier ne correspond pas à son type.');
  const safeName = String(filename || 'fichier').replace(/[\r\n"\\/]/g, '_').slice(0, 200);
  const sha = crypto.createHash('sha256').update(buffer).digest('hex');
  const driver = driverFor();
  const key = `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ALLOWED[cleanMime]}`;
  let storage = driver;
  let data = null;

  if (driver === 'supabase') {
    const res = await fetch(
      `${config.supabaseUrl.replace(/\/$/, '')}/storage/v1/object/${config.supabaseBucket}/${key}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.supabaseKey}`,
          'Content-Type': cleanMime,
          'x-upsert': 'true',
        },
        body: buffer,
      }
    );
    if (!res.ok) throw new Error(`Stockage Supabase indisponible (${res.status}).`);
  } else if (driver === 'db') {
    storage = 'db';
    data = buffer;
  } else {
    const dir = path.join(config.storageDir, 'uploads', path.dirname(key));
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(config.storageDir, 'uploads', key), buffer);
    storage = 'local';
  }

  const row = await one(
    `INSERT INTO files (filename, mime, size, storage, storage_key, data, sha256, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, filename, mime, size, created_at`,
    [safeName, cleanMime, buffer.length, storage, key, data, sha, uploadedBy]
  );
  return row;
}

export async function readFileRow(fileId) {
  return one('SELECT * FROM files WHERE id = $1', [fileId]);
}

export async function getFileBuffer(file) {
  if (file.storage === 'db') {
    if (!file.data) throw badRequest('Fichier introuvable.');
    return Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
  }
  if (file.storage === 'supabase') {
    const res = await fetch(
      `${config.supabaseUrl.replace(/\/$/, '')}/storage/v1/object/${config.supabaseBucket}/${file.storage_key}`,
      { headers: { Authorization: `Bearer ${config.supabaseKey}` } }
    );
    if (!res.ok) throw badRequest('Fichier introuvable dans le stockage.');
    return Buffer.from(await res.arrayBuffer());
  }
  const p = path.join(config.storageDir, 'uploads', file.storage_key);
  if (!fs.existsSync(p)) throw badRequest('Fichier introuvable sur le disque.');
  return fsp.readFile(p);
}

export async function deleteFileById(fileId) {
  const file = await one('SELECT * FROM files WHERE id = $1', [fileId]);
  if (!file) return;
  try {
    if (file.storage === 'supabase') {
      await fetch(`${config.supabaseUrl.replace(/\/$/, '')}/storage/v1/object/${config.supabaseBucket}/${file.storage_key}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${config.supabaseKey}` },
      });
    } else if (file.storage === 'local') {
      await fsp.rm(path.join(config.storageDir, 'uploads', file.storage_key), { force: true });
    }
  } catch (err) {
    console.error('Suppression fichier:', err.message);
  }
  await query('DELETE FROM files WHERE id = $1', [fileId]);
}

export function contentDisposition(filename, inline = false) {
  const ascii = String(filename).replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
