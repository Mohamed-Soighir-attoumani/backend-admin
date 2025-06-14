const express = require('express');
const router = express.Router();
const verifyToken = require('../middlewares/verifyToken');


router.get('/', verifyToken, (req, res) => {
  res.json({ message: 'Bienvenue dans le tableau de bord de l’administrateur.' });
});

module.exports = router;
