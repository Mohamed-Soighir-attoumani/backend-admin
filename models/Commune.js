// backend/models/Commune.js
const mongoose = require('mongoose');

const CommuneSchema = new mongoose.Schema(
  {
    name:        { type: String, default: '' },   // Nom affiché
    label:       { type: String, default: '' },   // Alias éventuel
    communeName: { type: String, default: '' },   // Compat
    code:        { type: String, default: '' },   // Code INSEE si dispo
    region:      { type: String, default: '' },
    imageUrl:    { type: String, default: '' },
    slug:        { type: String, required: true, unique: true, index: true }, // clé canonique publique
    active:      { type: Boolean, default: true }, // listée côté mobile si true (ou non défini)
  },
  { timestamps: true }
);

module.exports = mongoose.model('Commune', CommuneSchema);
