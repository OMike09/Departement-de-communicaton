#!/usr/bin/env node
/**
 * Tests d'intégration réels de l'API.
 * Lance un serveur isolé sur une base PostgreSQL embarquée (PGlite) neuve,
 * exécute les scénarios métier et vérifie la persistance après redémarrage.
 *
 *   npm test
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.TEST_PORT || 3210);
const BASE = `http://127.0.0.1:${PORT}`;
const DB_DIR = path.join(os.tmpdir(), `dcub-test-${Date.now()}`);
const CHEF_PHONE = '+2250700000001';
const CHEF_PASSWORD = '123456';

let passed = 0;
let failed = 0;
const failures = [];
let server = null;

function ok(condition, message) {
  if (condition) {
    passed += 1;
    console.log(`  ✔ ${message}`);
  } else {
    failed += 1;
    failures.push(message);
    console.log(`  ✘ ${message}`);
  }
}
function eq(actual, expected, message) {
  eq.last = { actual, expected };
  ok(JSON.stringify(actual) === JSON.stringify(expected), `${message} (attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(actual)})`);
}

/* ------------------------------ Client HTTP ------------------------------ */
class Client {
  constructor(name) {
    this.name = name;
    this.cookies = new Map();
    this.csrf = null;
  }
  cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  async request(method, url, body, { csrf = true, raw = null, headers = {} } = {}) {
    const h = { Accept: 'application/json', ...headers };
    if (this.cookies.size) h.Cookie = this.cookieHeader();
    if (csrf && this.csrf && !['GET', 'HEAD'].includes(method)) h['X-CSRF-Token'] = this.csrf;
    if (body !== undefined) {
      h['Content-Type'] = 'application/json';
    }
    const res = await fetch(`${BASE}${url}`, {
      method,
      headers: h,
      body: raw !== null ? raw : body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookies = res.headers.getSetCookie?.() || [];
    for (const c of setCookies) {
      const [pair] = c.split(';');
      const idx = pair.indexOf('=');
      const key = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (value === '' || /expires=thu, 01 jan 1970/i.test(c)) this.cookies.delete(key);
      else this.cookies.set(key, value);
    }
    const ct = res.headers.get('content-type') || '';
    let data = null;
    if (ct.includes('application/json')) data = await res.json().catch(() => null);
    else data = await res.arrayBuffer().then((b) => Buffer.from(b));
    return { status: res.status, data, headers: res.headers };
  }
  get(url, opts) { return this.request('GET', url, undefined, opts); }
  post(url, body, opts) { return this.request('POST', url, body, opts); }
  put(url, body, opts) { return this.request('PUT', url, body, opts); }
  del(url, opts) { return this.request('DELETE', url, undefined, opts); }

  async login(phone, password) {
    const res = await this.post('/api/auth/login', { phone, password }, { csrf: false });
    if (res.status === 200) this.csrf = res.data.csrf_token;
    return res;
  }
  async upload(buffer, filename, mime) {
    return this.request('POST', '/api/uploads', undefined, {
      raw: buffer,
      headers: {
        'Content-Type': mime,
        'X-File-Name': encodeURIComponent(filename),
        'X-CSRF-Token': this.csrf,
      },
    });
  }
}

const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'
);

/* ------------------------------ Serveur ------------------------------ */
async function waitReady(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function startServer() {
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'development',
      PGLITE_DATA_DIR: DB_DIR,
      SESSION_SECRET: 'test-secret-1234567890-abcdefghij',
      TRUST_PROXY: '0',
      STORAGE_DRIVER: process.env.TEST_STORAGE_DRIVER || 'local',
      STORAGE_DIR: path.join(DB_DIR, 'storage'),
      ADMIN_PHONE: CHEF_PHONE,
      ADMIN_PASSWORD: CHEF_PASSWORD,
      ADMIN_NAME: 'Chef de test',
      REQUIRE_APPROVAL: '1',
      REGISTRATION_OPEN: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => process.env.TEST_VERBOSE && process.stdout.write(`[srv] ${d}`));
  server.stderr.on('data', (d) => process.stdout.write(`[srv:err] ${d}`));
  const ready = await waitReady();
  if (!ready) throw new Error('Le serveur de test ne démarre pas.');
}

async function stopServer() {
  if (!server) return;
  server.kill('SIGTERM');
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { server.kill('SIGKILL'); } catch {}
      resolve();
    }, 8000);
    server.on('exit', () => { clearTimeout(timer); resolve(); });
  });
  server = null;
}

