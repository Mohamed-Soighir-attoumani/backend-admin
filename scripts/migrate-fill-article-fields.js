// scripts/migrate-fill-article-fields.js
require('dotenv').config();
const mongoose = require('mongoose');
const Article = require('../models/Article');

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const res = await Article.updateMany(
      {
        $or: [
          { publishedAt: { $exists: false } },
          { publishedAt: null }
        ]
      },
      { $set: { publishedAt: new Date() } }
    );
    const res2 = await Article.updateMany(
      {
        $or: [
          { publisher: { $exists: false } },
          { publisher: '' },
          { publisher: null }
        ]
      },
      { $set: { publisher: 'Association Bellevue Dembeni' } }
    );
    console.log('publishedAt filled:', res.modifiedCount, 'publisher filled:', res2.modifiedCount);
  } catch (e) {
    console.error(e);
  } finally {
    await mongoose.disconnect();
  }
})();
