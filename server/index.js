import { createApp } from './app.js';
import { config } from './config.js';
import { runMigrations } from '../scripts/migrate.js';
import { query, one, dbMode, closeDb } from './db.js';
import { hashPassword } from './auth.js';
import { publishDuePublications } from './services/notify.js';
import { purgeExpiredData } from './services/retention.js';
import { purgeExpiredSessions } from './auth.js';
import { getSetting, setSetting } from './settings.js';

async function bootstrapAdmin() {
  const chefRole = await one("SELECT id FROM roles WHERE slug = 'chef'");
  if (!chefRole) return;
  const existingChef = await one('SELECT id FROM users WHERE role_id = $1 LIMIT 1', [chefRole.id]);
  if (existingChef) return;
  const phone = (process.env.ADMIN_PHONE || '').replace(/[\s.\-()]/g, '');
  const password = process.env.ADMIN_PASSWORD || '';
  if (!phone || !password) {
    console.log('ℹ️  Aucun compte chef de département : lancez « npm run create-admin » (ou définissez ADMIN_PHONE et ADMIN_PASSWORD au premier démarrage).');
    return;
  }
  if (!/^\+?\d{8,15}$/.test(phone) || !/^\d{6}$/.test(password)) {
    console.warn('⚠️  ADMIN_PHONE / ADMIN_PASSWORD invalides : numéro 8–15 chiffres et mot de passe de 6 chiffres exigés. Aucun compte créé.');
    return;
  }
  const existingPhone = await one('SELECT id FROM users WHERE phone = $1', [phone]);
  if (existingPhone) {
    console.warn('⚠️  ADMIN_PHONE correspond à un compte existant : aucun nouveau chef créé.');
    return;
  }
  const name = process.env.ADMIN_NAME || 'Chef de département';
  await query(
    `INSERT INTO users (phone, password_hash, full_name, role_id, status, approved_at)
     VALUES ($1,$2,$3,$4,'active',now())`,
    [phone, hashPassword(password), name, chefRole.id]
  );
  console.log(`✔ Compte chef créé pour ${phone.slice(0, 3)}••• (mot de passe défini par variable d'environnement, non journalisé).`);
}

async function applyInitialEnvSettings() {
  const applied = await getSetting('env_applied', '');
  if (applied === '1') return;
  if (process.env.REQUIRE_APPROVAL !== undefined) {
    await setSetting('require_approval', ['1', 'true', 'yes', 'on'].includes(String(process.env.REQUIRE_APPROVAL).toLowerCase()) ? '1' : '0');
  }
  if (process.env.REGISTRATION_OPEN !== undefined) {
    await setSetting('registration_open', ['1', 'true', 'yes', 'on'].includes(String(process.env.REGISTRATION_OPEN).toLowerCase()) ? '1' : '0');
  }
  if (process.env.DEFAULT_SIGNUP_ROLE) {
    const role = await one('SELECT slug FROM roles WHERE slug = $1', [process.env.DEFAULT_SIGNUP_ROLE]);
    if (role && role.slug !== 'chef') await setSetting('default_signup_role', role.slug);
  }
  await setSetting('env_applied', '1');
}

async function main() {
  console.log('Démarrage du Département de Communication — Université de Bouaké');
  const migration = await runMigrations({ silent: true });
  console.log(`✔ Base ${migration.mode} prête (${migration.applied} migration(s) appliquée(s)).`);
  await applyInitialEnvSettings();
  await bootstrapAdmin();

  const app = createApp();
  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`✔ Serveur actif sur http://localhost:${config.port} (${config.isProd ? 'production' : 'développement'}, base ${dbMode()}).`);
  });

  const tick = async () => {
    try {
      await publishDuePublications();
    } catch (err) {
      console.error('Planificateur publications :', err.message);
    }
  };
  const scheduler = setInterval(tick, 60 * 1000);
  scheduler.unref();
  tick();

  const retentionTick = async () => {
    try {
      const out = await purgeExpiredData();
      if (out.days > 0 && (out.notifications || out.audit)) {
        console.log(
          `✔ Conservation (${out.days} j) : ${out.notifications} notification(s) lue(s) et ${out.audit} entrée(s) d'audit purgée(s).`
        );
      }
    } catch (err) {
      console.error('Purge de conservation :', err.message);
    }
  };
  const cleaner = setInterval(async () => {
    try {
      await purgeExpiredSessions();
    } catch (err) {
      console.error('Nettoyage sessions :', err.message);
    }
  }, 30 * 60 * 1000);
  cleaner.unref();

  const retention = setInterval(retentionTick, 24 * 60 * 60 * 1000);
  retention.unref();
  retentionTick();

  const shutdown = async (signal) => {
    console.log(`\n${signal} reçu : arrêt du serveur…`);
    clearInterval(scheduler);
    clearInterval(cleaner);
    server.close(async () => {
      await closeDb();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 8000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Erreur fatale au démarrage :', err.message);
  console.error('Vérifiez DATABASE_URL, SESSION_SECRET et la disponibilité de la base PostgreSQL.');
  process.exit(1);
});
