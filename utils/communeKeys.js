const mongoose = require("mongoose");
const Commune = require("../models/Commune");

const isObjectId = (id) => mongoose.Types.ObjectId.isValid(String(id || ""));
const norm = (v) => String(v == null ? "" : v).trim().toLowerCase();
const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Recherche tolérante d'une commune :
 * - _id exact
 * - slug/code exact (case-insensitive)
 * - nom (name/label/communeName/nom) exact (case-insensitive)
 */
async function findCommuneByAny(anyId) {
  const raw = String(anyId ?? "").trim();
  if (!raw) return null;

  // 1) _id
  if (isObjectId(raw)) {
    const byId = await Commune.findById(raw).lean();
    if (byId) return byId;
  }

  const rxExact = new RegExp(`^${escapeRegExp(raw)}$`, "i");

  // 2) slug / code
  let c = await Commune.findOne({ slug: rxExact }).lean();
  if (!c) c = await Commune.findOne({ code: rxExact }).lean();
  if (c) return c;

  // 3) name-like fields
  const nameFields = ["name", "label", "communeName", "nom"];
  for (const f of nameFields) {
    c = await Commune.findOne({ [f]: rxExact }).lean();
    if (c) return c;
  }

  return null;
}

/**
 * Retourne toutes les clés pertinentes à matcher côté données (slug + _id).
 * Si l'entrée correspond à une commune connue, on retourne son slug (minuscule) et son _id (string).
 * Sinon, on retourne la valeur normalisée (utile pour compat anciens enregistrements).
 */
async function communeKeys(anyId) {
  const raw = String(anyId ?? "").trim();
  if (!raw) return { list: [] };

  const keys = new Set();
  const c = await findCommuneByAny(raw);

  if (c) {
    const slug = norm(c.slug || c.code || "");
    if (slug) keys.add(slug);
    if (c._id) keys.add(String(c._id)); // NE PAS lowercazer un ObjectId
  } else {
    // on renvoie au moins la valeur normalisée (pour anciens jeux de données non canonisés)
    keys.add(norm(raw));
  }

  return { list: Array.from(keys) };
}

/**
 * Retourne l'identifiant canonique à stocker :
 * - le slug (minuscule) si la commune est connue
 * - sinon, renvoie la valeur normalisée fournie
 */
async function preferSlug(rawIdOrSlugOrName) {
  const raw = String(rawIdOrSlugOrName ?? "").trim();
  if (!raw) return "";

  const c = await findCommuneByAny(raw);
  if (c) {
    const slug = norm(c.slug || c.code || "");
    return slug || String(c._id);
  }

  return norm(raw);
}

module.exports = { communeKeys, preferSlug, findCommuneByAny };
