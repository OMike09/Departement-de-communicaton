import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

/**
 * Couche base de données.
 * - Production / DATABASE_URL défini : PostgreSQL via le paquet `pg`.
 * - Développement sans PostgreSQL : PostgreSQL embarqué (PGlite),
 *   qui exécute le même SQL et persiste sur disque.
 * L'application ne bascule JAMAIS silencieusement en base locale
 * lorsque NODE_ENV=production.
 */

let mode = null; // 'pg' | 'pglite'
let pool = null;
let pglite = null;
let pglitePromise = null;

function assertProductionConfig() {
  if (config.isProd) {
    if (!config.databaseUrl) {
      throw new Error(
        'DATABASE_URL est obligatoire en production. ' +
          'Configurez une base PostgreSQL (ex. Render) avant de démarrer.'
      );
    }
    if (!config.sessionSecret || config.sessionSecret.length < 24) {
      throw new Error(
        "SESSION_SECRET est obligatoire en production (au moins 24 caractères, chaîne aléatoire)."
      );
    }
  }
}

async function getPglite() {
  if (!pglitePromise) {
    const dir = config.pgliteDataDir;
    fs.mkdirSync(dir, { recursive: true });
    pglitePromise = import('@electric-sql/pglite').then(({ PGlite }) => new PGlite(dir));
  }
  return pglitePromise;
}

export async function initDb() {
  assertProductionConfig();
  if (config.databaseUrl) {
    const { default: pg } = await import('pg');
    // Render expose deux URL : interne (nom d'hôte court, sans domaine) et
    // externe (…render.com). La connexion interne ne nécessite pas TLS ; la
    // connexion externe l'exige. sslmode=disable reste prioritaire.
    let host = '';
    try {
      host = new URL(config.databaseUrl).hostname;
    } catch {}
    const internalHost = /^localhost$|^127\.0\.0\.1$|^[^.]+$/.test(host);
    const ssl = config.databaseUrl.includes('sslmode=disable') || internalHost
      ? false
      : { rejectUnauthorized: false };
    pool = new pg.Pool({ connectionString: config.databaseUrl, ssl, max: 10 });
    await pool.query('SELECT 1');
    mode = 'pg';
  } else {
    if (config.isProd) {
      throw new Error('Refus de démarrer en production sans PostgreSQL.');
    }
    pglite = await getPglite();
    mode = 'pglite';
  }
  return mode;
}

export function dbMode() {
  return mode;
}

export async function query(sql, params = []) {
  if (mode === 'pg') {
    const res = await pool.query(sql, params);
    return res.rows;
  }
  if (!pglite) pglite = await getPglite();
  const res = await pglite.query(sql, params);
  return res.rows;
}

export async function one(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

export async function exec(sql) {
  if (mode === 'pg') {
    await pool.query(sql);
    return;
  }
  if (!pglite) pglite = await getPglite();
  await pglite.exec(sql);
}

/** Transaction : fn(api) avec api.query / api.one */
export async function tx(fn) {
  if (mode === 'pg') {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const api = {
        query: async (sql, params = []) => (await client.query(sql, params)).rows,
        one: async (sql, params = []) => (await client.query(sql, params)).rows[0] || null,
        exec: async (sql) => client.query(sql),
      };
      const out = await fn(api);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {}
      throw err;
    } finally {
      client.release();
    }
  }
  if (!pglite) pglite = await getPglite();
  return pglite.transaction(async (t) => {
    const api = {
      query: async (sql, params = []) => (await t.query(sql, params)).rows,
      one: async (sql, params = []) => (await t.query(sql, params)).rows[0] || null,
      exec: async (sql) => t.exec(sql),
    };
    return fn(api);
  });
}

export async function closeDb() {
  if (pool) {
    await pool.end();
    pool = null;
  }
  if (pglite) {
    try {
      await pglite.close();
    } catch {}
    pglite = null;
    pglitePromise = null;
  }
  mode = null;
}
