// backend/utils/cloudinary.js
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    // 🎯 Détermine le type de ressource selon le mimetype
    const isVideo = file.mimetype.startsWith('video');

    return {
      folder: 'securidem',
      resource_type: isVideo ? 'video' : 'image', // 📌 important pour vidéos
      public_id: Date.now() + '-' + file.originalname,
      // 🎯 Optionnel : transformation pour les images uniquement
      transformation: !isVideo
        ? [{ width: 1200, height: 1200, crop: 'limit' }]
        : undefined,
    };
  },
});

module.exports = { cloudinary, storage };
