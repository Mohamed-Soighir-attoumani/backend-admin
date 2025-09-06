// backend/models/Commune.js
const mongoose = require('mongoose');

const CommuneSchema = new mongoose.Schema(
  {
    id: { type: String, trim: true, lowercase: true, unique: true, index: true },
    slug: { type: String, trim: true, lowercase: true, index: true }, // <- PAS unique
    code: { type: String, trim: true },
    name: { type: String, required: true, trim: true },
    communeName: { type: String, trim: true },
    region: { type: String, trim: true },
    imageUrl: { type: String, trim: true },
    photo: { type: String, trim: true },
    createdById: { type: String, trim: true },
    createdByEmail: { type: String, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Commune', CommuneSchema);
