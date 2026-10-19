# Architecture

## 1. Vue d’ensemble

```
Navigateur (HTML/CSS/JS modules, PWA légère)
        │  fetch JSON + cookie de session + X-CSRF-Token
        ▼
Express (server/app.js)
  Helmet, CSP, JSON, cookies, origine, sessions, CSRF
        │
        ├── Routes /api/*  (RBAC + validation + audit)
        ├── Services : storage (local/PostgreSQL/Supabase), notify, access
        └── db.js : pg (DATABASE_URL) ou PGlite (développement)
                │
                ▼
        PostgreSQL (production) / PGlite (développement)
```

- **Un seul déploiement** sert l’interface et l’API (même origine : pas de CORS ouvert).
- **Frontend** : modules ES natifs, routage par hash (`#/annonces`, `#/documents`…), aucun framework.
  `public/js/api.js` centralise fetch, CSRF, état, notifications et helpers ; `public/js/app.js` gère la
  coquille et le routeur ; `public/js/views/*.js` contient les écrans.
- **Backend** : Express 4, routes par domaine, services partagés, erreurs typées (`errors.js`),
  validation (`validation.js`), audit (`audit.js`), paramètres (`settings.js`).

## 2. Modèle de données (migrations 001–003)

| Domaine | Tables |
|---|---|
| Comptes | `roles`, `users`, `user_scopes`, `sessions`, `password_resets`, `login_attempts` |
| Structure | `levels`, `parcours`, `parcours_levels`, `groups` |
| Publications | `categories`, `publications`, `publication_audiences`, `publication_views`, `publication_files` |
| Fichiers | `files` (métadonnées + binaire éventuel en `bytea`) |
| Pédagogie | `documents`, `timetables`, `schedule_events`, `results`, `result_views`, `result_history` |
| Demandes | `requests`, `request_events` |
| Messagerie | `threads`, `thread_participants`, `messages` |
| Vie du département | `activities`, `notifications`, `settings`, `audit_logs` |

Points clés :

- `publication_views` : clé unique `(publication_id, user_id)` → une vue par compte et par publication.
- `notifications` : index unique partiel sur `(user_id, publication_id)` → pas de doublon lors d’une
  rediffusion ou d’une modification.
- `publication_audiences` : `kind` ∈ `public`, `all`, `role`, `level`, `parcours`, `group` ;
  `target_id` pour les entités, `target_text` pour les rôles/groupes.
- `results` : statuts `draft`, `published`, `withdrawn` ; tout remplacement de fichier repasse en
  brouillon et écrit une ligne dans `result_history`.
- `settings` : clé/valeur texte ; les modules, types de notifications, sous-rubriques d’activités sont
  stockés en JSON ; `data_retention_days` pilote la purge quotidienne (0 = illimité).
- `files` : `storage` ∈ `local`, `db`, `supabase` ; `sha256` pour l’intégrité.

## 3. Contrôle d’accès

1. `loadSession` charge l’utilisateur, ses permissions (JSON du rôle) et son statut.
2. `requireAuth` refuse les comptes absents, en attente, rejetés ou suspendus (codes
   `auth_required`, `account_pending`, `account_rejected`, `account_suspended`).
3. `requirePermission('…')` vérifie la permission (ou `*`).
4. `assertScopeFor(user, { levelId, parcoursId, groupName })` vérifie les périmètres pour les
   responsables/enseignants.
5. Les listes appliquent un filtre SQL selon le rôle et les périmètres (publications, documents,
   emplois du temps, événements, résultats).
6. `canReadDocument`, `canReadPublication`, `canReadResult`, `canReadTimetable` (services/access.js)
   contrôlent l’accès unitaire et servent aussi au téléchargement des fichiers.

## 4. Permissions

`users.view`, `users.manage`, `users.approve`, `roles.manage`, `structure.manage`, `categories.manage`,
`publications.create`, `publications.manage_all`, `publications.audience_all`, `documents.upload`,
`documents.manage`, `timetables.manage`, `results.manage`, `results.publish`, `requests.manage`,
`activities.manage`, `messages.moderate`, `stats.view`, `stats.personal`, `audit.view`,
`settings.manage`, `backups.manage`.

Le catalogue est exposé par `GET /api/admin/permissions` et utilisé par l’écran **Rôles & permissions**.

## 5. API principale

Toutes les routes sont préfixées par `/api`. Les mutations exigent `X-CSRF-Token`.

