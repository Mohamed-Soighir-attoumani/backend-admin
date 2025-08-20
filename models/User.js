const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    email:       { type: String, required: true, unique: true, index: true },
    password:    { type: String, required: true, select: false },
    role:        { type: String, default: 'admin' },
    name:        { type: String, default: '' },         // ⬅️ nom affichable
    communeName: { type: String, default: '' },         // ⬅️ nom de la commune (optionnel)
    photo:       { type: String, default: '' },         // ⬅️ avatar (optionnel)
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
