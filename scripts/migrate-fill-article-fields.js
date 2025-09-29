require('dotenv').config();
const mongoose = require('mongoose');
const Article = require('../models/Article');

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    // 1) Normalise d’anciens communeId ObjectId -> String (si besoin)
    //    (nécessite MongoDB 4.0+ pour l’aggregation pipeline dans updateMany)
    try {
      await mongoose.connection.db.collection('articles').updateMany(
        { communeId: { $type: "objectId" } },
        [ { $set: { communeId: { $toString: "$communeId" } } } ]
      );
      console.log('✅ communeId normalisés (ObjectId -> String)');
    } catch (e) {
      console.warn('ℹ️ Impossible de convertir communeId via pipeline (ancienne version MongoDB ?).', e.message);
      // fallback "manuel" si nécessaire
      const cursor = Article.find({ communeId: { $type: 'objectId' } }).cursor();
      let n = 0;
      for await (const a of cursor) {
        a.communeId = String(a.communeId);
        await a.save();
        n++;
      }
      if (n) console.log(`✅ communeId normalisés (fallback): ${n}`);
    }

    // 2) Complète publishedAt si manquant
    const res1 = await Article.updateMany(
      { $or: [ { publishedAt: { $exists: false } }, { publishedAt: null } ] },
      { $set: { publishedAt: new Date() } }
    );

    // 3) Complète publisher si manquant
    const res2 = await Article.updateMany(
      { $or: [ { publisher: { $exists: false } }, { publisher: '' }, { publisher: null } ] },
      { $set: { publisher: 'Association Bellevue Dembeni' } }
    );

    // 4) Complète status si manquant
    const res3 = await Article.updateMany(
      { status: { $exists: false } },
      { $set: { status: 'published' } }
    );

    console.log('publishedAt filled:', res1.modifiedCount);
    console.log('publisher filled:', res2.modifiedCount);
    console.log('status filled:', res3.modifiedCount);

    await mongoose.disconnect();
    process.exit(0);
  } catch (e) {
    console.error(e);
    try { await mongoose.disconnect(); } catch(_) {}
    process.exit(1);
  }
})();
