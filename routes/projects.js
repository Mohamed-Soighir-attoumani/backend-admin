const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const Project = require('../models/Project');

// 📦 Upload configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  },
});
const upload = multer({ storage });

// 📝 POST - Créer un projet
router.post('/', upload.single('image'), async (req, res) => {
  try {
    const { name, description } = req.body;
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;

    const newProject = new Project({
      name,
      description,
      imageUrl,
    });

    const saved = await newProject.save();
    res.status(201).json(saved);
  } catch (err) {
    console.error("Erreur POST projet:", err);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

// 📥 GET - Liste des projets
router.get('/', async (req, res) => {
  try {
    const projects = await Project.find().sort({ createdAt: -1 });
    res.json(projects);
  } catch (err) {
    console.error("Erreur GET projets:", err);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

// 📄 GET - Détail d'un projet par ID
router.get('/:id', async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) {
      return res.status(404).json({ message: 'Projet introuvable' });
    }
    res.json(project);
  } catch (err) {
    console.error("Erreur GET projet par ID :", err);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

// ✏️ PUT - Modifier un projet
router.put('/:id', upload.single('image'), async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: "Projet introuvable" });

    project.name = req.body.name || project.name;
    project.description = req.body.description || project.description;

    if (req.file) {
      project.imageUrl = `/uploads/${req.file.filename}`;
    }

    await project.save();
    res.json(project);
  } catch (err) {
    console.error("Erreur PUT /api/projects/:id :", err);
    res.status(500).json({ message: "Erreur modification projet" });
  }
});

// 🗑️ DELETE - Supprimer un projet
router.delete('/:id', async (req, res) => {
  try {
    const project = await Project.findByIdAndDelete(req.params.id);
    if (!project) {
      return res.status(404).json({ message: 'Projet introuvable' });
    }
    res.json({ message: 'Projet supprimé' });
  } catch (err) {
    console.error("Erreur DELETE /api/projects/:id :", err);
    res.status(500).json({ message: "Erreur suppression projet" });
  }
});

module.exports = router;
