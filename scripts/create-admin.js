#!/usr/bin/env node
/**
 * Initialisation sécurisée du premier compte chef de département.
 * Aucun mot de passe n'est codé en dur.
 *
 * Usage :
 *   npm run create-admin -- --phone +2250700000000 --name "Nom du chef"
 *   (le mot de passe est demandé de façon masquée)
 *
 * Options : --password 123456 (déconseillé : visible dans l'historique)
 *           --force (réinitialise le mot de passe d'un chef existant)
 */
import readline from 'node:readline';
import { runMigrations } from './migrate.js';
import { query, one, closeDb } from '../server/db.js';
import { hashPassword } from '../server/auth.js';

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = function (string) {
        if (string.includes(question)) rl.output.write(question);
        else rl.output.write('*');
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

async function main() {
  await runMigrations({ silent: true });
  let phone = arg('phone');
  let name = arg('name');
  let password = arg('password');
  const force = process.argv.includes('--force');

  if (!phone) phone = await ask('Numéro de téléphone du chef (ex. +2250700000000) : ');
  if (!name) name = await ask('Nom complet : ');
  if (!password) password = await ask('Mot de passe (exactement 6 chiffres, saisie masquée) : ', { hidden: true });

  phone = phone.replace(/[\s.\-()]/g, '');
  if (!/^\+?\d{8,15}$/.test(phone)) {
    console.error('Numéro invalide : 8 à 15 chiffres attendus.');
    process.exit(1);
  }
  if (!/^\d{6}$/.test(password)) {
    console.error('Le mot de passe doit contenir exactement 6 chiffres.');
    process.exit(1);
  }
  if (!name || name.length < 3) {
    console.error('Nom complet invalide.');
    process.exit(1);
  }

  const chefRole = await one("SELECT id FROM roles WHERE slug = 'chef'");
  if (!chefRole) {
    console.error('Rôle chef introuvable : vérifiez les migrations.');
    process.exit(1);
  }
  const existing = await one('SELECT id, full_name FROM users WHERE phone = $1', [phone]);
  if (existing) {
    const isChef = await one('SELECT 1 FROM users WHERE id = $1 AND role_id = $2', [existing.id, chefRole.id]);
    if (!isChef || !force) {
      console.error(
        isChef
          ? 'Un compte chef existe déjà avec ce numéro. Utilisez --force pour changer son mot de passe.'
          : 'Ce numéro est déjà utilisé par un autre compte.'
      );
      process.exit(1);
    }
    await query('UPDATE users SET password_hash = $1, status = \'active\', failed_attempts = 0, locked_until = NULL WHERE id = $2', [
      hashPassword(password), existing.id,
    ]);
    await query('DELETE FROM sessions WHERE user_id = $1', [existing.id]);
    console.log(`✔ Mot de passe du chef ${existing.full_name} réinitialisé.`);
    return;
  }

  await query(
    `INSERT INTO users (phone, password_hash, full_name, role_id, status, approved_at)
     VALUES ($1,$2,$3,$4,'active',now())`,
    [phone, hashPassword(password), name, chefRole.id]
  );
  console.log('✔ Compte chef de département créé.');
  console.log(`  Téléphone : ${phone}`);
  console.log('  Mot de passe : défini à la saisie (non enregistré en clair).');
  console.log('  Connectez-vous puis modifiez-le si nécessaire dans « Mon profil ».');
}

main()
  .then(() => closeDb())
  .catch(async (err) => {
    console.error('Erreur :', err.message);
    await closeDb();
    process.exit(1);
  });
