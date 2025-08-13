// backend/routes/auth.js
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Admin = require('../models/Admin');
const { getJwtSecret } = require('../utils/jwt');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
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

    res.json({ token });
  } catch (err) {
    console.error('Erreur /login :', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;
