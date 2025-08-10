const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, unique: true },
  platform: { type: String },            // ex: "samsung/SM-A055F/14"
  appVersion: { type: String },          // ex: "1.0.0"
  registeredAt: { type: Date, default: Date.now },
  lastSeen: { type: Date, default: Date.now }, // dernière fois vu
  lastIp: { type: String },               // IP pour debug ou stats
}, { timestamps: true });                 // createdAt/updatedAt auto

module.exports = mongoose.model('Device', deviceSchema);
