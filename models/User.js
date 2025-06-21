const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  // d'autres champs si besoin
});

module.exports = mongoose.model('User', userSchema);
