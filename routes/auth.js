const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const router = express.Router();
const Admin = require('../models/Admin'); // le modèle Mongoose

const JWT_SECRET = process.env.JWT_SECRET || 'defaultsecret';

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

    const token = jwt.sign(
      { id: admin._id, email: admin.email, role: admin.role },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.json({ token });

  } catch (error) {
    console.error("❌ Erreur serveur :", error.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;
