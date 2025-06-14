// models/Notification.js
const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  title: { type: String, required: true },
  message: { type: String, required: true },
  isRead: { type: Boolean, default: false }
}, {
  timestamps: true // ✅ active createdAt et updatedAt automatiquement
});

module.exports = mongoose.model('Notification', notificationSchema);

