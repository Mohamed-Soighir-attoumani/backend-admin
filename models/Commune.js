const mongoose = require('mongoose');

const CommuneSchema = new mongoose.Schema(
  {
    // identifiant court (ex: "dembeni"), pratique pour les URLs
    id: { type: String, trim: true, lowercase: true, unique: true, index: true },
    slug: { type: String, trim: true, lowercase: true },
    code: { type: String, trim: true }, // ex: code INSEE si besoin
    name: { type: String, required: true, trim: true }, // Nom affiché
    communeName: { type: String, trim: true }, // alias si tu utilises ce champ côté admin
    region: { type: String, trim: true },

    // visuels
    imageUrl: { type: String, trim: true },
    photo: { type: String, trim: true },

    // audit
    createdById: { type: String, trim: true },
    createdByEmail: { type: String, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Commune', CommuneSchema);
