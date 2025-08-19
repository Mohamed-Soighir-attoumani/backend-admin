// backend/models/Admin.js (optionnel)
const mongoose = require("mongoose");

const adminSchema = new mongoose.Schema({
  name:     { type: String, required: true },
  email:    { type: String, required: true, unique: true, index: true },
  password: { type: String, required: true, select: false }, // ✅
  role:     { type: String, default: "admin" },
}, { timestamps: true });

module.exports = mongoose.model("Admin", adminSchema);
