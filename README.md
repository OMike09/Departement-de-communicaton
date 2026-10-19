# Département de Communication — Université de Bouaké

Application web complète du **Département de Communication de l’Université de Bouaké** (Côte d’Ivoire).
Interface 100 % française, responsive (Android, iPhone, tablette, ordinateur), API REST protégée et base PostgreSQL.

> **Données institutionnelles.** Le dossier de référence fourni est un cahier technique : il ne contient
> ni filières, ni parcours, ni noms de responsables, ni coordonnées officielles du Département de
> Communication. L’application n’en invente aucun. Ces informations sont créées par le chef de
> département depuis **Administration → Structure** et **Paramètres**, et restent marquées
> « à compléter » tant qu’elles ne sont pas saisies.

---

## 1. Fonctionnalités

### Rôles et permissions (contrôlés côté serveur à chaque requête)

| Rôle | Périmètre principal |
|---|---|
| **Chef de département** | Permission globale `*` : comptes, rôles et permissions personnalisés, structure académique, publications, documents, emplois du temps, résultats, demandes, activités, statistiques, journal d’audit, paramètres, sauvegarde. |
| **Secrétariat** | Comptes (consultation, approbation, création), demandes administratives, publications, documents, emplois du temps et calendrier, activités, statistiques personnelles. |
| **Responsable de niveau / de parcours** | Limité aux **périmètres attribués** (niveaux, parcours, groupes) : publications, documents, emplois du temps et événements de son périmètre uniquement. |
| **Enseignant** | Publications et supports rattachés à son périmètre, statistiques de consultation de ses publications. Aucun accès aux données globales. |
| **Étudiant** | Annonces qui le concernent, documents autorisés, emplois du temps et calendrier de son niveau, résultats publiés, demandes avec suivi, messagerie, notifications, profil. |
| **Rôles personnalisés** | Créés par le chef avec une liste de permissions choisies ; aucun droit implicite. |

Les permissions sont vérifiées côté serveur (`requirePermission`), les périmètres sont contrôlés en base
(`assertScopeFor`) et les audiences des publications sont filtrées en SQL.

### Authentification
- **Téléphone = identifiant** (normalisé), **mot de passe de 6 chiffres** + confirmation + bouton œil.
- Hachage **PBKDF2-HMAC-SHA256** (210 000 itérations, sel aléatoire).
- Inscriptions **validées par l’administration** (option activable), approbation / rejet / suspension.
- Réinitialisation par **lien à usage unique** (1 heure) généré par l’administration — aucun faux OTP SMS.
- **Limitation des tentatives** par compte et par adresse IP, verrouillage temporaire après 5 échecs.
- Sessions en base, cookie `HttpOnly` + `SameSite=Lax` + `Secure` en production, jeton **CSRF** exigé pour
  toute mutation, vérification d’origine, en-têtes de sécurité (CSP, Helmet).

### Contenus et vie du département
- **Accueil institutionnel** : nom, logo fourni par la direction, présentation, actualités, filières,
  documents publics, agenda, activités, contacts — tous administrables. Les sections se nourrissent
  uniquement des contenus réellement publiés (aucune donnée de remplissage).
- **Structure académique dynamique** : niveaux, fils et sous-parcours, groupes, responsables ; archivage
  au lieu de suppression silencieuse, suppression bloquée si des données sont rattachées.
- **Publications** : titre, texte, date, auteur, pièces jointes, catégorie, priorité, audiences multiples
  (public, tous, rôles, niveaux, parcours, groupes), brouillon / publiée / programmée / archivée,
  recherche, édition contrôlée, liste nominative des lecteurs pour les personnes habilitées.
- **Notifications** : in-app, compteur de non-lues, page dédiée, lien direct, marquage lu/ouvert,
  **5 sons WAV + son par défaut + « aucun »**, vibration, activation des notifications navigateur.
  Les limites sont affichées honnêtement : aucun son ni push n’est garanti lorsque l’application est fermée.
- **Bibliothèque documentaire** : PDF, supports, TD, présentations, notes, calendriers, formulaires ;
  catégories, niveaux, parcours, visibilités, aperçu PDF/images, contrôle du type réel et de la taille,
  fichiers **non accessibles par une URL devinée** (contrôle d’accès sur chaque téléchargement).
- **Emplois du temps** (publication, remplacement, archivage, notification des étudiants) et
  **calendrier** (examens, soutenances, conférences, ateliers, réunions).
- **Résultats** : dépôt PDF, niveau/parcours/session, brouillon puis **publication**, retrait, remplacement
  tracé dans un historique, suivi des consultations nominatives réservé aux personnes habilitées.
- **Demandes administratives** : numéro de référence `DEM-AAAA-xxxxx`, statuts reçue / en cours / traitée /
  rejetée, affectation, réponse, historique et notification de l’étudiant.
- **Messagerie interne** : conversations privées entre participants autorisés, non visibles de
  l’administration.
