const mongoose = require('mongoose');

const CommuneSchema = new mongoose.Schema({
  // identifiant "stable" côté app/panel (ex: "dembeni")
  id: { type: String, required: true, unique: true, trim: true },
  // nom affiché (ex: "Dembéni")
  name: { type: String, required: true, trim: true },
  // optionnels
  region: { type: String, default: '' },
  imageUrl: { type: String, default: '' }, // pour de jolies vignettes
}, { timestamps: true });

CommuneSchema.index({ id: 1 });
CommuneSchema.index({ name: 'text', id: 'text', region: 'text' });

module.exports = mongoose.model('Commune', CommuneSchema);
