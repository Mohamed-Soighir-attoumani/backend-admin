// scripts/migrate-fill-article-fields.js
require('dotenv').config();
const mongoose = require('mongoose');
const Article = require('../models/Article');

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    // Convertir d’anciens communeId ObjectId -> String (si présent)
    try {
      await mongoose.connection.db.collection('articles').updateMany(
        { communeId: { $type: 'objectId' } },
        [ { $set: { communeId: { $toString: '$communeId' } } } ]
      );
      console.log('communeId ObjectId -> String : OK');
    } catch (e) {
      console.log('Skip communeId type migration (Mongo <4.2 ?)', e.message);
    }

    const res = await Article.updateMany(
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

    console.log(
      'publishedAt filled:', res.modifiedCount,
      '| publisher filled:', res2.modifiedCount,
      '| status filled:', res3.modifiedCount
    );
  } catch (e) {
    console.error(e);
  } finally {
    await mongoose.disconnect();
  }
})();
