// backend/routes/actualites.js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

// Données simulées en mémoire
let actualites = [];

// Middleware pour vérifier que l'utilisateur est administrateur
function verifyAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: 'Aucun token fourni' });

  const token = authHeader.split(' ')[1];
  jwt.verify(token, process.env.JWT_SECRET || 'defaultsecret', (err, decoded) => {
    if (err || decoded.role !== 'admin') {
      return res.status(403).json({ message: 'Accès refusé' });
    }
    req.user = decoded;
    next();
  });
}

// Ajouter une actualité
router.post('/', verifyAdmin, (req, res) => {
  const { title, content } = req.body;
  if (!title || !content) {
    return res.status(400).json({ message: 'Champs obligatoires manquants' });
  }
  const actualite = { id: Date.now().toString(), title, content };
  actualites.push(actualite);
  res.json({ message: 'Actualité ajoutée avec succès.', actualite });
});

// Récupérer toutes les actualités (accessible au public)
router.get('/', (req, res) => {
  res.json({ actualites });
});

// Supprimer une actualité
router.delete('/:id', verifyAdmin, (req, res) => {
  const { id } = req.params;
  actualites = actualites.filter(a => a.id !== id);
  res.json({ message: `Actualité ${id} supprimée.` });
});

module.exports = router;
