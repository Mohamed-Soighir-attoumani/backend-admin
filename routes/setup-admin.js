// routes/setup-admin.js
const express = require("express");
const bcrypt = require("bcryptjs");
const Admin = require("../models/Admin");

const router = express.Router();

// Crée ou met à jour un admin
router.post("/setup-admin", async (req, res) => {
  try {
    const email = "admin@email.com";
    const plainPassword = "admin123";
    const hashedPassword = await bcrypt.hash(plainPassword, 10);

    const existingAdmin = await Admin.findOne({ email });

    if (existingAdmin) {
      existingAdmin.password = hashedPassword;
      await existingAdmin.save();
      return res.json({ message: "✅ Admin mis à jour avec succès" });
    }

    const admin = new Admin({
      name: "Super Admin",
      email,
      password: hashedPassword,
      role: "admin",
    });

    await admin.save();
    res.json({ message: "✅ Admin créé avec succès" });
  } catch (err) {
    console.error("❌ Erreur dans setup-admin:", err.message);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

module.exports = router;
