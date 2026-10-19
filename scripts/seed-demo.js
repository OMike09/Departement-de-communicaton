#!/usr/bin/env node
/**
 * DONNÉES DE DÉMONSTRATION — USAGE LOCAL UNIQUEMENT.
 * Crée une structure et des comptes clairement identifiés « démo ».
 * Refuse de s'exécuter en production. Active le bandeau « mode démonstration ».
 *
 *   npm run seed:demo -- --force
 */
import { runMigrations } from './migrate.js';
import { query, one, closeDb } from '../server/db.js';
import { hashPassword } from '../server/auth.js';
import { setSetting } from '../server/settings.js';

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ Refus : les données de démonstration ne peuvent pas être chargées en production.');
    process.exit(1);
  }
  const force = process.argv.includes('--force');
  await runMigrations({ silent: true });
  const existing = await one("SELECT COUNT(*)::int AS n FROM users WHERE phone LIKE '+225000000%'");
  if (existing.n > 0 && !force) {
    console.error('Des comptes de démonstration existent déjà. Relancez avec --force pour compléter.');
    process.exit(1);
  }
  console.log('⚠️  Chargement de DONNÉES FICTIVES de démonstration (jamais pour la production).');

  const level1 = await one("SELECT id FROM levels WHERE name = 'Niveau 1 (démo)'");
  let l1 = level1?.id;
  if (!l1) {
    l1 = (await one("INSERT INTO levels (name, code, description, order_index, source) VALUES ('Niveau 1 (démo)','L1','Niveau de démonstration',1,'administration') RETURNING id")).id;
  }
  const l2 = (await one("SELECT id FROM levels WHERE name = 'Niveau 2 (démo)'"))?.id ||
    (await one("INSERT INTO levels (name, code, description, order_index, source) VALUES ('Niveau 2 (démo)','L2','Niveau de démonstration',2,'administration') RETURNING id")).id;
  const l3 = (await one("SELECT id FROM levels WHERE name = 'Niveau 3 (démo)'"))?.id ||
    (await one("INSERT INTO levels (name, code, description, order_index, source) VALUES ('Niveau 3 (démo)','L3','Niveau de démonstration',3,'administration') RETURNING id")).id;

  const p1 = (await one("SELECT id FROM parcours WHERE name = 'Parcours démo A'"))?.id ||
    (await one("INSERT INTO parcours (name, code, description, order_index) VALUES ('Parcours démo A','DEMO-A','Parcours fictif de démonstration',1) RETURNING id")).id;
  const p2 = (await one("SELECT id FROM parcours WHERE name = 'Parcours démo B'"))?.id ||
    (await one("INSERT INTO parcours (name, code, description, order_index) VALUES ('Parcours démo B','DEMO-B','Parcours fictif de démonstration',2) RETURNING id")).id;
  for (const [pid, lid] of [[p1, l1], [p1, l2], [p2, l2], [p2, l3]]) {
    await query('INSERT INTO parcours_levels (parcours_id, level_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [pid, lid]);
  }

  const role = async (slug) => (await one('SELECT id FROM roles WHERE slug = $1', [slug])).id;
  const chefRole = await role('chef');
  const ensRole = await role('enseignant');
  const etuRole = await role('etudiant');
  const secRole = await role('secretariat');

  async function createUser(phone, name, roleId, extra = {}) {
    const existingUser = await one('SELECT id FROM users WHERE phone = $1', [phone]);
    if (existingUser) return existingUser.id;
    const row = await one(
      `INSERT INTO users (phone, password_hash, full_name, role_id, level_id, parcours_id, group_name, status, approved_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'active',now()) RETURNING id`,
      [phone, hashPassword('123456'), name, roleId, extra.level || null, extra.parcours || null, extra.group || '']
    );
    return row.id;
  }

  const chef = await createUser('+225000000001', 'Démonstration — Chef de département', chefRole);
  await createUser('+225000000002', 'Démonstration — Secrétariat', secRole);
  const ens = await createUser('+225000000003', 'Démonstration — Enseignant', ensRole);
  await createUser('+225000000004', 'Démonstration — Étudiant', etuRole, { level: l1, parcours: p1, group: 'Groupe démo 1' });
  await query('INSERT INTO user_scopes (user_id, scope_type, scope_id) VALUES ($1,\'level\',$2) ON CONFLICT DO NOTHING', [ens, l1]);

  const cat = async (slug) => (await one('SELECT id FROM categories WHERE slug = $1', [slug]))?.id || null;
  const pdf = Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n' +
    '4 0 obj<</Length 76>>stream\nBT /F1 14 Tf 30 150 Td (Document de demonstration - non officiel) Tj ET\nendstream endobj\n' +
    '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n' +
    'trailer<</Root 1 0 R>>\n%%EOF'
  );
  const { saveFile } = await import('../server/services/storage.js');
  const file = await saveFile(pdf, { filename: 'document-demonstration.pdf', mime: 'application/pdf', uploadedBy: chef });

  const pub = await one(
    `INSERT INTO publications (title, body, category_id, priority, status, published_at, created_by)
     VALUES ($1,$2,$3,'normale','published',now(),$4) RETURNING id`,
    [
      'Publication de démonstration',
      "Ceci est une publication fictive destinée uniquement à tester l'application. Elle ne constitue aucune information officielle du Département de Communication.",
      await cat('annonce-administrative'), chef,
    ]
  );
  await query("INSERT INTO publication_audiences (publication_id, kind, target_text) VALUES ($1,'all','')", [pub.id]);
  await query('INSERT INTO publication_files (publication_id, file_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [pub.id, file.id]);

  await query(
    `INSERT INTO documents (title, description, category, file_id, visibility, uploaded_by)
     VALUES ('Document de démonstration','Fichier fictif de test','Document',$1,'all',$2)`,
    [file.id, chef]
  );
  await query(
    `INSERT INTO schedule_events (title, description, type, starts_at, location, audience, created_by)
     VALUES ('Événement de démonstration','Événement fictif de test','conference', now() + interval '7 days','Amphi démo','all',$1)`,
    [chef]
  );
  await setSetting('demo_mode', '1');
  console.log('✔ Données de démonstration chargées.');
  console.log('   Comptes (mot de passe 123456) :');
  console.log('   +225000000001 chef · +225000000002 secrétariat · +225000000003 enseignant · +225000000004 étudiant');
}

main()
  .then(() => closeDb())
  .catch(async (err) => {
    console.error('Erreur :', err.message);
    await closeDb();
    process.exit(1);
  });
