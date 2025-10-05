// backend/models/Commune.js
const mongoose = require('mongoose');

const communeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    label: { type: String, trim: true, default: '' },
    communeName: { type: String, trim: true, default: '' },
    code: { type: String, trim: true, default: '' },
    region: { type: String, trim: true, default: '' },
    imageUrl: { type: String, trim: true, default: '' },

    // ⚑ clé canonique utilisée par le panel/app comme "communeId"
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Commune', communeSchema);
