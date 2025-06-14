const mongoose = require('mongoose');

const articleSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    imageUrl: {
      type: String,
      default: '', // facultatif
    },
  },
  { timestamps: true } // pour createdAt et updatedAt
);

module.exports = mongoose.model('Article', articleSchema);
