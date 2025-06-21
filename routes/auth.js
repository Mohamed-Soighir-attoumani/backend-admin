// ✅ backend/routes/auth.js
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Admin = require('../models/Admin');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'defaultsecret';

// Route POST /api/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  console.log("🧪 Tentative de connexion :", { email });

  try {
    const admin = await Admin.findOne({ email });

    if (!admin) {
      console.log("❌ Aucun admin trouvé pour :", email);
      return res.status(401).json({ message: 'Identifiants invalides (admin)' });
    }

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      console.log("❌ Mot de passe incorrect pour :", email);
      return res.status(401).json({ message: 'Identifiants invalides (mot de passe)' });
    }

    console.log("✅ Connexion réussie :", email);

    // ✅ Le token contient le champ `id` pour fonctionner avec authMiddleware
    const token = jwt.sign(
      { id: admin._id, email: admin.email, role: admin.role },
      JWT_SECRET,
      { expiresIn: '7d' } // durée ajustée à 7 jours pour une session longue
    );

    res.json({ token });

  } catch (error) {
    console.error("❌ Erreur serveur :", error.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;
