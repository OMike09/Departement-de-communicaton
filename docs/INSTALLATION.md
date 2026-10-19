# Installation locale

## Prérequis

- **Node.js 20 ou supérieur** (`node -v`)
- **npm 10 ou supérieur**
- PostgreSQL 13+ (production) — non nécessaire en développement grâce à PGlite

## Étapes

```bash
cd departement-communication
npm install
cp .env.example .env
```

Éditer `.env` :

```ini
PORT=3000
NODE_ENV=development
APP_URL=http://localhost:3000
SESSION_SECRET=une-chaine-aleatoire-de-32-caracteres-minimum
PGLITE_DATA_DIR=./storage/pglite
STORAGE_DRIVER=auto
MAX_UPLOAD_MB=8
REQUIRE_APPROVAL=1
REGISTRATION_OPEN=1
```

Créer la base et le premier compte :

```bash
npm run migrate
npm run create-admin
```

Le script demande le téléphone, le nom complet puis le mot de passe (6 chiffres, saisie masquée).
Aucun mot de passe par défaut n’existe.

Démarrer :

```bash
npm start          # http://localhost:3000
npm run dev        # redémarrage automatique (Node --watch)
```

## Première configuration dans l’application

1. **Connexion** avec le téléphone et le mot de passe du chef.
2. **Administration → Paramètres** : nom affiché, présentation officielle, coordonnées, année
   académique, logo fourni par la direction, ouverture des inscriptions.
3. **Administration → Structure** : créer les niveaux, parcours (et sous-parcours), groupes.
   *Aucune filière n’est préremplie : le dossier fourni ne contient pas ces informations.*
4. **Administration → Rôles** : vérifier les rôles système ; créer si besoin des rôles personnalisés
   (délégué, responsable de communication…).
5. **Administration → Utilisateurs** : créer les comptes du secrétariat et des enseignants, attribuer
   les **périmètres** (niveaux/parcours/groupes) aux responsables et enseignants.
6. Communiquer l’URL aux étudiants ; les inscriptions sont validées par le secrétariat.

## Vérifier l’installation

```bash
curl http://localhost:3000/healthz
# {"status":"ok","db":"pglite","time":"…"}
npm test
```

La suite de tests utilise un dossier temporaire et ne touche pas à la base de développement.

## Problèmes courants

| Symptôme | Cause / solution |
|---|---|
| `Aborted(). Build with -sASSERTIONS` au lancement d’un script | Deux processus PGlite accèdent au même dossier. Arrêter `npm start` avant `npm run migrate` / `create-admin` / `seed:demo`. |
| `EADDRINUSE` | Le port 3000 est déjà utilisé : `PORT=3001 npm start`. |
| `DATABASE_URL est obligatoire en production` | `NODE_ENV=production` sans PostgreSQL : définir `DATABASE_URL` ou repasser en développement. |
| Cookie de session perdu derrière un proxy | Mettre `TRUST_PROXY=1` et `APP_URL` sur l’URL HTTPS exacte. |
| Fichier refusé au téléversement | Formats : PDF, JPG, PNG, WEBP, DOCX, PPTX, XLSX, TXT, MP3, WAV, OGG, MP4 ; taille ≤ `MAX_UPLOAD_MB` ; le contenu doit correspondre au type déclaré. |
| Page blanche après mise à jour | Forcer le rechargement (le service worker sert le cache en secours) ; le cache est versionné par déploiement. |

## Réinitialisation complète (développement uniquement)

```bash
rm -rf storage/pglite storage/uploads
npm run migrate
npm run create-admin
```

Ne jamais supprimer ces dossiers en production : utiliser la procédure de sauvegarde/restauration.
