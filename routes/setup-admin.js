// backend/routes/setup-admin.js
const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Commune = require('../models/Commune'); // ⬅️ nécessaire pour canoniser la commune

const router = express.Router();

/* ---------- helpers ---------- */
const norm = (v) => String(v || '').trim().toLowerCase();
const isHex24 = (s) => typeof s === 'string' && /^[a-f0-9]{24}$/i.test(s);

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

async function findCommuneByAny(anyId) {
  const raw = String(anyId ?? '').trim();
  if (!raw) return null;

  // 1) _id
  if (isHex24(raw)) {
    const c = await Commune.findById(raw).lean();
    if (c) return c;
  }
  // 2) slug exact
  let c = await Commune.findOne({ slug: new RegExp(`^${escapeRegExp(raw)}$`, 'i') }).lean();
  if (c) return c;

  // 3) noms possibles
  const nameFields = ['name', 'label', 'communeName', 'nom'];
  for (const f of nameFields) {
    c = await Commune.findOne({ [f]: new RegExp(`^${escapeRegExp(raw)}$`, 'i') }).lean();
    if (c) return c;
  }

  // 4) code
  c = await Commune.findOne({ code: new RegExp(`^${escapeRegExp(raw)}$`, 'i') }).lean();
  if (c) return c;

  return null;
}

/** retourne { key, name } — key = slug (minuscule) si possible, sinon _id string, sinon valeur lowercased */
async function toCanonicalCommune(anyId) {
  const raw = norm(anyId);
  if (!raw) return { key: '', name: '' };
  const c = await findCommuneByAny(raw);
  if (!c) return { key: raw, name: '' };
  const key = norm(c.slug || String(c._id));
  const name = String(c.name ?? c.label ?? c.communeName ?? c.nom ?? '').trim();
  return { key, name };
}

/* ---------- route ---------- */
router.get('/setup-admin', async (req, res) => {
  try {
    /* ===== Superadmin ===== */
    const superEmail = norm(process.env.SUPERADMIN_EMAIL || 'superadmin@mairie.fr');
    const superPlain = process.env.SUPERADMIN_PASSWORD || 'ChangeMoi!2025';

    let superU = await User.findOne({ email: superEmail }).select('_id email role');
    if (!superU) {
      const hash = await bcrypt.hash(superPlain, 10);
      await User.updateOne(
        { email: superEmail },
        { $setOnInsert: { email: superEmail, password: hash, role: 'superadmin', name: 'Super Admin' } },
        { upsert: true }
      );
      superU = await User.findOne({ email: superEmail }).select('_id email role');
    } else if (superU.role !== 'superadmin') {
      superU.role = 'superadmin';
      await superU.save();
    }

    /* ===== Admin par défaut (avec commune canonique) ===== */
    const adminEmail = norm(process.env.ADMIN_EMAIL || 'admin@mairie.fr');
    const adminPlain = process.env.ADMIN_PASSWORD || 'ChangeMoi!2025';

    // On récupère la commune depuis plusieurs variables possibles
    const adminCommuneRaw =
      process.env.ADMIN_COMMUNE_ID ||
      process.env.ADMIN_COMMUNE ||
      process.env.ADMIN_COMMUNE_SLUG ||
      process.env.ADMIN_COMMUNE_NAME ||
      process.env.ADMIN_COMMUNE_CODE ||
      '';

    const canon = await toCanonicalCommune(adminCommuneRaw); // { key, name }

    let adminU = await User.findOne({ email: adminEmail }).select('_id email role communeId communeName');

    if (!adminU) {
      const hash = await bcrypt.hash(adminPlain, 10);
      await User.updateOne(
        { email: adminEmail },
        {
          $setOnInsert: {
            email: adminEmail,
            password: hash,
            role: 'admin',
            name: 'Administrateur',
            communeId: canon.key,           // ⬅️ on pose la commune canonique dès la création
            communeName: canon.name || '',
          }
        },
        { upsert: true }
      );
      adminU = await User.findOne({ email: adminEmail }).select('_id email role communeId communeName');
    } else {
      // s'assure que le rôle est "admin"
      if (adminU.role !== 'admin') {
        adminU.role = 'admin';
        await adminU.save();
      }
      // si on a une commune fournie et que l'admin n'en a pas (ou différente), on met à jour
      if (canon.key && adminU.communeId !== canon.key) {
        await User.updateOne(
          { _id: adminU._id },
          { $set: { communeId: canon.key, communeName: canon.name || adminU.communeName || '' } }
        );
        adminU = await User.findOne({ _id: adminU._id }).select('_id email role communeId communeName');
      }
    }

    return res.json({
      ok: true,
      ensured: {
        superadmin: superU ? {
          id: String(superU._id),
          email: superU.email,
          role: superU.role
        } : null,
        admin: adminU ? {
          id: String(adminU._id),
          email: adminU.email,
          role: adminU.role,
          communeId: adminU.communeId || '',
          communeName: adminU.communeName || ''
        } : null,
      },
      hint: [
        'Connecte-toi avec SUPERADMIN_EMAIL/SUPERADMIN_PASSWORD pour le menu superadmin.',
        'Connecte-toi avec ADMIN_EMAIL/ADMIN_PASSWORD pour voir uniquement les incidents de sa commune.',
        canon.key
          ? `Commune admin (canonique) = "${canon.key}"${canon.name ? ` (${canon.name})` : ''}`
          : '⚠️ Aucune commune fournie pour l’admin (définis ADMIN_COMMUNE_*).',
      ].join(' ')
    });
  } catch (e) {
    console.error('❌ setup-admin error:', e);
    return res.status(500).json({
      ok: false,
      name: e.name,
      code: e.code || null,
      message: e.message,
    });
  }
});

module.exports = router;
