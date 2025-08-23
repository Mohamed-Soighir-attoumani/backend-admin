const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema({
  installationId: { type: String, required: true, index: true, unique: true },

  // anciens champs legacy (facultatif)
  deviceId: { type: String },

  platform:   { type: String, default: '' }, // 'android' | 'ios' ou legacy string
  brand:      { type: String, default: '' },
  model:      { type: String, default: '' },
  osVersion:  { type: String, default: '' },
  appVersion: { type: String, default: '' },
  pushToken:  { type: String, default: '' },

  firstSeenAt: { type: Date },               // rempli à l’upsert
  lastSeenAt:  { type: Date },               // mis à jour sur /ping et /register

  // optionnels (pour filtres)
  communeId:   { type: String, default: '' },
  communeName: { type: String, default: '' },

  // lien éventuel avec un user
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, {
  timestamps: true, // createdAt / updatedAt auto
});

module.exports = mongoose.model('Device', deviceSchema);
