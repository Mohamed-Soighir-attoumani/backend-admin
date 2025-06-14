// routes/notifications.js
const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const mongoose = require('mongoose');

// Créer une notification
router.post('/', async (req, res) => {
  const { title, message } = req.body;
  if (!title || !message) {
    return res.status(400).json({ message: 'Titre et message requis' });
  }
  try {
    const newNotif = new Notification({ title, message });
    await newNotif.save();
    res.status(201).json(newNotif);
  } catch (err) {
    console.error("❌ Erreur création notification :", err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// Marquer toutes les notifications comme lues
router.patch('/mark-all-read', async (req, res) => {
  console.log("👉 Reçu un PATCH sur /mark-all-read"); // 👈 AJOUTE ICI
  try {
    const result = await Notification.updateMany({}, { isRead: true });
    console.log("Mise à jour effectuée :", result);
    res.status(200).json({ message: "Toutes les notifications ont été marquées comme lues." });
  } catch (err) {
    console.error("❌ Erreur dans mark-all-read :", err);
    res.status(500).json({ message: "Erreur lors du marquage comme lues." });
  }
});


// Modifier une notification  ← ici on enlève l’anti-slash devant :
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const { title, message, isRead } = req.body;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: 'ID invalide' });
  }
  try {
    const updated = await Notification.findByIdAndUpdate(
      id,
      { title, message, isRead },
      { new: true, runValidators: true }
    );
    if (!updated) {
      return res.status(404).json({ message: 'Notification non trouvée' });
    }
    res.json(updated);
  } catch (err) {
    console.error("❌ Erreur modification notification :", err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// Supprimer une notification ← idem, pas d’anti-slash
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: 'ID invalide' });
  }
  try {
    const deleted = await Notification.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ message: 'Notification non trouvée' });
    }
    res.json({ message: 'Notification supprimée avec succès' });
  } catch (err) {
    console.error("❌ Erreur suppression notification :", err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});


// 👉 GET /api/notifications (supporte ?period=7 ou 30 ou vide)
router.get("/", async (req, res) => {
  const { period } = req.query;
  const filter = {};

  if (period === "7" || period === "30") {
    const days = parseInt(period);
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - days);
    filter.createdAt = { $gte: fromDate };
  }

  try {
    const notifications = await Notification.find(filter).sort({ createdAt: -1 });
    res.json(notifications);
  } catch (err) {
    console.error("Erreur récupération notifications:", err);
    res.status(500).json({ message: "Erreur serveur" });
  }
});



// Seed (test)
router.post('/seed', async (req, res) => {
  try {
    const newNotif = new Notification({
      title: 'Notification de test',
      message: '🔔 Ceci est une notification de test.'
    });
    await newNotif.save();
    res.status(201).json(newNotif);
  } catch (err) {
    console.error("❌ Erreur création seed :", err);
    res.status(500).json({ message: 'Erreur création notification' });
  }
});

module.exports = router;