/* ------------------------------ Scénarios ------------------------------ */
async function main() {
  fs.rmSync(DB_DIR, { recursive: true, force: true });
  console.log(`\nBase de test : ${DB_DIR}\n`);
  await startServer();
  console.log('▶ Démarrage et initialisation');
  const anon = new Client('anon');
  const health = await anon.get('/healthz');
  ok(health.status === 200 && health.data.status === 'ok', 'Healthcheck répond ok');
  const meAnon = await anon.get('/api/auth/me');
  ok(meAnon.data.user === null && meAnon.data.settings.app_name.includes('Département de Communication'), 'Paramètres publics accessibles sans connexion');
  ok(meAnon.data.settings.require_approval === true, 'Validation administrative des inscriptions activée par défaut');

  const chef = new Client('chef');
  let res = await chef.login(CHEF_PHONE, '000000');
  ok(res.status === 401, 'Mauvais mot de passe refusé');
  res = await chef.login(CHEF_PHONE, CHEF_PASSWORD);
  ok(res.status === 200 && res.data.user.role_slug === 'chef', 'Connexion du chef de département');
  ok(res.data.user.permissions.includes('*'), 'Le chef possède la permission globale');

  const me = await chef.get('/api/auth/me');
  ok(me.data.csrf_token && me.data.csrf_token.length > 10, 'Jeton CSRF délivré après connexion');

  console.log('\n▶ Protection CSRF et permissions');
  chef.csrf = null;
  res = await chef.post('/api/admin/levels', { name: 'Test CSRF' });
  ok(res.status === 403 && res.data.code === 'csrf', 'Mutation sans jeton CSRF refusée');
  chef.csrf = me.data.csrf_token;

  const anonWrite = await anon.post('/api/admin/levels', { name: 'Anonyme' }, { csrf: false });
  ok(anonWrite.status === 401, 'Mutation anonyme refusée');

  console.log('\n▶ Structure académique');
  res = await chef.post('/api/admin/levels', { name: 'Licence 1 (test)', code: 'L1', order_index: 1 });
  ok(res.status === 201, 'Création d’un niveau');
  const level1 = res.data.level.id;
  res = await chef.post('/api/admin/levels', { name: 'Licence 2 (test)', code: 'L2', order_index: 2 });
  const level2 = res.data.level.id;
  res = await chef.post('/api/admin/parcours', { name: 'Parcours Communication (test)', code: 'PC', level_ids: [level1, level2] });
  ok(res.status === 201, 'Création d’un parcours avec niveaux associés');
  const parcours1 = res.data.parcours.id;
  res = await chef.post('/api/admin/parcours', { name: 'Sous-parcours (test)', parent_id: parcours1, level_ids: [level1] });
  ok(res.status === 201 && res.data.parcours.parent_id === parcours1, 'Création d’un sous-parcours');
  const parcours2 = res.data.parcours.id;
  res = await chef.post('/api/admin/groups', { name: 'Groupe A (test)', level_id: level1, parcours_id: parcours1, academic_year: '2026-2027' });
  ok(res.status === 201, 'Création d’un groupe');
  const group1 = res.data.group.id;
  const structure = await chef.get('/api/structure');
  ok(structure.data.levels.length === 2 && structure.data.parcours.length === 2, 'Structure publique renvoyée');

  console.log('\n▶ Comptes et rôles');
  res = await chef.post('/api/admin/users', {
    full_name: 'Enseignant Test', phone: '+2250700000002', role_id: 5, password: '111111',
    level_id: level1, parcours_id: parcours1, scopes: [{ type: 'level', id: level1 }],
  });
  ok(res.status === 201, 'Création d’un compte enseignant avec périmètre');
  const teacherId = res.data.id;
  res = await chef.post('/api/admin/users', {
    full_name: 'Étudiant Test', phone: '+2250700000003', role_id: 6, password: '222222',
    level_id: level1, parcours_id: parcours1, group_name: 'Groupe A (test)',
  });
  ok(res.status === 201, 'Création d’un compte étudiant');
  const studentId = res.data.id;
  res = await chef.post('/api/admin/users', {
    full_name: 'Étudiant Licence 2', phone: '+2250700000004', role_id: 6, password: '333333',
    level_id: level2, parcours_id: parcours1,
  });
  ok(res.status === 201, 'Création d’un étudiant d’un autre niveau');
  const student2Id = res.data.id;

  const teacher = new Client('teacher');
  await teacher.login('+2250700000002', '111111');
  const student = new Client('student');
  await student.login('+2250700000003', '222222');
  const student2 = new Client('student2');
  await student2.login('+2250700000004', '333333');

  res = await student.get('/api/admin/users');
  ok(res.status === 403, 'Étudiant refusé sur la gestion des comptes');
  res = await student.post('/api/publications', { title: 'Test interdit', body: 'x', audiences: [{ kind: 'all' }] });
  ok(res.status === 403, 'Étudiant ne peut pas publier');
  res = await teacher.post('/api/publications', { title: 'Trop large', body: 'x', audiences: [{ kind: 'all' }] });
  ok(res.status === 403, 'Enseignant ne peut pas cibler tous les utilisateurs');
  res = await teacher.post('/api/publications', { title: 'Bonjour', body: 'x', audiences: [{ kind: 'level', target_id: level2 }] });
  ok(res.status === 403, 'Enseignant ne peut pas publier hors de son périmètre');

  console.log('\n▶ Publications, audiences et notifications');
  res = await chef.post('/api/publications', {
    title: 'Annonce de test licence 1', body: 'Contenu officiel de test.', category_id: 1, priority: 'haute',
    status: 'published', audiences: [{ kind: 'level', target_id: level1 }],
  });
  ok(res.status === 201 && res.data.notified === 1, 'Publication vers un niveau : 1 notification créée');
  const pubLevel1 = res.data.id;
  const notifStudent = await student.get('/api/notifications/count');
  ok(notifStudent.data.unread === 1, 'Étudiant du niveau reçoit la notification');
  const notifStudent2 = await student2.get('/api/notifications/count');
  ok(notifStudent2.data.unread === 0, 'Étudiant d’un autre niveau n’est pas notifié');
  const feedStudent = await student.get('/api/publications');
  ok(feedStudent.data.publications.some((p) => p.id === pubLevel1), 'La publication apparaît dans le fil de l’étudiant');
  const feedStudent2 = await student2.get('/api/publications');
  ok(!feedStudent2.data.publications.some((p) => p.id === pubLevel1), 'La publication est invisible pour l’autre niveau');
  const detail = await student.get(`/api/publications/${pubLevel1}`);
  ok(detail.status === 200 && detail.data.publication.title.includes('licence 1'), 'Détail accessible au destinataire');
  const view = await student.post(`/api/publications/${pubLevel1}/view`, {});
  ok(view.status === 200 && view.data.views === 1, 'Consultation enregistrée');
  const notifsAfter = await student.get('/api/notifications');
  ok(notifsAfter.data.notifications[0].opened_at !== null && notifsAfter.data.notifications[0].read_at !== null, 'L’ouverture marque la notification ouverte et lue');
  const viewers = await chef.get(`/api/publications/${pubLevel1}/viewers`);
  ok(viewers.status === 200 && viewers.data.viewers.some((v) => v.full_name === 'Étudiant Test'), 'Le chef consulte la liste nominative des lecteurs');
  const viewersStudent = await student.get(`/api/publications/${pubLevel1}/viewers`);
  ok(viewersStudent.status === 403, 'Un étudiant ne voit pas la liste nominative');

  res = await chef.put(`/api/publications/${pubLevel1}`, { title: 'Annonce de test licence 1 (modifiée)' });
  ok(res.status === 200, 'Modification d’une publication publiée');
  res = await chef.get('/api/notifications/count');
  ok(res.data.unread === 0, 'Une modification ordinaire ne crée pas de doublon de notification');

  res = await student.post('/api/publications', { title: 'Hors droits', body: 'x', audiences: [{ kind: 'level', target_id: level2 }] });
  ok(res.status === 403, 'Étudiant ne peut pas publier');

  const feedChef = await chef.get('/api/publications?scope=manage');
  ok(feedChef.data.publications.length >= 1, 'Le chef retrouve ses publications dans l’espace de gestion');

  res = await chef.post('/api/publications', {
    title: 'Annonce programmée (test)', body: 'Programmée.', status: 'scheduled',
    publish_at: new Date(Date.now() + 3600 * 1000).toISOString(), audiences: [{ kind: 'all' }],
  });
  ok(res.status === 201, 'Création d’une publication programmée');
  const pubScheduled = res.data.id;
  res = await chef.post(`/api/publications/${pubScheduled}/publish`, {});
  ok(res.status === 200, 'Publication manuelle d’une publication programmée');

  console.log('\n▶ Documents et contrôle d’accès aux fichiers');
  let up = await chef.upload(PDF, 'note-test.pdf', 'application/pdf');
  ok(up.status === 201 && up.data.file.mime === 'application/pdf', 'Téléversement PDF accepté');
  const fileNote = up.data.file.id;
  up = await chef.upload(Buffer.from('MZ executables'), 'virus.exe', 'application/x-msdownload');
  ok(up.status === 400, 'Type de fichier interdit refusé');

  res = await chef.post('/api/documents', {
    title: 'Note administrative (test)', description: 'Document de test', category: 'Note administrative',
    visibility: 'level', level_id: level1, file_id: fileNote,
  });
  ok(res.status === 201, 'Document rattaché à un niveau');
  const docLevel1 = res.data.id;
  const docsStudent = await student.get('/api/documents');
  ok(docsStudent.data.documents.some((d) => d.id === docLevel1), 'Étudiant du niveau voit le document');
  const docsStudent2 = await student2.get('/api/documents');
  ok(!docsStudent2.data.documents.some((d) => d.id === docLevel1), 'Document invisible hors du niveau');

  up = await chef.upload(PDF, 'confidentiel.pdf', 'application/pdf');
  const fileSecret = up.data.file.id;
  res = await chef.post('/api/documents', {
    title: 'Note personnel (test)', visibility: 'personnel', file_id: fileSecret,
  });
  ok(res.status === 201, 'Document réservé au personnel');
  let download = await student.get(`/api/files/${fileSecret}`);
  ok(download.status === 404, 'Étudiant ne peut pas télécharger un document du personnel');
  download = await chef.get(`/api/files/${fileSecret}`);
  ok(download.status === 200, 'Le chef télécharge le fichier');
  download = await anon.get(`/api/files/${fileSecret}`);
  ok(download.status === 404, 'Un visiteur anonyme ne peut pas accéder au fichier');

  up = await teacher.upload(PDF, 'cours.pdf', 'application/pdf');
  res = await teacher.post('/api/documents', {
    title: 'Support de cours (test)', visibility: 'level', level_id: level1, file_id: up.data.file.id,
  });
  ok(res.status === 201, 'Enseignant dépose un support sur son niveau');
  up = await teacher.upload(PDF, 'hors-scope.pdf', 'application/pdf');
  res = await teacher.post('/api/documents', {
    title: 'Hors périmètre', visibility: 'level', level_id: level2, file_id: up.data.file.id,
  });
  ok(res.status === 403, 'Enseignant ne peut pas déposer hors de son périmètre');

  console.log('\n▶ Résultats protégés');
  up = await chef.upload(PDF, 'resultats-l1.pdf', 'application/pdf');
  const fileResults = up.data.file.id;
  res = await chef.post('/api/results', { title: 'Résultats test L1', level_id: level1, session: 'Session normale', period: 'Semestre 1', file_id: fileResults });
  ok(res.status === 201, 'Dépôt de résultats en brouillon');
  const resultId = res.data.id;
  res = await student.get('/api/results');
  ok(!res.data.results.some((r) => r.id === resultId), 'Les résultats en brouillon ne sont pas visibles');
  download = await student.get(`/api/files/${fileResults}`);
  ok(download.status === 404, 'Le fichier de résultats en brouillon est inaccessible');
  res = await chef.post(`/api/results/${resultId}/publish`, {});
  ok(res.status === 200, 'Publication des résultats');
  res = await student.get('/api/results');
  ok(res.data.results.some((r) => r.id === resultId), 'Étudiant du niveau voit les résultats publiés');
  res = await student2.get('/api/results');
  ok(!res.data.results.some((r) => r.id === resultId), 'Autre niveau : résultats invisibles');
  res = await student.post(`/api/results/${resultId}/view`, {});
  ok(res.status === 200, 'Consultation de résultat enregistrée');
  res = await chef.get(`/api/results/${resultId}/viewers`);
  ok(res.data.viewers.length === 1, 'Suivi nominatif des consultations réservé aux habilités');
  res = await student.get(`/api/results/${resultId}/viewers`);
  ok(res.status === 403, 'Étudiant refusé sur le suivi nominatif');
  res = await chef.post(`/api/results/${resultId}/withdraw`, { reason: 'Test de retrait' });
  ok(res.status === 200, 'Retrait des résultats');
  res = await student.get('/api/results');
  ok(!res.data.results.some((r) => r.id === resultId), 'Résultats retirés invisibles');

  console.log('\n▶ Emplois du temps et calendrier');
  res = await chef.post('/api/timetables', { title: 'Emploi du temps test', level_id: level1, parcours_id: parcours1, semester: 'Semestre 1', notify: true });
  ok(res.status === 201, 'Publication d’un emploi du temps avec notification');
  res = await student.get('/api/timetables');
  ok(res.data.timetables.some((t) => t.title === 'Emploi du temps test'), 'L’étudiant voit son emploi du temps');
  res = await student2.get('/api/timetables');
  ok(!res.data.timetables.some((t) => t.title === 'Emploi du temps test'), 'L’autre niveau ne voit pas cet emploi du temps');
  res = await chef.post('/api/events', {
    title: 'Soutenance test', type: 'soutenance', starts_at: new Date(Date.now() + 86400000).toISOString(),
    location: 'Amphi test', level_id: level1, audience: 'all',
  });
  ok(res.status === 201, 'Événement de calendrier créé');
  res = await student.get('/api/events');
  ok(res.data.events.some((e) => e.title === 'Soutenance test'), 'Événement visible du niveau concerné');
  res = await student2.get('/api/events');
  ok(!res.data.events.some((e) => e.title === 'Soutenance test'), 'Événement invisible hors niveau');

  console.log('\n▶ Périmètre des responsables');
  const rolesLite = await chef.get('/api/roles-lite');
  const respRole = rolesLite.data.roles.find((r) => r.slug === 'responsable_niveau');
  ok(Boolean(respRole), 'Rôle Responsable de niveau disponible');
  res = await chef.post('/api/admin/users', {
    full_name: 'Responsable Niveau Test', phone: '+2250700000007', role_id: respRole.id, password: '888888',
    level_id: level1, parcours_id: parcours1, scopes: [{ type: 'level', id: level1 }],
  });
  ok(res.status === 201, 'Création d’un responsable limité au niveau 1');
  const respId = res.data.id;
  const resp = new Client('responsable');
  await resp.login('+2250700000007', '888888');
  res = await resp.post('/api/timetables', { title: 'EDT périmètre (test)', level_id: level1 });
  ok(res.status === 201, 'Le responsable publie un emploi du temps dans son niveau');
  res = await resp.post('/api/timetables', { title: 'EDT hors périmètre', level_id: level2 });
  ok(res.status === 403, 'Emploi du temps hors périmètre refusé');
  res = await resp.post('/api/events', { title: 'Événement hors périmètre', type: 'examen', starts_at: new Date(Date.now() + 172800000).toISOString(), level_id: level2 });
  ok(res.status === 403, 'Événement hors périmètre refusé');
  res = await resp.post('/api/events', { title: 'Événement départemental', type: 'examen', starts_at: new Date(Date.now() + 172800000).toISOString() });
  ok(res.status === 403, 'Événement sans cible refusé à un responsable');
  res = await resp.post('/api/events', { title: 'Événement du niveau 1', type: 'examen', starts_at: new Date(Date.now() + 172800000).toISOString(), level_id: level1 });
  ok(res.status === 201, 'Événement dans le périmètre accepté');
  up = await resp.upload(PDF, 'support-perimetre.pdf', 'application/pdf');
  res = await resp.post('/api/documents', { title: 'Support tous publics', visibility: 'all', file_id: up.data.file.id });
  ok(res.status === 403, 'Un responsable ne peut pas publier un document pour tout le département');
  res = await resp.post('/api/documents', { title: 'Support du niveau 1', visibility: 'level', level_id: level1, file_id: up.data.file.id });
  ok(res.status === 201, 'Un responsable dépose un document pour son niveau');
  res = await resp.get('/api/admin/users');
  ok(res.status === 403, 'Un responsable n’accède pas à la gestion des comptes');

  console.log('\n▶ Demandes administratives');
  res = await student.post('/api/requests', { subject: 'Demande de relevé (test)', category: 'Demande de document', message: 'Merci de me transmettre mon relevé.' });
  ok(res.status === 201 && /^DEM-/.test(res.data.reference), 'Demande créée avec référence');
  const requestId = res.data.id;
  const requestRef = res.data.reference;
  res = await student.get('/api/requests');
  ok(res.data.requests.length === 1, 'L’étudiant voit ses demandes');
  res = await student.get(`/api/requests/${requestId}`);
  ok(res.status === 200 && res.data.history.length >= 1, 'Historique de la demande présent');
  res = await student2.get(`/api/requests/${requestId}`);
  ok(res.status === 404, 'Un autre étudiant ne voit pas la demande');
  res = await chef.get('/api/requests');
  ok(res.data.requests.some((r) => r.reference === requestRef), 'Le chef voit la demande');
  res = await chef.put(`/api/requests/${requestId}`, { status: 'en_cours', assigned_to: teacherId, comment: 'Prise en charge' });
  ok(res.status === 200, 'Affectation et mise à jour de la demande');
  res = await chef.put(`/api/requests/${requestId}`, { status: 'traitee', response: 'Votre relevé est disponible au secrétariat.' });
  ok(res.status === 200, 'Demande traitée avec réponse');
  res = await student.get(`/api/requests/${requestId}`);
  ok(res.data.request.status === 'traitee' && res.data.history.length >= 2, 'Statut traité et historique à jour');
  res = await student.get('/api/notifications');
  ok(res.data.notifications.some((n) => n.type === 'request'), 'L’étudiant reçoit une notification de traitement');

  console.log('\n▶ Messagerie');
  res = await student.post('/api/messages/threads', { recipient_id: teacherId, subject: 'Question sur le cours', body: 'Bonjour, une question sur le TD.' });
  ok(res.status === 201, 'L’étudiant envoie un message à un enseignant');
  const threadId = res.data.id;
  res = await student.post('/api/messages/threads', { recipient_id: student2Id, subject: 'Test', body: 'Message interdit' });
  ok(res.status === 403, 'Un étudiant ne peut pas écrire à un autre étudiant');
  res = await teacher.get(`/api/messages/threads/${threadId}`);
  ok(res.status === 200 && res.data.messages.length === 1, 'L’enseignant lit le message');
  res = await teacher.post(`/api/messages/threads/${threadId}/messages`, { body: 'Réponse de test.' });
  ok(res.status === 201, 'L’enseignant répond');
  res = await student.get(`/api/messages/threads/${threadId}`);
  ok(res.data.messages.length === 2, 'L’étudiant voit la réponse');
  res = await student2.get(`/api/messages/threads/${threadId}`);
  ok(res.status === 404, 'Un tiers ne voit pas la conversation');

  console.log('\n▶ Inscription, validation et sécurité');
  const candidate = new Client('candidate');
  res = await candidate.post('/api/auth/register', {
    full_name: 'Candidat Test', phone: '+2250700000009', password: '444444', password_confirm: '444444',
    profile: 'etudiant', level_id: level1, parcours_id: parcours1,
  }, { csrf: false });
  ok(res.status === 201 && res.data.status === 'pending', 'Inscription créée en attente de validation');
  res = await candidate.login('+2250700000009', '444444');
  ok(res.status === 403 && res.data.code === 'account_pending', 'Connexion refusée tant que le compte est en attente');
  res = await candidate.post('/api/auth/login', { phone: '+2250700000009', password: '444444' }, { csrf: false });
  ok(res.status === 403, 'Compte en attente bloqué');
  const pendingUsers = await chef.get('/api/admin/users?status=pending');
  const candidateRow = pendingUsers.data.users.find((u) => u.phone === '+2250700000009');
  ok(Boolean(candidateRow), 'Le chef voit la demande en attente');
  res = await chef.post(`/api/admin/users/${candidateRow.id}/approve`, {});
  ok(res.status === 200, 'Approbation du compte');
  res = await candidate.login('+2250700000009', '444444');
  ok(res.status === 200, 'Le compte approuvé peut se connecter');
  res = await chef.post(`/api/admin/users/${candidateRow.id}/status`, { status: 'suspended' });
  ok(res.status === 200, 'Suspension du compte');
  res = await candidate.get('/api/auth/me');
  ok(res.status === 401 || (res.status === 200 && res.data.user === null), 'Session suspendue immédiatement fermée');
  res = await candidate.post('/api/auth/login', { phone: '+2250700000009', password: '444444' }, { csrf: false });
  ok(res.status === 403 && res.data.code === 'account_suspended', 'Connexion refusée pour un compte suspendu');
  res = await chef.get(`/api/admin/users/${candidateRow.id}/reset-link`, {});
  res = await chef.post(`/api/admin/users/${candidateRow.id}/reset-link`, {});
  ok(res.status === 200 && res.data.url.includes('/reinitialisation/'), 'Lien de réinitialisation généré');
  const resetToken = res.data.url.split('/reinitialisation/')[1];
  res = await anon.get(`/api/auth/reset/${resetToken}`);
  ok(res.status === 200, 'Lien de réinitialisation valide');
  res = await anon.post(`/api/auth/reset/${resetToken}`, { password: '555555', password_confirm: '555555' }, { csrf: false });
  ok(res.status === 200, 'Mot de passe réinitialisé');
  res = await anon.post(`/api/auth/reset/${resetToken}`, { password: '666666', password_confirm: '666666' }, { csrf: false });
  ok(res.status === 400, 'Lien de réinitialisation à usage unique');
  res = await chef.post(`/api/admin/users/${candidateRow.id}/status`, { status: 'active' });
  const candidate2 = new Client('candidate2');
  res = await candidate2.login('+2250700000009', '555555');
  ok(res.status === 200, 'Connexion avec le nouveau mot de passe');

  console.log('\n▶ Rôles personnalisés et permissions dynamiques');
  res = await chef.post('/api/admin/roles', { name: 'Délégué test', description: 'Rôle de test', permissions: ['publications.create', 'stats.personal'] });
  ok(res.status === 201, 'Création d’un rôle personnalisé');
  const roleDelegate = res.data.role.id;
  res = await chef.post('/api/admin/users', { full_name: 'Délégué Test', phone: '+2250700000010', role_id: roleDelegate, password: '777777', level_id: level1 });
  ok(res.status === 201, 'Création d’un compte avec le rôle personnalisé');
  const delegate = new Client('delegate');
  await delegate.login('+2250700000010', '777777');
  res = await delegate.get('/api/admin/users');
  ok(res.status === 403, 'Le rôle personnalisé n’hérite pas des droits d’administration');
  res = await chef.put(`/api/admin/roles/${roleDelegate}`, { permissions: [] });
  ok(res.status === 200, 'Retrait des permissions du rôle');
  res = await delegate.post('/api/publications', { title: 'Après retrait', body: 'x', audiences: [{ kind: 'level', target_id: level1 }] });
  ok(res.status === 403, 'Le retrait de permission s’applique immédiatement');
  res = await chef.put('/api/admin/roles/1', { permissions: [] });
  ok(res.status === 403, 'Le rôle de chef ne peut pas perdre ses permissions');
  res = await chef.del(`/api/admin/roles/${roleDelegate}`);
  ok(res.status === 409, 'Un rôle attribué ne peut pas être supprimé');

  console.log('\n▶ Paramètres et statistiques');
  res = await chef.put('/api/admin/settings', { presentation: 'Présentation officielle de test.', contact_email: 'contact@test.ci', academic_year: '2026-2027' });
  ok(res.status === 200, 'Enregistrement des paramètres');
  const me2 = await anon.get('/api/auth/me');
  ok(me2.data.settings.presentation === 'Présentation officielle de test.', 'Les paramètres sont immédiatement publics');
  const stats = await chef.get('/api/stats/overview');
  ok(stats.status === 200, 'Statistiques accessibles au chef');
  ok(stats.data.byStatus.active >= 5, 'Nombre de comptes actifs réel');
  ok(stats.data.publications.published >= 2, 'Nombre de publications réelles');
  ok(stats.data.views.total >= 1, 'Consultations réelles comptabilisées');
  ok(stats.data.requests.traitee >= 1, 'Demandes traitées comptabilisées');
  res = await student.get('/api/stats/overview');
  ok(res.status === 403, 'Étudiant refusé sur les statistiques globales');
  const audit = await chef.get('/api/admin/audit');
  ok(audit.status === 200 && audit.data.logs.some((l) => l.action === 'user.approve'), 'Journal d’activité alimenté');

  console.log('\n▶ Publication publique et landing');
  res = await chef.post('/api/publications', {
    title: 'Annonce publique de test', body: 'Visible sans connexion.', status: 'published',
    audiences: [{ kind: 'public' }],
  });
  ok(res.status === 201, 'Publication publique créée');
  const publicPubId = res.data.id;
  res = await anon.get('/api/public/announcements');
  ok(res.data.announcements.some((a) => a.id === publicPubId), 'Annonce publique visible sans connexion');
  res = await anon.get(`/api/public/announcements/${publicPubId}`);
  ok(res.status === 200, 'Détail public accessible');
  res = await anon.get(`/api/publications/${pubLevel1}`);
  ok(res.status === 401, 'Publication interne non accessible sans connexion');

  console.log('\n▶ Archivage et intégrité de la structure');
  res = await chef.del(`/api/admin/levels/${level1}`);
  ok(res.status === 200 && res.data.archived === true, 'Un niveau utilisé est archivé, pas supprimé');
  const levelsAfter = await chef.get('/api/structure');
  ok(!levelsAfter.data.levels.some((l) => l.id === level1), 'Le niveau archivé disparaît des listes publiques');
  res = await chef.get('/api/admin/users?level=' + level1);
  ok(res.data.users.length >= 3, 'Les comptes rattachés restent consultables (historique conservé)');
  res = await chef.put(`/api/admin/levels/${level1}`, { active: true });
  ok(res.status === 200 && res.data.level.active === true, 'Le niveau peut être réactivé');

  console.log('\n▶ Persistance après redémarrage');
  await stopServer();
  await startServer();
  const chef2 = new Client('chef2');
  res = await chef2.login(CHEF_PHONE, CHEF_PASSWORD);
  ok(res.status === 200, 'Le compte chef existe toujours après redémarrage');
  res = await chef2.get('/api/publications?scope=manage');
  ok(res.data.publications.some((p) => p.title.includes('licence 1')), 'Les publications persistent après redémarrage');
  const settingsAfter = await chef2.get('/api/admin/settings');
  ok(settingsAfter.data.settings.presentation === 'Présentation officielle de test.', 'Les paramètres persistent');
  const docsAfter = await chef2.get('/api/documents');
  ok(docsAfter.data.documents.some((d) => d.title === 'Note administrative (test)'), 'Les documents persistent');

  console.log('\n▶ Catégories, rubriques et contenus publics');
  res = await chef.post('/api/admin/categories', { name: 'Catégorie de test', color: '#123456' });
  ok(res.status === 201 && res.data.category.slug === 'categorie-de-test', 'Création d’une catégorie de publication');
  const categoryId = res.data.category.id;
  res = await chef.post('/api/publications', {
    title: 'Publication avec catégorie de test', body: 'Contenu.', status: 'published',
    category_id: categoryId, audiences: [{ kind: 'level', target_id: level1 }],
  });
  ok(res.status === 201, 'Publication classée dans la nouvelle catégorie');
  res = await chef.del(`/api/admin/categories/${categoryId}`);
  ok(res.status === 200 && res.data.archived === true, 'Une catégorie utilisée est archivée et non supprimée');
  const catsPublic = await chef.get('/api/categories');
  ok(!catsPublic.data.categories.some((c) => c.id === categoryId), 'La catégorie archivée disparaît des filtres');

  up = await chef.upload(PDF, 'calendrier-public.pdf', 'application/pdf');
  res = await chef.post('/api/documents', { title: 'Calendrier public de test', category: 'Calendrier', visibility: 'public', file_id: up.data.file.id });
  ok(res.status === 201, 'Document public déposé par la direction');
  const publicDocId = res.data.id;
  const publicDocsAnon = await anon.get('/api/public/documents');
  ok(publicDocsAnon.data.documents.some((d) => d.title === 'Calendrier public de test'), 'Document public visible sans connexion');
  const publicDocFile = publicDocsAnon.data.documents.find((d) => d.title === 'Calendrier public de test');
  download = await anon.get(`/api/files/${publicDocFile.file_id}`);
  ok(download.status === 200, 'Téléchargement public autorisé pour un document public');
  res = await chef.post('/api/documents', { title: 'Document interne de test', visibility: 'all', file_id: up.data.file.id });
  const internalDocId = res.data.id;
  const anonInternal = await anon.get('/api/public/documents');
  ok(!anonInternal.data.documents.some((d) => d.id === internalDocId), 'Un document interne n’apparaît pas sur la page publique');

  res = await chef.post('/api/events', {
    title: 'Conférence publique de test', type: 'conference', audience: 'public',
    starts_at: new Date(Date.now() + 3 * 86400000).toISOString(), location: 'Amphi public',
  });
  ok(res.status === 201, 'Événement public créé');
  const publicEvents = await anon.get('/api/public/events');
  ok(publicEvents.data.events.some((e) => e.title === 'Conférence publique de test'), 'Événement public visible sans connexion');

  res = await chef.post('/api/activities', { title: 'Atelier de test', category: 'atelier', description: 'Atelier fictif de vérification.' });
  ok(res.status === 201, 'Activité créée');
  const activityId = res.data.id;
  res = await student.get('/api/activities');
  ok(res.data.activities.some((a) => a.id === activityId), 'Activité visible par les utilisateurs');
  const publicActivities = await anon.get('/api/public/activities');
  ok(publicActivities.data.activities.some((a) => a.id === activityId), 'Activité visible sur la page publique');
  res = await chef.put(`/api/activities/${activityId}`, { title: 'Atelier de test (mis à jour)' });
  ok(res.status === 200, 'Activité modifiable');
  res = await student.post('/api/activities', { title: 'Activité interdite', category: 'autre' });
  ok(res.status === 403, 'Étudiant ne peut pas créer d’activité');

  res = await chef.put('/api/admin/settings', { activity_categories: { atelier: false } });
  ok(res.status === 200, 'Désactivation d’une rubrique de la vie du département');
  res = await student.get('/api/activities');
  ok(!res.data.activities.some((a) => a.id === activityId), 'L’activité de la rubrique désactivée est masquée');
  res = await chef.get('/api/activities');
  ok(res.data.activities.some((a) => a.id === activityId), 'Le gestionnaire conserve l’accès aux données masquées');
  const anonFiltered = await anon.get('/api/public/activities');
  ok(!anonFiltered.data.activities.some((a) => a.id === activityId), 'La rubrique désactivée disparaît de la page publique');
  res = await chef.put('/api/admin/settings', { activity_categories: { atelier: true } });
  ok(res.status === 200, 'Réactivation de la rubrique');

  res = await chef.put('/api/admin/settings', {
    notification_types: { publication: false, result: true, timetable: true, request: true, message: true },
  });
  ok(res.status === 200, 'Désactivation du type de notification « publication »');
  const beforeDisabled = await student.get('/api/notifications/count');
  res = await chef.post('/api/publications', {
    title: 'Publication sans notification de test', body: 'Contenu.', status: 'published',
    audiences: [{ kind: 'level', target_id: level1 }],
  });
  ok(res.status === 201 && res.data.notified === 0, 'Aucune notification créée lorsque le type est désactivé');
  const afterDisabled = await student.get('/api/notifications/count');
  ok(afterDisabled.data.total === beforeDisabled.data.total, 'Aucune notification ajoutée au total');
  await chef.put('/api/admin/settings', {
    notification_types: { publication: true, result: true, timetable: true, request: true, message: true },
  });
  res = await chef.post('/api/publications', {
    title: 'Publication avec notification rétablie', body: 'Contenu.', status: 'published',
    audiences: [{ kind: 'level', target_id: level1 }],
  });
  ok(res.status === 201 && res.data.notified >= 1, 'Les notifications reprennent après réactivation');

  res = await chef.put('/api/admin/settings', { data_retention_days: 30 });
  ok(res.status === 200, 'Durée de conservation enregistrée');
  const settingsRetention = await chef.get('/api/admin/settings');
  ok(settingsRetention.data.settings.data_retention_days === '30', 'Durée de conservation relue depuis la base');
  await chef.put('/api/admin/settings', { data_retention_days: 0 });

  res = await chef.get('/api/public/categories').catch(() => ({ status: 404 }));
  const catsAfter = await student.get('/api/categories');
  ok(catsAfter.status === 200 && catsAfter.data.categories.length >= 7, 'Catégories actives disponibles pour les formulaires');

  console.log('\n▶ Préférences, santé et sauvegarde');
  res = await student.put('/api/profile/preferences', { sound_pref: 'doux', text_scale: 1.15 });
  ok(res.status === 200, 'Enregistrement des préférences de notification et d’affichage');
  const mePrefs = await student.get('/api/auth/me');
  ok(mePrefs.data.user.sound_pref === 'doux' && Number(mePrefs.data.user.text_scale) === 1.15, 'Préférences conservées côté serveur');
  res = await student.put('/api/profile/preferences', { sound_pref: 'invalide' });
  ok(res.status === 400, 'Son de notification invalide refusé');
  res = await student.put('/api/profile/preferences', { text_scale: 9 });
  ok(res.status === 400, 'Taille de texte hors limites refusée');
  res = await student.post('/api/notifications/read-all', {});
  ok(res.status === 200, 'Marquage de toutes les notifications comme lues');
  const unreadAfter = await student.get('/api/notifications/count');
  ok(unreadAfter.data.unread === 0, 'Compteur de non-lues remis à zéro');
  res = await chef.get('/api/admin/pending-count');
  ok(res.status === 200 && Number.isInteger(res.data.pending), 'Compteur de comptes en attente');
  res = await chef.get('/api/admin/health');
  ok(res.status === 200 && res.data.status === 'ok' && res.data.counts.users >= 6, 'Diagnostic technique chiffré (comptes, base, stockage)');
  res = await chef.get('/api/admin/backup');
  ok(res.status === 200 && res.data.tables && Array.isArray(res.data.tables.users), 'Sauvegarde JSON des tables disponible');
  ok(!JSON.stringify(res.data.tables.users[0] || {}).includes('pbkdf2'), 'La sauvegarde chef ne contient pas les empreintes de mots de passe');
  res = await student.get('/api/admin/backup');
  ok(res.status === 403, 'Sauvegarde interdite aux étudiants');

  console.log('\n▶ Protection contre les abus');
  const attacker = new Client('attacker');
  let lastStatus = 0;
  for (let i = 0; i < 24; i += 1) {
    const r = await attacker.post('/api/auth/login', { phone: '+2250700000002', password: '999999' }, { csrf: false });
    lastStatus = r.status;
  }
  ok([400, 403, 429].includes(lastStatus), 'Tentatives de connexion répétées limitées ou compte verrouillé');
  const locked = await teacher.login('+2250700000002', '111111');
  ok(
    (locked.status === 403 && locked.data.code === 'locked') ||
      (locked.status === 400 && /Trop de tentatives/.test(locked.data.error || '')),
    'Connexions bloquées après échecs répétés (verrouillage ou limitation)'
  );

  console.log('\n──────────────────────────────────────────────');
  console.log(`Résultat : ${passed} réussite(s), ${failed} échec(s)`);
  if (failed) {
    console.log('Échecs :');
    for (const f of failures) console.log(` - ${f}`);
  }
  await stopServer();
  fs.rmSync(DB_DIR, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}

main().catch(async (err) => {
  console.error('\nErreur fatale du test :', err);
  await stopServer();
  process.exit(1);
});
