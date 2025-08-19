// backend/routes/me.js
const express = require('express');
const auth = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/me', auth, (req, res) => {
  return res.json({ user: req.user });
});

module.exports = router;
