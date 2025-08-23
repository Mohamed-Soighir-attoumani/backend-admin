// backend/utils/cloudinary.js
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const hasCreds =
  !!process.env.CLOUDINARY_CLOUD_NAME &&
  !!process.env.CLOUDINARY_API_KEY &&
  !!process.env.CLOUDINARY_API_SECRET;

let storage;

if (hasCreds) {
  const cloudinary = require('cloudinary').v2;
  const { CloudinaryStorage } = require('multer-storage-cloudinary');

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });

  storage = new CloudinaryStorage({
    cloudinary,
    params: async (_req, file) => {
      const isVideo = (file.mimetype || '').startsWith('video');
      return {
        folder: 'securidem/incidents',
        resource_type: isVideo ? 'video' : 'image',
        // public_id automatique si tu ne précises pas
      };
    },
  });

  console.log('[cloudinary] enabled ✅');
  module.exports = { storage, cloudinary, hasCloudinary: true };
} else {
  const uploadDir = path.join(__dirname, '..', 'uploads');
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      const name = `${Date.now()}-${Math.random().toString(16).slice(2)}${ext || ''}`;
      cb(null, name);
    },
  });

  console.log('[cloudinary] disabled ❌ (no credentials) – using disk storage');
  module.exports = { storage, cloudinary: null, hasCloudinary: false };
}
