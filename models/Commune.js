// backend/models/Commune.js
const mongoose = require('mongoose');

const CommuneSchema = new mongoose.Schema(
  {
    id: { type: String, trim: true, lowercase: true, unique: true, index: true }, // identifiant fonctionnel
    slug: { type: String, trim: true, lowercase: true, index: true },             // NE PAS mettre unique !
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

// IMPORTANT : si un vieux modèle avait créé un index unique sur slug, on l’enlève ici
// (au démarrage, on tentera de drop l’index 'slug_1' si présent)
module.exports = mongoose.model('Commune', CommuneSchema);
