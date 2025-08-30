// backend/utils/visibility.js

/**
 * Construit un filtre MongoDB pour la visibilité multi-communes.
 *
 * @param {Object} params
 * @param {string}  [params.communeId]           - Commune ciblée (vide = pas de filtre de commune)
 * @param {string}  [params.userRole]            - 'admin' | 'superadmin' | 'user' | null
 * @param {boolean} [params.includeTimeWindow]   - Ajoute la fenêtre d'affichage (startAt/endAt). Par défaut: false
 * @param {boolean} [params.includeLegacy]       - Inclut les anciens documents (sans visibility/communeId). Par défaut: false
 *
 * @returns {Object} filtre MongoDB
 */
function buildVisibilityQuery({
  communeId,
  userRole,
  includeTimeWindow = false,
  includeLegacy = false,
}) {
  const orParts = [];

  if (!communeId) {
    // Sans commune ciblée :
    // - toujours visibles: global
    orParts.push({ visibility: 'global' });

    // Panel (admin/superadmin) : on autorise aussi local/custom
    if (userRole === 'admin' || userRole === 'superadmin') {
      orParts.push({ visibility: 'local' });
      orParts.push({ visibility: 'custom' });
    }
  } else {
    // Avec commune ciblée :
    orParts.push({ visibility: 'global' });
    orParts.push({ visibility: 'local', communeId });
    orParts.push({ visibility: 'custom', audienceCommunes: communeId });
  }

  // Back-compat (anciens documents) : activable au besoin
  if (includeLegacy) {
    orParts.push({ visibility: { $exists: false } });
    orParts.push({ communeId: { $exists: false } });
    orParts.push({ communeId: '' });
  }

  const filter = { $or: orParts };

  // Fenêtre d'affichage (facultatif, utile côté public/mobile)
  if (includeTimeWindow) {
    const now = new Date();
    filter.$and = [
      {
        $or: [
          { startAt: { $exists: false } },
          { startAt: null },
          { startAt: { $lte: now } },
        ],
      },
      {
        $or: [
          { endAt: { $exists: false } },
          { endAt: null },
          { endAt: { $gte: now } },
        ],
      },
    ];
  }

  return filter;
}

module.exports = { buildVisibilityQuery };
