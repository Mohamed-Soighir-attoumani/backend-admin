// ✅ === routes/setup.js ===
const express = require("express");
const bcrypt = require("bcryptjs");
const Admin = require("../models/Admin");

const router = express.Router();

// 🔁 Crée ou remplace l’admin
router.post("/setup-admin", async (req, res) => {
  try {
    const existingAdmin = await Admin.findOne({ email: "admin@email.com" });

    const hashedPassword = await bcrypt.hash("admin1234", 10);

    if (existingAdmin) {
      // 🔁 On met à jour le mot de passe
      existingAdmin.password = hashedPassword;
      await existingAdmin.save();
      return res.json({ message: "✅ Admin mis à jour avec succès" });
    }

    const admin = new Admin({
      name: "Super Admin",
      email: "admin@email.com",
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
