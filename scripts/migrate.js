#!/usr/bin/env node
/**
 * Exécute les migrations SQL non appliquées, dans l'ordre des noms de fichier.
 * Chaque migration est appliquée dans une transaction et enregistrée dans
 * schema_migrations. Les migrations sont additives et versionnées.
 */
import fs from 'node:fs';
import path from 'node:path';
import { initDb, tx, exec, query, dbMode, closeDb } from '../server/db.js';
import { ROOT, config } from '../server/config.js';

export async function runMigrations({ silent = false } = {}) {
  await initDb();
  await exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const dir = path.join(ROOT, 'migrations');
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const appliedRows = await query('SELECT version FROM schema_migrations');
  const applied = new Set(appliedRows.map((r) => r.version));
  let count = 0;
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await tx(async (t) => {
      await t.exec(sql);
      await t.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
    });
    count += 1;
    if (!silent) console.log(`✔ migration ${version} appliquée`);
  }
  if (!silent) {
    console.log(
      count === 0
        ? 'Base de données à jour (aucune migration à appliquer).'
        : `${count} migration(s) appliquée(s) — base ${dbMode()}.`
    );
  }
  return { applied: count, mode: dbMode() };
}

const isMain = process.argv[1] && process.argv[1].endsWith('migrate.js');
if (isMain) {
  runMigrations()
    .then(() => closeDb())
    .catch(async (err) => {
      console.error('Erreur de migration :', err.message);
      await closeDb();
      process.exit(1);
    });
}
