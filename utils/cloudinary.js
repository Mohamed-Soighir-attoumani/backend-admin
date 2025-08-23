// backend/utils/cloudinary.js
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const hasCloudinaryCreds =
  !!process.env.CLOUDINARY_CLOUD_NAME &&
  !!process.env.CLOUDINARY_API_KEY &&
  !!process.env.CLOUDINARY_API_SECRET;

let storage;
let isCloudinaryEnabled = false;

if (hasCloudinaryCreds) {
  const cloudinary = require('cloudinary').v2;
  const { CloudinaryStorage } = require('multer-storage-cloudinary');

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });

  storage = new CloudinaryStorage({
    cloudinary,
    params: async () => ({
      folder: 'incidents',
      resource_type: 'auto',
      use_filename: true,
      unique_filename: true,
    }),
  });

  isCloudinaryEnabled = true;
  console.log('[cloudinary] enabled ✅');
} else {
  // Fallback disque: /uploads/media
  const uploadDir = path.join(__dirname, '..', 'uploads', 'media');
  fs.mkdirSync(uploadDir, { recursive: true });

  storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const extFromName = path.extname(file.originalname || '');
      let ext = extFromName || '';
      if (!ext) {
        // petit mapping si pas d’extension dans le nom
        const mt = (file.mimetype || '').toLowerCase();
        if (mt.includes('jpeg')) ext = '.jpg';
        else if (mt.includes('png')) ext = '.png';
        else if (mt.includes('mp4')) ext = '.mp4';
      }
      const name = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
      cb(null, name);
    },
  });

  console.warn('[cloudinary] disabled ❌ (no credentials) – using disk storage');
}

module.exports = { storage, isCloudinaryEnabled };
