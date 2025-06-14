const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const Admin = require('../models/Admin');

const JWT_SECRET = process.env.JWT_SECRET || 'defaultsecret';

router.post('/login', async (req, res) => {
  let { username, password } = req.body;

  console.log("🧪 Tentative de connexion reçue :", { username, password });

  try {
    // Convertir le username en minuscule
    username = username.trim().toLowerCase();

    const admin = await Admin.findOne({ username });

    if (!admin) {
      console.log("❌ Aucun admin trouvé pour :", username);
      return res.status(401).json({ message: 'Identifiants invalides (admin)' });
    }

    if (admin.password !== password) {
      console.log("❌ Mot de passe incorrect :", password, "!=", admin.password);
      return res.status(401).json({ message: 'Identifiants invalides (mot de passe)' });
    }

    console.log("✅ Connexion réussie pour :", admin.username);

    const token = jwt.sign({ username: admin.username }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });

  } catch (error) {
    console.error('❌ Erreur serveur lors de la connexion :', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;
