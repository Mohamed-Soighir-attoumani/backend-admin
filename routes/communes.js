// backend/routes/communes.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const Commune = require('../models/Commune');
const auth = require('../middleware/authMiddleware');
// Si tu as un requireRole, tu peux l’utiliser pour sécuriser d’autres verbes (POST/PUT/DELETE) si besoin
// const requireRole = require('../middleware/requireRole');

const APP_KEY = process.env.MOBILE_APP_KEY || null;

// --- Helpers d’accès ---
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id || '');
const isMobile = (req) => APP_KEY && (req.header('x-app-key') === APP_KEY);

// Auth optionnelle : mobile (x-app-key) passe sans JWT, sinon JWT requis
function authOptional(req, res, next) {
  if (isMobile(req)) return next();
  return auth(req, res, next);
}

// Normalisation de la forme retournée
function shape(c) {
  const id = (c.slug && String(c.slug)) || String(c._id);
  const name = String(c.name ?? c.label ?? c.communeName ?? c.nom ?? 'Commune').trim();
  return {
    id,                // 🟢 identifiant “humain” (slug si dispo, sinon _id)
    slug: c.slug || '',
    name,              // 🟢 nom à afficher
    label: name,       // compat anciens clients
    code: c.code || '',
    // on peut étendre ici si l’app a besoin d’autre chose (imageUrl, region, etc.)
    imageUrl: c.imageUrl || '',
    region: c.region || '',
  };
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * GET /api/communes   (également monté sur /communes)
 * - MOBILE (x-app-key) : public, renvoie un **tableau**
 * - PANEL (JWT)       : renvoie { items: [...] }
 * Query:
 *   - q: filtre plein texte (nom/slug/code)
 */
router.get('/', authOptional, async (req, res) => {
  try {
    // côté panel: s’assurer qu’il est connecté (authOptional a déjà refusé les mobiles non authed)
    if (!isMobile(req) && !req.user) {
      return res.status(401).json({ message: 'Non connecté' });
    }

    const q = String(req.query.q || '').trim();
    const find = {};
    if (q) {
      const rx = new RegExp(escapeRegExp(q), 'i');
      find.$or = [
        { name: rx },
        { label: rx },
        { communeName: rx },
        { nom: rx },
        { slug: rx },
        { code: rx },
      ];
    }

    const list = await Commune.find(find).sort({ name: 1 }).lean();
    const shaped = list.map(shape);

    // 🟢 Mobile: renvoyer un tableau simple (compat Expo/app)
    if (isMobile(req)) return res.json(shaped);

    // 🟢 Panel: renvoyer un objet { items: [...] } (compat front admin)
    return res.json({ items: shaped });
  } catch (e) {
    console.error('GET /communes error:', e);
    return res.status(500).json({ message: 'Erreur serveur' });
  }
});

/**
 * GET /api/communes/:any   (également /communes/:any)
 * - :any peut être _id, slug, nom exact ou code
 * - MOBILE : public si x-app-key
 * - PANEL  : nécessite JWT
 * Réponse:
 *   - MOBILE: objet “plat”
 *   - PANEL : objet “plat” (même shape)
 */
router.get('/:any', authOptional, async (req, res) => {
  try {
    if (!isMobile(req) && !req.user) {
      return res.status(401).json({ message: 'Non connecté' });
    }

    const any = String(req.params.any || '').trim();
    let c = null;

    if (isValidObjectId(any)) {
      c = await Commune.findById(any).lean();
    }
    if (!c) {
      c = await Commune.findOne({
        $or: [
          { slug: new RegExp(`^${escapeRegExp(any)}$`, 'i') },
          { name: new RegExp(`^${escapeRegExp(any)}$`, 'i') },
          { label: new RegExp(`^${escapeRegExp(any)}$`, 'i') },
          { communeName: new RegExp(`^${escapeRegExp(any)}$`, 'i') },
          { nom: new RegExp(`^${escapeRegExp(any)}$`, 'i') },
          { code: new RegExp(`^${escapeRegExp(any)}$`, 'i') },
        ]
      }).lean();
    }
    if (!c) return res.status(404).json({ message: 'Commune introuvable' });

    return res.json(shape(c));
  } catch (e) {
    console.error('GET /communes/:any error:', e);
    return res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;
