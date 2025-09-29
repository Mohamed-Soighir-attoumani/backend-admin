// scripts/migrate-fill-article-fields.js
require('dotenv').config();
const mongoose = require('mongoose');
const Article = require('../models/Article');

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    // Convertit d'anciens communeId ObjectId -> String (si besoin)
    await mongoose.connection.db.collection('articles').updateMany(
      { communeId: { $type: "objectId" } },
      [ { $set: { communeId: { $toString: "$communeId" } } } ]
    );

    const res1 = await Article.updateMany(
      { $or: [ { publishedAt: { $exists: false } }, { publishedAt: null } ] },
      { $set: { publishedAt: new Date() } }
    );
    const res2 = await Article.updateMany(
      { $or: [ { publisher: { $exists: false } }, { publisher: '' }, { publisher: null } ] },
      { $set: { publisher: 'Association Bellevue Dembeni' } }
    );
    const res3 = await Article.updateMany(
      { status: { $exists: false } },
      { $set: { status: 'published' } }
    );

    console.log('publishedAt filled:', res1.modifiedCount);
    console.log('publisher filled:', res2.modifiedCount);
    console.log('status filled:', res3.modifiedCount);

    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    try { await mongoose.disconnect(); } catch (_) {}
  }
})();
