const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, required: true },
  imageUrl: { type: String }, // image facultative
}, { timestamps: true });

module.exports = mongoose.model('Project', projectSchema);
