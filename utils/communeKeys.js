const mongoose = require("mongoose");
const Commune = require("../models/Commune");

const isObjectId = (id) => mongoose.Types.ObjectId.isValid(String(id || ""));

/* ---------------- Normalisations & helpers ---------------- */
const norm = (v) => String(v == null ? "" : v).trim().toLowerCase();

/** enlève accents */
const stripAccents = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

/** slugify simple (a-z0-9 + tirets) */
const slugify = (s) =>
  stripAccents(String(s || ""))
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** retire des préfixes “Ville de … / Commune de … / Mairie de …” */
const dropCommonPrefixes = (s) => {
  const x = stripAccents(String(s || "")).toLowerCase().trim();
  return x
    .replace(/^(mairie|ville|commune)\s*(de|du|d'|d’)\s*/i, "")
    .replace(/^(mairie|ville|commune)\s*/i, "");
};

const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* ------------- Recherche tolérante d’une commune ------------- */
async function findCommuneByAny(anyIdOrName) {
  const raw = String(anyIdOrName ?? "").trim();
  if (!raw) return null;

  // 1) _id direct
  if (isObjectId(raw)) {
    const byId = await Commune.findById(raw).lean();
    if (byId) return byId;
  }

  // 2) essais basés sur slug (avec et sans préfixes)
  const s1 = slugify(raw);
  const s2 = slugify(dropCommonPrefixes(raw));
  if (s1) {
    const c = await Commune.findOne({ slug: s1 }).lean();
    if (c) return c;
  }
  if (s2 && s2 !== s1) {
    const c = await Commune.findOne({ slug: s2 }).lean();
    if (c) return c;
  }

  // 3) code exact (case-insensitive, accents ignorés via collation)
  let c = await Commune.findOne({ code: raw })
    .collation({ locale: "fr", strength: 1 })
    .lean();
  if (c) return c;

  // 4) correspondances sur noms (exacts, insensibles aux accents)
  const rxExact = new RegExp(`^${escapeRegExp(raw)}$`, "i");
  const nameFields = ["name", "label", "communeName", "nom"];
  for (const f of nameFields) {
    c = await Commune.findOne({ [f]: rxExact })
      .collation({ locale: "fr", strength: 1 })
      .lean();
    if (c) return c;
  }

  // 5) dernier filet : comparer des "slugs dérivés" des champs de nom
  const all = await Commune.find({}, { slug: 1, code: 1, name: 1, label: 1, communeName: 1, nom: 1 })
    .lean();
  const target = new Set([s1, s2].filter(Boolean));
  for (const it of all) {
    const slugs = new Set([
      it.slug && slugify(it.slug),
      it.code && slugify(it.code),
      it.name && slugify(it.name),
      it.label && slugify(it.label),
      it.communeName && slugify(it.communeName),
      it.nom && slugify(it.nom),
    ].filter(Boolean));
    for (const cand of slugs) {
      if (target.has(cand)) return it;
    }
  }

  return null;
}

/**
 * Retourne toutes les clés "pertinentes" à matcher côté données (slug + _id),
 * ou à défaut la version normalisée de la saisie.
 */
async function communeKeys(anyId) {
  const raw = String(anyId ?? "").trim();
  if (!raw) return { list: [] };

  const keys = new Set();
  const c = await findCommuneByAny(raw);

  if (c) {
    const slug = norm(c.slug || c.code || "");
    if (slug) keys.add(slug);
    if (c._id) keys.add(String(c._id)); // ne pas lowercazer un ObjectId
  } else {
    // on renvoie au moins la valeur normalisée (compat anciens jeux de données)
    keys.add(norm(dropCommonPrefixes(raw)));
    keys.add(slugify(raw));
    keys.add(slugify(dropCommonPrefixes(raw)));
  }

  return { list: Array.from(keys) };
}

/**
 * Retourne l’identifiant canonique à stocker :
 * - le slug (minuscule) si la commune est connue
 * - sinon, la valeur normalisée "slug-like" (sans accents/préfixes)
 */
async function preferSlug(rawIdOrSlugOrName) {
  const raw = String(rawIdOrSlugOrName ?? "").trim();
  if (!raw) return "";

  const c = await findCommuneByAny(raw);
  if (c) {
    const slug = norm(c.slug || c.code || "");
    return slug || String(c._id);
  }

  // Pas trouvée : on génère une clé stable et propre
  const s = slugify(dropCommonPrefixes(raw));
  return s || slugify(raw) || norm(raw);
}

module.exports = {
  communeKeys,
  preferSlug,
  findCommuneByAny,
  slugify,
  stripAccents,
  norm,
};
