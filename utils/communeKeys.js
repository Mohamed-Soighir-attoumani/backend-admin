// backend/utils/communeKeys.js
const mongoose = require('mongoose');
const Commune = require('../models/Commune');

// Retourne toutes les clés possibles pour une commune (slug + _id)
async function communeKeys(anyId) {
  const raw = (anyId ?? '').toString().trim().toLowerCase();
  if (!raw) return { list: [] };

  const s = new Set([raw]);
  if (mongoose.Types.ObjectId.isValid(raw)) {
    const c = await Commune.findById(raw).lean();
    if (c?.slug) s.add(String(c.slug).trim().toLowerCase());
  } else {
    const c = await Commune.findOne({ slug: raw }).lean();
    if (c?._id) s.add(String(c._id).toLowerCase());
  }
  return { list: [...s] };
}

// Préférer stocker le slug (optionnel ici)
async function preferSlug(rawIdOrSlug) {
  const raw = (rawIdOrSlug ?? '').toString().trim().toLowerCase();
  if (!raw) return '';
  if (mongoose.Types.ObjectId.isValid(raw)) {
    const c = await Commune.findById(raw).lean();
    return c?.slug ? String(c.slug).trim().toLowerCase() : raw;
  }
  return raw;
}

module.exports = { communeKeys, preferSlug };
