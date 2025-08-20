// backend/models/Admin.js
const mongoose = require('mongoose');

const adminSchema = new mongoose.Schema(
  {
    name: { type: String, default: '' },
    email: { type: String, required: true, unique: true, index: true },
    password: { type: String, required: true, select: false },
    role: { type: String, enum: ['admin', 'superadmin'], default: 'admin', index: true },

    communeId: { type: String, default: '', index: true },
    communeName: { type: String, default: '' },

    photo: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Admin', adminSchema);
