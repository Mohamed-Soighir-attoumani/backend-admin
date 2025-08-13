// backend/routes/auth.js
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Admin = require('../models/Admin');

const router = express.Router();

function getJwtSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET non défini côté serveur');
  return s;
}

// POST /api/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  try {
    const admin = await Admin.findOne({ email });
    if (!admin) {
      return res.status(401).json({ message: 'Identifiants invalides' });
    }

    const ok = await bcrypt.compare(password, admin.password);
    if (!ok) {
      return res.status(401).json({ message: 'Identifiants invalides' });
    }

    const token = jwt.sign(
      { id: admin._id.toString(), role: admin.role || 'admin', email: admin.email },
      getJwtSecret(),
      { expiresIn: '7d' }
    );

    return res.json({ token });
  } catch (err) {
    console.error('❌ /login:', err);
    return res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;
