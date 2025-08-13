const express = require('express');
const Admin = require('../models/Admin');
const auth = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/me', auth, async (req, res) => {
  try {
    const admin = req.user?.id ? await Admin.findById(req.user.id) : null;
    res.json({
      tokenUser: req.user,                 // { id, email, role, ... }
      foundById: !!admin,
      adminEmail: admin?.email || null,
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

module.exports = router;