### Public
- `GET /api/structure`
- `GET /api/public/announcements?limit=6`
- `GET /api/public/announcements/:id`
- `GET /api/public/documents` (documents de visibilité « public »)
- `GET /api/public/events` (événements à venir d’audience « public »)
- `GET /api/public/activities` (rubriques actives uniquement)
- `GET /api/public/logo`
- `GET /api/auth/me` (paramètres publics, session éventuelle)
- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`
- `POST /api/auth/forgot-password`, `GET|POST /api/auth/reset/:token`

### Publications
- `GET /api/publications?scope=feed|manage&status=&q=&category=&page=`
- `GET /api/publications/:id`
- `POST /api/publications` · `PUT /api/publications/:id` · `DELETE /api/publications/:id`
- `POST /api/publications/:id/publish` · `POST /api/publications/:id/archive`
- `POST /api/publications/:id/view` · `GET /api/publications/:id/viewers`

### Fichiers et documents
- `POST /api/uploads` (corps binaire, en-têtes `Content-Type` et `X-File-Name`)
- `GET /api/files/:id?inline=1`
- `GET /api/files` (mes fichiers) · `POST /api/documents` · `GET /api/documents`
- `GET /api/documents/:id` · `PUT /api/documents/:id` · `POST /api/documents/:id/archive`

### Emplois du temps et calendrier
- `GET|POST /api/timetables` · `PUT|DELETE /api/timetables/:id`
- `POST /api/timetables/:id/archive`
- `GET|POST /api/events` · `PUT|DELETE /api/events/:id`

### Résultats
- `GET /api/results` · `GET /api/results/:id`
- `POST /api/results` · `PUT /api/results/:id`
- `POST /api/results/:id/publish` · `POST /api/results/:id/withdraw`
- `POST /api/results/:id/view` · `GET /api/results/:id/viewers` · `GET /api/results/:id/history`

### Demandes, messagerie, notifications
- `GET|POST /api/requests` · `GET|PUT /api/requests/:id`
- `GET /api/messages/threads` · `GET /api/messages/contacts` · `GET /api/messages/unread-count`
- `POST /api/messages/threads` · `GET /api/messages/threads/:id` · `POST /api/messages/threads/:id/messages`
- `GET /api/notifications?page=&unread=1` · `GET /api/notifications/count`
- `POST /api/notifications/:id/read` · `POST /api/notifications/read-all`

### Profil, activités, statistiques
- `GET|PUT /api/profile` · `PUT /api/profile/preferences` · `POST /api/auth/change-password`
- `GET|POST /api/activities` · `PUT|DELETE /api/activities/:id`
- `GET /api/stats/overview` · `GET /api/stats/mine`

### Administration
- `GET|POST /api/admin/users` · `GET|PUT /api/admin/users/:id`
- `POST /api/admin/users/:id/approve|reject|status|reset-link`
- `GET|POST /api/admin/roles` · `PUT|DELETE /api/admin/roles/:id`
- `GET /api/admin/permissions` · `GET /api/roles-lite`
- `GET|POST /api/admin/{levels,parcours,groups}` · `PUT|DELETE /api/admin/{levels,parcours,groups}/:id`
- `GET /api/admin/structure` · `GET|PUT /api/admin/settings`
- `GET|POST /api/admin/categories` · `PUT|DELETE /api/admin/categories/:id`
- `GET /api/admin/audit?page=&action=&entity=`
- `GET /api/admin/health` · `GET /api/admin/pending-count` · `GET /api/admin/backup`

## 6. Frontend

- Routage par hash : `#/accueil`, `#/annonces[/:id|/nouvelle|/:id/modifier]`, `#/documents`,
  `#/emplois-du-temps`, `#/calendrier`, `#/resultats`, `#/demandes`, `#/messages[/:threadId]`,
  `#/vie-du-departement`, `#/notifications`, `#/profil`,
  `#/admin/{utilisateurs,roles,structure,statistiques,journal,parametres,sauvegarde}`.
- `state` (utilisateur, permissions, paramètres, structure, compteur de notifications) est chargé par
  `loadMe()` puis rafraîchi toutes les 30 secondes (compteurs et nouvelles notifications).
- Les droits d’affichage utilisent `can()` ; le serveur reste l’autorité finale.
- Accessibilité : taille de texte réglable (0,9 à 1,4), contrastes, libellés ARIA, focus visible,
  navigation clavier, absence de débordement horizontal dès 360 px.

## 7. Notifications et sons

- `notify.js` crée les notifications en transaction lors de la diffusion d’une publication, de la
  publication de résultats, d’un nouvel emploi du temps, du traitement d’une demande.
- Le planificateur vérifie chaque minute les publications programmées arrivées à échéance.
- `public/sounds/*.wav` : 5 sons + « défaut » ; « aucun » désactive la lecture. Le choix est enregistré
  dans `users.sound_pref` (API préférences). La vibration suit `users.vibration`.
- Les notifications navigateur ne sont utilisées qu’après autorisation explicite ; l’interface rappelle
  qu’aucune garantie n’existe lorsque l’application est fermée.

## 8. Choix de stockage

| Contexte | Base | Fichiers |
|---|---|---|
| Développement | PGlite (dossier local) | disque local (`storage/uploads`) |
| Production Render | PostgreSQL (`DATABASE_URL`) | PostgreSQL (`bytea`) par défaut |
| Option | PostgreSQL | Supabase Storage privé |

Aucun retour silencieux vers une base locale en production : `db.js` refuse de démarrer sans
`DATABASE_URL` lorsque `NODE_ENV=production`.