- **Recherche et vie du département** : 11 catégories de rubriques activables/désactivables
  (recherche, publications scientifiques, conférences, séminaires, ateliers, soutenances, partenariats,
  associations, stages, opportunités, autres).
- **Statistiques** issues uniquement d’événements réels : comptes par rôle, étudiants par niveau,
  publications, documents, notifications, vues, demandes, activité quotidienne / hebdomadaire / mensuelle.
- **Paramètres** : identité, logo, présentation, contacts, année académique, inscriptions,
  **catégories de publications** (création, édition, archivage), modules on/off, **sous-rubriques de la
  vie du département on/off**, **types de notifications on/off**, **durée de conservation** (purge
  quotidienne des notifications lues et du journal), accessibilité (taille de texte, bornes), limite
  d’envoi, mode démonstration, journal d’audit.

---

## 2. Démarrage local

Prérequis : **Node.js ≥ 20** et npm.

```bash
git clone <votre-dépôt> departement-communication
cd departement-communication

npm install
cp .env.example .env
# Modifier .env : SESSION_SECRET (longue chaîne aléatoire) et, si besoin, DATABASE_URL.

npm run migrate
npm run create-admin        # téléphone + nom + mot de passe de 6 chiffres (saisie masquée)
npm start
```

Ouvrir <http://localhost:3000>. Sans `DATABASE_URL`, l’application utilise **PGlite** (PostgreSQL
embarqué) dans `PGLITE_DATA_DIR` : même SQL, persistance sur disque, **interdit en production**.

> ⚠️ PGlite ne supporte qu’un seul processus à la fois. Arrêtez le serveur avant de lancer
> `npm run migrate`, `npm run create-admin` ou `npm run seed:demo` en développement.

### Données de démonstration (facultatif, développement uniquement)

```bash
npm run seed:demo -- --force
```

Crée des comptes et contenus **fictifs**, clairement identifiés « démonstration » et affichés avec un
bandeau d’avertissement. Le script refuse de s’exécuter en production. Comptes : `+225000000001` (chef),
`+225000000002` (secrétariat), `+225000000003` (enseignant), `+225000000004` (étudiant) — mot de passe
`123456`. Aucune donnée officielle n’est inventée.

### Tests automatisés

```bash
npm test                              # 172 vérifications d’API sur une base isolée
TEST_STORAGE_DRIVER=postgres npm test # mêmes tests avec stockage des fichiers en base
```

La suite démarre un serveur isolé sur une base neuve, puis vérifie notamment :

1. `npm install` / `npm start` et `/healthz` ;
2. connexion, mauvais mot de passe, déconnexion, CSRF ;
3. permissions par rôle et refus des mutations anonymes ;
4. création de comptes, approbation, rejet, suspension immédiate ;
5. publications, audiences, notifications ciblées, absence de doublon, vues ;
6. documents, fichiers privés et refus des types interdits ;
7. résultats en brouillon invisibles, publication, retrait, historique ;
8. emplois du temps, calendrier, périmètres des responsables ;
9. demandes avec référence, traitement, notification ;
10. messagerie privée (tiers refusé) ;
11. réinitialisation par lien à usage unique ;
12. rôles personnalisés et effet immédiat du retrait d’une permission ;
13. paramètres publics immédiats et statistiques réelles ;
14. archivage d’un niveau utilisé sans perte d’historique ;
15. **persistance après redémarrage** (comptes, publications, documents, paramètres) ;
16. limitation/verrouillage après tentatives répétées ;
17. sauvegarde JSON sans empreintes de mots de passe, diagnostic technique ;
18. catégories de publications (création, archivage si utilisée) ;
19. types de notifications désactivables et sous-rubriques masquées ;
20. documents, événements et activités publics visibles sans connexion, fichiers publics téléchargeables ;
21. conservation des données paramétrable.

---

Les parcours d’interface (connexion, publications, documents, emplois du temps, messagerie,
demandes, administration, accueil public et affichage mobile 360–390 px) ont été vérifiés
séparément avec Playwright sur le serveur de développement : 34 contrôles de rendu, 17 parcours
métier, 15 contrôles d’administration et 13 contrôles de l’accueil public. Ce harnais n’est pas
nécessaire au fonctionnement de l’application.

## 3. Configuration

Toutes les variables sont documentées dans [`.env.example`](.env.example).

| Variable | Obligatoire | Rôle |
|---|---|---|
| `DATABASE_URL` | **production** | Chaîne PostgreSQL (`postgresql://…`). Refus de démarrer en production sans elle. |
| `SESSION_SECRET` | **production** | ≥ 24 caractères aléatoires ; poivre les empreintes de jetons de session. |
| `APP_URL` | recommandé | URL publique exacte, utilisée pour les liens de réinitialisation et l’origine autorisée. |
| `PORT` | non | Port d’écoute (Render le fournit). |
| `NODE_ENV` | oui | `production` sur Render. |
| `PGLITE_DATA_DIR` | dev | Dossier de la base embarquée (ignoré en production). |
| `STORAGE_DRIVER` | non | `auto` (défaut : local en dev, PostgreSQL en prod), `postgres`, `local`, `supabase`. |
| `MAX_UPLOAD_MB` | non | Taille maximale par fichier (8 Mo par défaut, modifiable dans les paramètres). |
| `REQUIRE_APPROVAL` | non | Valide les inscriptions par l’administration au premier démarrage (1/0). |
| `REGISTRATION_OPEN` | non | Ouvre ou ferme les inscriptions au premier démarrage (modifiable ensuite). |
| `ADMIN_PHONE` / `ADMIN_PASSWORD` | non | Création du **premier** compte chef au premier démarrage (mot de passe à 6 chiffres). À retirer ensuite. |
| `TRUST_PROXY` | Render | `1` derrière le proxy Render (cookies `Secure`, IP réelle). |

