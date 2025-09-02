// backend/models/Invoice.js
const mongoose = require('mongoose');

const lineItemSchema = new mongoose.Schema({
  description: { type: String, required: true },
  quantity: { type: Number, default: 1 },
  unitPrice: { type: Number, required: true },
  amount: { type: Number, required: true }, // quantity * unitPrice (arrondi)
}, { _id: false });

const invoiceSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },

  // numéros/état
  number: { type: String, index: true, unique: true }, // ex: INV-2025-000123
  status: { type: String, enum: ['draft', 'unpaid', 'paid', 'canceled'], default: 'unpaid', index: true },

  // montants
  currency: { type: String, default: 'EUR' },
  subtotal: { type: Number, default: 0 },
  taxRate: { type: Number, default: 0 },  // ex 0, 10, 20 (pourcent)
  taxAmount: { type: Number, default: 0 },
  total: { type: Number, default: 0 },

  // lignes
  items: { type: [lineItemSchema], default: [] },

  // dates
  issueDate: { type: Date, default: () => new Date() },
  dueDate: { type: Date, default: null },

  // période d’abonnement
  periodStart: { type: Date, default: null },
  periodEnd:   { type: Date, default: null },

  // plan
  planId: { type: String, default: '' },
  planName: { type: String, default: '' },

  // paiement
  paymentMethod: { type: String, default: '' }, // card|cash|transfer, etc.

  // émetteur (snapshot)
  emitter: {
    title:   { type: String, default: 'Licence Securidem' },
    name:    { type: String, default: 'Association Bellevue Dembeni' },
    siret:   { type: String, default: '913 987 905 00019' },
    address: { type: String, default: '49, Rue Manga Chebane, 97660 Dembeni' },
  },

  // client (snapshot)
  customer: {
    name:        { type: String, default: '' },
    email:       { type: String, default: '' },
    communeId:   { type: String, default: '' },
    communeName: { type: String, default: '' },
  },

  notes: { type: String, default: '' },
  createdBy: { type: String, default: '' }, // id superadmin

}, { timestamps: true });

module.exports = mongoose.model('Invoice', invoiceSchema);
