// backend/utils/cloudinary.js
const multer = require('multer');

const hasCloudinaryCreds =
  !!process.env.CLOUDINARY_CLOUD_NAME &&
  !!process.env.CLOUDINARY_API_KEY &&
  !!process.env.CLOUDINARY_API_SECRET;

let storage;

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
  console.log('[cloudinary] enabled');
} else {
  // Pas de config cloudinary -> on n’envoie pas le média, mais on n’échoue pas
  storage = multer.memoryStorage();
  console.warn('[cloudinary] disabled (no credentials) – using memoryStorage');
}

module.exports = { storage };
