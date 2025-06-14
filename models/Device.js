// backend/models/Device.js
const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, unique: true },
  platform: { type: String }, // 'android', 'ios', 'web'...
  appVersion: { type: String },
  registeredAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Device', deviceSchema);
