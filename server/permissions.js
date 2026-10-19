/**
 * Catalogue des permissions et vérification côté serveur.
 * Le rôle "chef" possède la permission spéciale "*".
 */
export const PERMISSION_GROUPS = [
  {
    label: 'Comptes et rôles',
    items: [
      ['users.view', 'Voir la liste des comptes'],
      ['users.manage', 'Créer et modifier les comptes'],
      ['users.approve', 'Approuver ou rejeter les inscriptions'],
      ['roles.manage', 'Gérer les rôles et permissions'],
    ],
  },
  {
    label: 'Structure académique',
    items: [
      ['structure.manage', 'Gérer filières, parcours, niveaux et groupes'],
      ['categories.manage', 'Gérer les catégories de publications'],
    ],
  },
  {
    label: 'Publications',
    items: [
      ['publications.create', 'Publier des annonces et contenus'],
      ['publications.manage_all', 'Modifier/supprimer toutes les publications'],
      ['publications.audience_all', 'Cibler toutes les audiences'],
    ],
  },
  {
    label: 'Documents et pédagogie',
    items: [
      ['documents.upload', 'Déposer des documents'],
      ['documents.manage', 'Gérer tous les documents'],
      ['timetables.manage', 'Gérer les emplois du temps et le calendrier'],
      ['results.manage', 'Déposer et gérer les résultats'],
      ['results.publish', 'Publier des résultats'],
    ],
  },
  {
    label: 'Vie du département',
    items: [
      ['requests.manage', 'Traiter les demandes administratives'],
      ['activities.manage', 'Gérer les activités scientifiques et professionnelles'],
      ['messages.moderate', 'Superviser la messagerie (signalements)'],
    ],
  },
  {
    label: 'Pilotage',
    items: [
      ['stats.view', 'Voir les statistiques globales'],
      ['stats.personal', 'Voir les statistiques de ses publications'],
      ['audit.view', "Consulter le journal d'activité"],
      ['settings.manage', "Modifier les paramètres de l'application"],
      ['backups.manage', 'Exporter les sauvegardes'],
    ],
  },
];

export const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i[0]));

export function hasPermission(user, permission) {
  if (!user) return false;
  const perms = Array.isArray(user.permissions) ? user.permissions : [];
  return perms.includes('*') || perms.includes(permission);
}

export function hasAny(user, list) {
  return list.some((p) => hasPermission(user, p));
}

export function sanitizePermissions(input) {
  if (!Array.isArray(input)) return [];
  const out = input.filter((p) => typeof p === 'string' && (p === '*' || ALL_PERMISSIONS.includes(p)));
  return [...new Set(out)];
}
