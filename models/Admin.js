const mongoose = require("mongoose");

const adminSchema = new mongoose.Schema({
  name:        { type: String, required: true },        // ex. "Mairie de X" ou nom de l'admin
  email:       { type: String, required: true, unique: true, index: true },
  password:    { type: String, required: true, select: false },
  role:        { type: String, default: "admin" },
  communeName: { type: String, default: "" },           // ⬅️ NOM DE LA COMMUNE (optionnel)
  photo:       { type: String, default: "" },           // URL / chemin image (optionnel)
}, { timestamps: true });

module.exports = mongoose.model("Admin", adminSchema);
