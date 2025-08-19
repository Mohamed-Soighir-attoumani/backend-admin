// backend/routes/debug.js
const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
let Admin = null;
try { Admin = require('../models/Admin'); } catch (_) {}

const auth = require('../middleware/authMiddleware');
const router = express.Router();
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id || '');

router.get('/debug/dbinfo', async (_req, res) => {
  try {
    const conn = mongoose.connection;
    const info = {
      has_env_uri: !!process.env.MONGODB_URI,
      host: conn.host,
      name: conn.name,           // ← nom de la base réellement utilisée (ex: "backend-admin")
      readyState: conn.readyState, // 1 = connecté
    };
    const counts = {
      users: await User.countDocuments().catch(() => null),
      admins: Admin ? await Admin.countDocuments().catch(() => null) : null,
    };
    return res.json({ info, counts });
  } catch (e) {
    console.error('debug dbinfo error', e);
    return res.status(500).json({ message: 'Erreur debug dbinfo' });
  }
});

router.get('/debug/whoami', auth, async (req, res) => {
  try {
    const { id, email, username } = req.user || {};
    const out = { token: { id, email, username }, user: null, admin: null };

    if (id && isValidObjectId(id)) {
      out.user  = await User.findById(id).select('_id email role');
      out.admin = Admin ? await Admin.findById(id).select('_id email role') : null;
    }
    if (!out.user && email) {
      out.user  = await User.findOne({ email }).select('_id email role');
    }
    if (!out.admin && email && Admin) {
      out.admin = await Admin.findOne({ email }).select('_id email role');
    }
    if (!out.user && !out.admin && username === 'admin') {
      const legacyEmail = process.env.ADMIN_EMAIL || 'admin@mairie.fr';
      out.user  = await User.findOne({ email: legacyEmail }).select('_id email role');
      out.admin = Admin ? await Admin.findOne({ email: legacyEmail }).select('_id email role') : null;
    }

    return res.json(out);
  } catch (e) {
    console.error('whoami error', e);
    return res.status(500).json({ message: 'Erreur debug whoami' });
  }
});

module.exports = router;
