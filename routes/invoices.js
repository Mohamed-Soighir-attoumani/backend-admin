// backend/routes/invoices.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const auth = require('../middleware/authMiddleware');
const requireRole = require('../middleware/requireRole');
const User = require('../models/User');
const Invoice = require('../models/Invoice');
const { streamInvoicePdf } = require('../utils/invoicePdf');

const norm = (v) => String(v || '').trim().toLowerCase();

// Génère un numéro unique simple : INV-YYYY-###### (timestamp)
function genInvoiceNumber() {
  const y = new Date().getFullYear();
  const seq = Date.now().toString().slice(-6);
  return `INV-${y}-${seq}`;
}

/** Création manuelle d'une facture (superadmin) */
router.post('/invoices', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const {
      userId, items = [], currency = 'EUR',
      taxRate = 0,
      issueDate = new Date(),
      dueDate = null,
      periodStart = null,
      periodEnd = null,
      planId = '', planName = '',
      paymentMethod = '', notes = '',
      emitter = null, // si tu veux override l’émetteur
      status = 'unpaid',
    } = req.body || {};

    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: 'userId invalide' });
    }

    const u = await User.findById(userId).select('name email communeId communeName');
    if (!u) return res.status(404).json({ message: 'Utilisateur introuvable' });

    // calcul montants
    const normItems = (Array.isArray(items) ? items : []).map(it => {
      const q = Math.max(0, Number(it.quantity || 1));
      const pu = Number(it.unitPrice || it.unit || it.price || 0);
      const amt = Math.round(q * pu * 100) / 100;
      return {
        description: String(it.description || it.desc || 'Licence Securidem'),
        quantity: q,
        unitPrice: pu,
        amount: amt,
      };
    });

    const subtotal = normItems.reduce((s, it) => s + (Number(it.amount) || 0), 0);
    const taxAmount = Math.round(subtotal * (Number(taxRate || 0) / 100) * 100) / 100;
    const total = Math.round((subtotal + taxAmount) * 100) / 100;

    const inv = await Invoice.create({
      userId: u._id,
      number: genInvoiceNumber(),
      status,
      currency,
      subtotal,
      taxRate: Number(taxRate || 0),
      taxAmount,
      total,
      items: normItems,
      issueDate: issueDate ? new Date(issueDate) : new Date(),
      dueDate: dueDate ? new Date(dueDate) : null,
      periodStart: periodStart ? new Date(periodStart) : null,
      periodEnd: periodEnd ? new Date(periodEnd) : null,
      planId,
      planName,
      paymentMethod,
      emitter: emitter && typeof emitter === 'object' ? {
        title: emitter.title || undefined,
        name: emitter.name || undefined,
        siret: emitter.siret || undefined,
        address: emitter.address || undefined,
      } : undefined,
      customer: {
        name: u.name || '',
        email: u.email || '',
        communeId: u.communeId || '',
        communeName: u.communeName || '',
      },
      notes: notes || '',
      createdBy: String(req.user.id || ''),
    });

    return res.status(201).json({
      ok: true,
      invoice: {
        id: String(inv._id),
        number: inv.number,
        issueDate: inv.issueDate,
        total: inv.total,
        currency: inv.currency,
        status: inv.status,
        url: `/api/invoices/${inv._id}/pdf`,
      },
    });
  } catch (e) {
    console.error('❌ POST /api/invoices', e);
    return res.status(500).json({ message: 'Erreur serveur' });
  }
});

/** Liste des factures d’un utilisateur (superadmin) */
router.get('/users/:id/invoices', auth, requireRole('superadmin'), async (req, res) => {
  try {
    const uid = req.params.id;
    if (!uid || !mongoose.Types.ObjectId.isValid(uid)) {
      return res.status(400).json({ message: 'ID invalide' });
    }
    const list = await Invoice.find({ userId: uid }).sort({ issueDate: -1 }).lean();
    return res.json({
      invoices: list.map(f => ({
        id: String(f._id),
        number: f.number,
        amount: f.total,
        currency: f.currency,
        status: f.status === 'paid' ? 'paid' : 'unpaid',
        date: f.issueDate,
        url: `/api/invoices/${f._id}/pdf`,
      })),
    });
  } catch (e) {
    console.error('❌ GET /api/users/:id/invoices', e);
    return res.status(500).json({ message: 'Erreur serveur' });
  }
});

/** Mes factures (utilisateur connecté) */
router.get('/my-invoices', auth, async (req, res) => {
  try {
    const uid = req.user?.id;
    const list = await Invoice.find({ userId: uid }).sort({ issueDate: -1 }).lean();
    return res.json({
      invoices: list.map(f => ({
        id: String(f._id),
        number: f.number,
        amount: f.total,
        currency: f.currency,
        status: f.status,
        date: f.issueDate,
        url: `/api/invoices/${f._id}/pdf`,
      })),
    });
  } catch (e) {
    console.error('❌ GET /api/my-invoices', e);
    return res.status(500).json({ message: 'Erreur serveur' });
  }
});

/** PDF d’une facture — accessible par superadmin OU propriétaire */
router.get('/invoices/:id/pdf', auth, async (req, res) => {
  try {
    const inv = await Invoice.findById(req.params.id).lean();
    if (!inv) return res.status(404).json({ message: 'Facture introuvable' });

    const isOwner = String(inv.userId) === String(req.user.id);
    const isSuper = String(req.user.role || '').toLowerCase() === 'superadmin';
    if (!isOwner && !isSuper) {
      return res.status(403).json({ message: 'Accès interdit' });
    }

    streamInvoicePdf(inv, res);
  } catch (e) {
    console.error('❌ GET /api/invoices/:id/pdf', e);
    return res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;
