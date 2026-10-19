# Déploiement sur Render

URL cible du service : **https://departement-de-communicaton.onrender.com**

## 1. Blueprint (recommandé)

1. Placer le projet dans un dépôt Git (GitHub/GitLab).
2. Dans Render : **New → Blueprint**, sélectionner le dépôt.
3. Render lit `render.yaml` et crée :
   - la base **PostgreSQL** `departement-communication-db` ;
   - le service web `departement-de-communicaton` (Node, `npm ci`, `npm start`, health check `/healthz`) ;
   - les variables `DATABASE_URL` (connexion interne), `NODE_ENV=production`, `SESSION_SECRET`
     généré, `APP_URL`, `TRUST_PROXY=1`, `STORAGE_DRIVER=auto`.
4. **Premier administrateur** (deux méthodes) :
   - **Shell Render** du service : `npm run create-admin` puis répondre aux questions
     (téléphone, nom, mot de passe à 6 chiffres — saisie masquée) ;
   - ou ajouter temporairement `ADMIN_PHONE` et `ADMIN_PASSWORD` dans *Environment*, redéployer,
     se connecter, changer le mot de passe, **puis supprimer `ADMIN_PASSWORD`**.
5. Ouvrir `/healthz` : la réponse doit contenir `"db":"pg"`.
6. Se connecter avec le téléphone du chef, compléter **Paramètres** et **Structure**.

## 2. Configuration manuelle équivalente

| Réglage Render | Valeur |
|---|---|
| Environment | Node |
| Build Command | `npm ci` |
| Start Command | `npm start` |
| Health Check Path | `/healthz` |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | *Internal Database URL* de la base PostgreSQL |
| `SESSION_SECRET` | bouton **Generate** (≥ 24 caractères) |
| `APP_URL` | `https://departement-de-communicaton.onrender.com` |
| `TRUST_PROXY` | `1` |
| `STORAGE_DRIVER` | `auto` |
| `MAX_UPLOAD_MB` | `8` (ajustable) |

Les migrations sont exécutées automatiquement au démarrage. Chaque nouveau déploiement les rejoue de
façon idempotente.

## 3. Fichiers et disque

Le système de fichiers de Render est **éphémère**. Avec `STORAGE_DRIVER=auto` (ou `postgres`),
les fichiers sont stockés dans la table `files` (colonne `bytea`) : ils survivent aux redéploiements et
sont inclus dans `pg_dump`. Si vous préférez un stockage objet, configurez `STORAGE_BACKEND=supabase`
avec `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_BUCKET` (bucket **privé**).

## 4. Sessions et cookies

En production :

- cookie `HttpOnly`, `SameSite=Lax`, `Secure` (HTTPS obligatoire — Render le fournit) ;
- `TRUST_PROXY=1` indispensable pour que le cookie `Secure` soit émis et que l’IP réelle soit vue ;
- `APP_URL` doit correspondre exactement à l’origine publique, sinon les liens de réinitialisation et la
  vérification d’origine seront refusés.

## 5. Vérifications après déploiement

```bash
curl https://departement-de-communicaton.onrender.com/healthz
curl https://departement-de-communicaton.onrender.com/api/app-version
```

Puis, dans le navigateur :

1. page d’accueil publique (sans connexion) ;
2. connexion chef → tableau de bord ;
3. création d’un niveau et d’un parcours ;
4. création d’un compte enseignant avec périmètre ;
5. publication ciblée sur un niveau → vérifier la notification de l’étudiant ;
6. dépôt d’un PDF → téléchargement ;
7. déconnexion / reconnexion → les données sont toujours présentes.

## 6. Limites de l’offre gratuite

- Le service s’endort après inactivité : le premier chargement peut prendre 30–60 secondes.
- Les bases gratuites Render ont une **durée de vie limitée** et ne remplacent pas une sauvegarde.
- Pour une mise en service réelle : plan payant, sauvegardes automatiques activées, surveillance de
  `/healthz`, et conservation des exports selon la politique de l’université.

## 7. Mise à jour de l’application

1. Pousser sur la branche suivie par Render (auto-deploy) ou lancer *Manual Deploy*.
2. Le démarrage applique les migrations additives.
3. Vérifier `/api/app-version` et les journaux Render (erreurs SQL, stockage).
4. En cas de retour arrière : redéployer le commit précédent. Les migrations étant additives, les données
   restent lisibles. Ne jamais supprimer une colonne ou une table dans une migration appliquée sans
   sauvegarde préalable.
