const mongoose = require('mongoose');

const CommuneSchema = new mongoose.Schema({
  name:   { type: String, required: true, trim: true },      // ex: "Dembéni"
  slug:   { type: String, required: true, unique: true },    // ex: "dembeni"
  region: { type: String, default: '' },                     // optionnel
  imageUrl: { type: String, default: '' },                   // optionnel (vignette)
  active: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('Commune', CommuneSchema);
