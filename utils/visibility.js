// backend/utils/visibility.js
function buildVisibilityQuery({ communeId, userRole, ignoreTimeWindow = false }) {
  const now = new Date();

  // Quelles “portées” inclure
  const orParts = [];

  if (!communeId) {
    // Sans filtre de commune :
    // - public: global + anciens (back-compat)
    // - panel (admin/superadmin): TOUT
    orParts.push({ visibility: 'global' });
    orParts.push({ visibility: { $exists: false } }); // back-compat (anciens docs)
    orParts.push({ communeId: { $exists: false } }); // back-compat
    orParts.push({ communeId: '' });                 // back-compat

    if (userRole === 'admin' || userRole === 'superadmin') {
      orParts.push({ visibility: 'local' });
      orParts.push({ visibility: 'custom' });
    }
  } else {
    // Avec filtre de commune :
    orParts.push({ visibility: 'global' });
    orParts.push({ visibility: 'local', communeId });
    orParts.push({ visibility: 'custom', audienceCommunes: communeId });

    // back-compat (anciens docs)
    orParts.push({ visibility: { $exists: false } });
    orParts.push({ communeId: { $exists: false } });
    orParts.push({ communeId: '' });
  }

  const filter = { $or: orParts };

  // Fenêtre d’affichage (uniquement pour public/mobile)
  if (!ignoreTimeWindow) {
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
