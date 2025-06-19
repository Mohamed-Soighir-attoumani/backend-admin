const express = require('express');
const router = express.Router();
const multer = require('multer');
const mongoose = require('mongoose');
const Article = require('../models/Article');

// ✅ Import du storage Cloudinary configuré
const { storage } = require('../utils/cloudinary');
const upload = multer({ storage }); // utilise multer-storage-cloudinary

// ✅ Route POST pour créer un article avec image
router.post('/', upload.single('image'), async (req, res) => {
  try {
    const { title, content } = req.body;
    const imageUrl = req.file ? req.file.path : null; // URL Cloudinary

    const article = new Article({ title, content, imageUrl });
    await article.save();

    res.status(201).json(article);
  } catch (error) {
    console.error('❌ Erreur backend création article :', error);
    res.status(500).json({ message: "Erreur serveur lors de la création" });
  }
});

// 🔍 GET un article par ID
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: 'ID invalide' });
  }

  try {
    const article = await Article.findById(id);
    if (!article) {
      return res.status(404).json({ message: 'Article non trouvé' });
    }

    res.json(article);
  } catch (error) {
    console.error('❌ Erreur récupération article :', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// 🔁 GET tous les articles
router.get('/', async (req, res) => {
  try {
    const articles = await Article.find().sort({ createdAt: -1 });
    res.json(articles);
  } catch (err) {
    console.error('❌ Erreur récupération articles :', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// ✏️ PUT : modifier un article
router.put('/:id', upload.single('image'), async (req, res) => {
  try {
    const article = await Article.findById(req.params.id);
    if (!article) return res.status(404).json({ message: "Article introuvable" });

    article.title = req.body.title || article.title;
    article.content = req.body.content || article.content;

    if (req.file) {
      article.imageUrl = req.file.path; // URL Cloudinary
    }

    await article.save();
    res.json(article);
  } catch (err) {
    console.error("❌ Erreur PUT /api/articles/:id :", err);
    res.status(500).json({ message: "Erreur modification article" });
  }
});

// 🗑️ DELETE : supprimer un article
router.delete('/:id', async (req, res) => {
  try {
    await Article.findByIdAndDelete(req.params.id);
    res.json({ message: '✅ Article supprimé' });
  } catch (error) {
    console.error("❌ Erreur suppression :", error);
    res.status(500).json({ message: 'Erreur suppression article' });
  }
});

module.exports = router;
