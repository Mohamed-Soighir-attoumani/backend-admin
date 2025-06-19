// models/Article.js
const mongoose = require('mongoose');

const articleSchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: { type: String, required: true },
  imageUrl: { type: String, default: null }, // ✅ pour Cloudinary
}, { timestamps: true });

module.exports = mongoose.model('Article', articleSchema);
