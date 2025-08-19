// backend/models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, index: true },
    password: { type: String, required: true, select: false },
    role: { type: String, default: 'admin' },
    // name: { type: String }, // si tu veux
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
