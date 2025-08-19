// backend/models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, index: true },
    // On ne retourne pas le hash par défaut
    password: { type: String, required: true, select: false },
    role: { type: String, default: 'admin' }, // ajuste si besoin (admin/user)
    // ... autres champs
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
