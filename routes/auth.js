const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const doc = await User.findOne({ email });
    if (!doc) return res.status(400).json({ message: 'Identifiants invalides' });

    const match = await bcrypt.compare(password, doc.password);
    if (!match) return res.status(400).json({ message: 'Identifiants invalides' });

    if (!doc.isActive) return res.status(403).json({ message: 'Compte désactivé' });

    const payload = {
      id: doc._id.toString(),
      email: doc.email,
      role: doc.role,
      communeId: doc.communeId,
      communeName: doc.communeName,
      tokenVersion: doc.tokenVersion,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '12h' });

    res.json({ token });
  } catch (e) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;
