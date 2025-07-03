const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, unique: true },
  platform: { type: String },
  appVersion: { type: String },
  registeredAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Device', deviceSchema);
