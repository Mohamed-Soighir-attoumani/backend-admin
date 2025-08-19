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
      name: conn.name,
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

router.get('/debug/admin-indexes', async (_req, res) => {
  try {
    if (!Admin) return res.json({ ok: true, indexes: [], note: 'Modèle Admin absent' });
    const idx = await Admin.collection.indexes();
    return res.json({ ok: true, indexes: idx });
  } catch (e) {
    console.error('debug admin-indexes error', e);
    return res.status(500).json({ ok: false, message: e.message });
  }
});

router.post('/debug/admin-drop-username-index', async (_req, res) => {
  try {
    if (!Admin) return res.status(400).json({ ok: false, message: 'Modèle Admin absent' });
    const exists = (await Admin.collection.indexExists('username_1')) ||
                   (await Admin.collection.indexes()).some(i => i.name === 'username_1');
    if (!exists) return res.json({ ok: true, dropped: false, message: 'Index username_1 non présent' });

    await Admin.collection.dropIndex('username_1');
    return res.json({ ok: true, dropped: true, message: 'Index username_1 supprimé' });
  } catch (e) {
    console.error('drop username index error', e);
    return res.status(500).json({ ok: false, message: e.message });
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
    if (!out.user && email)  out.user  = await User.findOne({ email }).select('_id email role');
    if (!out.admin && email && Admin) out.admin = await Admin.findOne({ email }).select('_id email role');

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
