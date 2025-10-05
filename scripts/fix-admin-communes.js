// scripts/fix-admin-communes.js (à lancer une fois)
const mongoose = require('mongoose');
const User = require('../models/User');

// Choisis la commune par défaut à mettre si vide
const DEFAULT_COMMUNE_ID = 'dembeni';
const DEFAULT_COMMUNE_NAME = 'Dembéni';

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const res = await User.updateMany(
    { role: 'admin', $or: [ { communeId: { $exists: false } }, { communeId: '' } ] },
    { $set: { communeId: DEFAULT_COMMUNE_ID, communeName: DEFAULT_COMMUNE_NAME } }
  );
  console.log('Admins fixés:', res.modifiedCount);
  await mongoose.disconnect();
})();
