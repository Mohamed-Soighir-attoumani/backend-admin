// backend/models/Invoice.js
const mongoose = require('mongoose');

const invoiceItemSchema = new mongoose.Schema(
  {
    description: { type: String, required: true },
    quantity: { type: Number, default: 1, min: 1 },
    unitPrice: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
  },
  { _id: false }
);

const invoiceSchema = new mongoose.Schema(
  {
    number: { type: String, required: true, unique: true, index: true }, // ex: AMS-20250902-573QK
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    userEmail: { type: String, required: true, index: true },
    customerName: { type: String, default: '' },
    communeId: { type: String, default: '' },
    communeName: { type: String, default: '' },

    items: { type: [invoiceItemSchema], default: [] },

    amount: { type: Number, required: true }, // total TTC
    currency: { type: String, default: 'EUR' },
    method: { type: String, default: '' }, // card|cash|transfer…

    status: { type: String, enum: ['paid', 'unpaid'], default: 'paid', index: true },

    // période d’abonnement concernée
    periodStart: { type: Date, default: null },
    periodEnd: { type: Date, default: null },

    issuedAt: { type: Date, default: Date.now },

    // champ libre pour extensions
    meta: { type: Object, default: {} },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Invoice', invoiceSchema);
