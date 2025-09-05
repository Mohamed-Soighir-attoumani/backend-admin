// backend/models/Commune.js
const mongoose = require('mongoose');

const CommuneSchema = new mongoose.Schema({
  name:   { type: String, required: true, trim: true },
  slug:   { type: String, required: true, unique: true },
  region: { type: String, default: '' },
  imageUrl: { type: String, default: '' },
  active: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('Commune', CommuneSchema);
