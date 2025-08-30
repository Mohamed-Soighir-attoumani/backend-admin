// backend/utils/visibility.js
function nowWindowFilter() {
  const now = new Date();
  return {
    $and: [
      { $or: [{ startAt: null }, { startAt: { $lte: now } }, { startAt: { $exists: false } }] },
      { $or: [{ endAt: null }, { endAt: { $gte: now } }, { endAt: { $exists: false } }] },
    ],
  };
}

/**
 * Construit un filtre Mongo pour la visibilité.
 * - superadmin sans commune => tout voir
 * - si communeId => global OR local(communeId) OR custom(audienceCommunes contient communeId)
 * - sinon (public / pas de commune) => global uniquement
 */
function buildVisibilityQuery({ communeId, userRole }) {
  const timeFence = nowWindowFilter();

  if (userRole === 'superadmin' && !communeId) {
    return timeFence;
  }

  if (!communeId) {
    return { $and: [timeFence, { visibility: 'global' }] };
  }

  return {
    $and: [
      timeFence,
      {
        $or: [
          { visibility: 'global' },
          { visibility: 'local', communeId },
          { visibility: 'custom', audienceCommunes: communeId },
        ],
      },
    ],
  };
}

module.exports = { buildVisibilityQuery };
