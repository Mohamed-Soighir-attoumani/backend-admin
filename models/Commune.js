// backend/models/Commune.js
const mongoose = require('mongoose');

const CommuneSchema = new mongoose.Schema(
  {
    // identifiant court (ex: "dembeni"), pratique pour les URLs
    id: { type: String, trim: true, lowercase: true, unique: true, index: true },
    // IMPORTANT: slug n'est PAS unique (certaines communes peuvent ne pas fournir de slug)
    slug: { type: String, trim: true, lowercase: true, index: true }, // non-unique
    code: { type: String, trim: true }, // ex: code INSEE
    name: { type: String, required: true, trim: true }, // Nom affiché
    communeName: { type: String, trim: true }, // alias si utilisé côté admin
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

// Index conseillés (id unique déjà défini via la propriété unique)
CommuneSchema.index({ slug: 1 }, { unique: false, sparse: true });
CommuneSchema.index({ name: 1 });

module.exports = mongoose.model('Commune', CommuneSchema);
