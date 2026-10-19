# Sécurité

## 1. Authentification et sessions

- Identifiant = numéro de téléphone normalisé ; mot de passe **exactement 6 chiffres**.
- Hachage **PBKDF2-HMAC-SHA256**, 210 000 itérations, sel aléatoire de 16 octets ; comparaison à temps
  constant.
- Inscription : mot de passe + confirmation, validation par l’administration (option), statuts
  `pending`, `rejected`, `active`, `suspended`.
- Sessions : jeton aléatoire de 32 octets, seule son empreinte **poivrée par `SESSION_SECRET`** est
  stockée ; cookie `HttpOnly`, `SameSite=Lax`, `Secure` en production, expiration configurable
  (`SESSION_TTL_HOURS`, 24 h par défaut).
- **CSRF** : jeton unique par session, exigé via l’en-tête `X-CSRF-Token` sur toute mutation.
- **Vérification d’origine** complémentaire sur les requêtes mutantes.
- **Limitation** : 10 tentatives par numéro et 120 par adresse IP sur 15 minutes ; verrouillage du compte
  après 5 échecs pendant 15 minutes. La limite par IP est volontairement large car un campus ou un opérateur
  mobile peut partager une même adresse entre de nombreux utilisateurs. Les compteurs sont en mémoire par
  instance (voir limites).
- Réinitialisation : lien à usage unique, empreinte en base, expiration 1 heure, toutes les sessions du
  compte sont fermées après usage. **Aucun OTP SMS** n’est simulé.

## 2. Autorisation

- RBAC vérifié **côté serveur** sur chaque route sensible (`requirePermission`), jamais seulement dans
  l’interface.
- Le rôle `chef` possède `*`. Les rôles personnalisés n’ont que les permissions explicitement cochées.
- **Périmètres** : un responsable ou enseignant ne peut agir que sur les niveaux, parcours et groupes
  qui lui sont attribués (`user_scopes`). Un responsable ne peut pas publier « pour tout le département ».
- Audiences des publications filtrées en SQL ; un étudiant d’un autre niveau ne voit ni la publication
  ni sa notification.
- **Fichiers privés** : `GET /api/files/:id` vérifie, pour chaque fichier, le rattachement à une
  publication, un document, un résultat ou un emploi du temps accessible. Aucune URL publique devinable.
- Rôles système protégés : le rôle chef ne peut pas perdre `*` ; un rôle attribué ne peut pas être supprimé.
- Un compte non-chef ne peut pas modifier le rôle d’un chef ni élever ses propres droits.

## 3. Données et validation

- **Requêtes SQL paramétrées** partout ; aucune concaténation de valeurs utilisateur.
- Validation stricte des entrées (longueurs, énumérations, identifiants entiers, dates ISO, booléens).
- Téléversements : liste blanche de types MIME, **vérification des signatures binaires** (PDF, PNG, JPEG,
  WEBP), taille maximale, nom de fichier assaini, clé de stockage aléatoire (UUID).
- Les fichiers ne sont jamais servis depuis le dossier public : uniquement via l’API contrôlée, avec
  `Content-Disposition` et `X-Content-Type-Options: nosniff`.
- Protection XSS : échappement systématique des contenus utilisateur dans l’interface (`esc`, template
  sécurisé), CSP sans `unsafe-eval` ; seuls les styles inline sont autorisés.
- Erreurs : messages clairs pour l’utilisateur, détails techniques uniquement dans les journaux serveur
  (pas de SQL, pas de secret, pas de pile en production).
- En-têtes Helmet : CSP, `frame-ancestors`, `referrer-policy`, `nosniff`, HSTS en production.

## 4. Journal d’audit

Actions consignées : connexions réussies/échouées, déconnexions, réinitialisations, création/modification/
approbation/rejet/suspension de comptes, changements de rôles et de permissions, structure académique,
publications (création, diffusion, archivage, suppression), documents, emplois du temps, événements,
résultats (dépôt, publication, retrait, remplacement), demandes, activités, paramètres, exports de
sauvegarde, lectures massives de notifications.

Chaque entrée contient : acteur, action, entité, identifiant, détails, IP, agent utilisateur, date.
Consultation : **Administration → Journal** (`audit.view`).

## 5. Sauvegardes et secrets

- Aucun secret dans le dépôt : `.env` est ignoré, seul `.env.example` est versionné.
- Aucun mot de passe administrateur codé en dur ; première initialisation par script interactif ou
  variables d’environnement à usage unique.
- `SESSION_SECRET` obligatoire en production (≥ 24 caractères), généré par Render.
- Export JSON : ni fichiers binaires, ni empreintes de mots de passe.
- Conservation : purge quotidienne optionnelle des notifications lues et du journal au-delà de la durée
  configurée ; les données pédagogiques et administratives ne sont pas purgées automatiquement.
- Sauvegarde complète : `pg_dump` chiffré, stocké hors du service, accès restreint (voir EXPLOITATION.md).

## 6. Limites connues et honnêtes

- **Notifications système** : soumises à l’autorisation du navigateur ; non garanties lorsque
  l’application est fermée ou l’appareil verrouillé. Aucun push serveur n’est promis.
- **Son de notification** : joué lorsque l’onglet est ouvert ; les navigateurs mobiles peuvent le
  bloquer sans interaction préalable (le bouton « Tester » permet de vérifier).
- **Limitation des tentatives** : compteurs mémoire, non partagés entre plusieurs instances. Pour un
  déploiement multi-instances, utiliser un magasin partagé (Redis) ou un reverse proxy.
- **Aperçu PDF** : dépend du navigateur ; le téléchargement reste disponible.
- **Aucun OTP SMS**, aucune intégration e-mail : les liens de réinitialisation sont transmis par
  l’administration via un canal sûr.
- **Résultats** : l’application diffuse les fichiers officiels publiés (procès-verbaux, relevés par
  niveau). Elle ne calcule ni ne fabrique aucune note.
- **Recherche documentaire** : pas d’OCR ; seuls les titres, descriptions et noms de fichiers sont
  indexés.

## 7. Réponse à incident

1. Suspendre le compte concerné (ferme immédiatement ses sessions).
2. Changer `SESSION_SECRET` pour invalider toutes les sessions si nécessaire.
3. Consulter le journal d’audit (acteur, action, IP, horodatage).
4. Générer un lien de réinitialisation pour les comptes impactés.
5. Si des données sont compromises : restaurer depuis une sauvegarde vérifiée, informer la direction et
   consigner l’incident.
6. Si un fichier est compromis : l’archiver/retirer, supprimer le fichier, vérifier les droits d’accès.
