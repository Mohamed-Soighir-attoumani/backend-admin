// backend/utils/visibility.js
/**
 * Construit un filtre MongoDB pour la visibilité multi-communes.
 * @param {Object} params
 * @param {string}  [params.communeId]
 * @param {string}  [params.userRole]  'admin' | 'superadmin' | null
 * @param {boolean} [params.includeTimeWindow=false]
 * @param {boolean} [params.includeLegacy=false]
 */
function buildVisibilityQuery({
  communeId,
  userRole,
  includeTimeWindow = false,
  includeLegacy = false,
}) {
  const orParts = [];

  if (!communeId) {
    orParts.push({ visibility: 'global' });
    if (userRole === 'admin' || userRole === 'superadmin') {
      orParts.push({ visibility: 'local' });
      orParts.push({ visibility: 'custom' });
    }
  } else {
    orParts.push({ visibility: 'global' });
    orParts.push({ visibility: 'local', communeId });
    orParts.push({ visibility: 'custom', audienceCommunes: communeId });
  }

  if (includeLegacy) {
    orParts.push({ visibility: { $exists: false } });
    orParts.push({ communeId: { $exists: false } });
    orParts.push({ communeId: '' });
  }

  const filter = { $or: orParts };

  if (includeTimeWindow) {
    const now = new Date();
    filter.$and = [
      { $or: [ { startAt: { $exists: false } }, { startAt: null }, { startAt: { $lte: now } } ] },
      { $or: [ { endAt:   { $exists: false } }, { endAt:   null }, { endAt:   { $gte: now } } ] },
    ];
  }

  return filter;
}

module.exports = { buildVisibilityQuery };
