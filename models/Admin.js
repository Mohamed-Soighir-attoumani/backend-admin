const mongoose = require("mongoose");

const adminSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true }, // En vrai projet, on hash le mot de passe
});

module.exports = mongoose.model("Admin", adminSchema);
