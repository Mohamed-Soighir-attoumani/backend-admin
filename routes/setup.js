const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/User"); // adapte ce chemin si besoin

const router = express.Router();

router.post("/setup-admin", async (req, res) => {
  try {
    const existing = await User.findOne({ email: "admin@email.com" });
    if (existing) {
      return res.status(400).json({ message: "Admin already exists" });
    }

    const hashedPassword = await bcrypt.hash("admin123", 10);

    const admin = new User({
      name: "Super Admin",
      email: "admin@email.com",
      password: hashedPassword,
      role: "admin"
    });

    await admin.save();
    res.status(201).json({ message: "Admin créé avec succès ✅" });
  } catch (err) {
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
});

module.exports = router;
