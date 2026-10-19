# Journal des versions — Département de Communication, Université de Bouaké

Chaque livraison est numérotée. Le numéro est affiché dans l’application (bas de la barre latérale)
et sur la page **Administration → Sauvegarde → État de l’application**.

| Version | Date | Contenu |
|---|---|---|
| **2.0.0** | 19 octobre 2026 | Interface refondue d’après le modèle validé : barre latérale bleu nuit avec bandeau visuel, groupes *Espace personnel / Espace académique / Administration*, carte utilisateur et déconnexion ; en-tête avec fil d’Ariane, année académique et notifications ; carte d’accueil sombre avec photo, surtitre doré et bouton doré ; cartes chiffrées à pastille d’icône. Ajout de la **photo de couverture** administrable (bandeau + carte d’accueil) à côté du logo. Ajustement de la limite de connexion par adresse IP (120 / 15 min). |
| 1.1.0 | 19 octobre 2026 | Catégories de publications administrables, rubriques de vie du département activables, types de notifications configurables, purge selon la durée de conservation, endpoints publics (documents, agenda, activités) et accueil public enrichi. |
| 1.0.0 | 18 octobre 2026 | Livraison initiale : authentification par téléphone, rôles et permissions vérifiés côté serveur, publications et audiences, documents, emplois du temps, résultats, demandes administratives, messagerie, notifications, statistiques, journal d’audit, sauvegarde, déploiement Render. |

## Mise à jour vers une nouvelle version

1. Remplacer le contenu du dépôt par les fichiers de l’archive correspondante.
2. Laisser Render redéployer (`npm ci` puis `npm start`).
3. Au démarrage, les migrations nouvelles sont appliquées automatiquement ; aucune donnée n’est supprimée.
4. Vérifier le numéro affiché en bas de la barre latérale ou sur `GET /api/app-version`.