**Aucun mot de passe administrateur n’est codé en dur.** Le premier compte est créé par
`npm run create-admin` (saisie masquée) ou, à défaut, par `ADMIN_PHONE` + `ADMIN_PASSWORD` au premier
démarrage.

---

## 4. Déploiement sur Render

### Option A — Blueprint (recommandé)

1. Pousser le projet sur GitHub/GitLab.
2. Render → **New → Blueprint**, sélectionner le dépôt : `render.yaml` crée le service web et la base
   PostgreSQL, relie `DATABASE_URL` et génère `SESSION_SECRET`.
3. Vérifier que `APP_URL` correspond à l’URL réelle du service.
4. Au premier déploiement, définir `ADMIN_PHONE` et `ADMIN_PASSWORD` (6 chiffres) dans **Environment**,
   ou ouvrir le **Shell** Render et lancer `npm run create-admin`.
5. Se connecter, changer le mot de passe, puis **supprimer `ADMIN_PASSWORD`** de l’environnement.
6. Vérifier `https://<service>.onrender.com/healthz` → `{"status":"ok","db":"pg"}`.

### Option B — Manuel

- **New → PostgreSQL** (plan free ou payant), copier son *Internal Database URL*.
- **New → Web Service** : runtime Node, build `npm ci`, start `npm start`, health check `/healthz`.
- Variables : `NODE_ENV=production`, `DATABASE_URL`, `SESSION_SECRET` (Generate), `APP_URL`,
  `TRUST_PROXY=1`, `STORAGE_DRIVER=auto`.

Les migrations sont appliquées automatiquement à chaque démarrage (idempotentes). Le disque de Render
étant éphémère, `STORAGE_DRIVER=auto` stocke les fichiers **en base PostgreSQL** en production.

Guide détaillé : [`docs/DEPLOIEMENT-RENDER.md`](docs/DEPLOIEMENT-RENDER.md).

---

## 5. Structure du projet

```
server/
  index.js            démarrage, migrations, planificateur, arrêt propre
  app.js              Express, sécurité, routes, fichiers statiques
  config.js / db.js   configuration, PostgreSQL (pg) ou PGlite
  auth.js             PBKDF2, sessions, CSRF, limitation des tentatives
  permissions.js      catalogue et contrôle des permissions
  validation.js / errors.js / audit.js / settings.js
  routes/             auth, structure, users, roles, publications, files, documents,
                      timetables, results, requests, messages, notifications,
                      activities, stats, admin, profile
  services/           storage.js (local/PostgreSQL/Supabase), notify.js, access.js
migrations/           001_init.sql, 002_seed_defaults.sql, 003_user_preferences.sql
scripts/              migrate.js, create-admin.js, seed-demo.js
public/               interface (HTML, CSS, modules JS, service worker, sons, icônes)
tests/api.test.js     suite d’intégration
docs/                 installation, déploiement, exploitation, sécurité
```

Détails d’architecture et contrats d’API : [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## 6. Sécurité et limites assumées

- RBAC serveur sur **chaque** requête, SQL paramétré, validation des entrées, fichiers privés.
- Journal d’audit des actions sensibles (connexion, comptes, publications, résultats, paramètres,
  sauvegardes…), consultable avec pagination et filtres.
- Sauvegarde : export JSON depuis l’interface (sans fichiers binaires ni empreintes de mots de passe) et
  procédure `pg_dump` / `pg_restore` documentée.
- **Aucun OTP SMS** n’est promis : la récupération passe par un lien généré par l’administration.
- **Notifications système** : dépendantes de l’autorisation du navigateur ; non garanties application
  fermée. Le son in-app fonctionne lorsque l’onglet est ouvert.
- **Aperçu PDF** : selon le navigateur ; le téléchargement reste toujours disponible.
- Les données de démonstration sont **fictives** et désactivables ; aucun résultat, événement ou
  actualité officielle n’est généré automatiquement.
- Render gratuit : le service s’endort après inactivité (premier chargement lent) et les bases gratuites
  ont une durée de vie limitée ; pour la production réelle, utiliser une offre adaptée et activer les
  sauvegardes.

Voir [`docs/SECURITE.md`](docs/SECURITE.md) et [`docs/EXPLOITATION.md`](docs/EXPLOITATION.md).
