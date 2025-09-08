const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    title:   { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    isRead:  { type: Boolean, default: false },

    // Multi-commune
    visibility:       { type: String, enum: ['local', 'global', 'custom'], default: 'local', index: true },
    communeId:        { type: String, default: '', index: true },
    audienceCommunes: { type: [String], default: [], index: true },

    // Options
    priority: { type: String, enum: ['normal', 'pinned', 'urgent'], default: 'normal', index: true },
    startAt:  { type: Date, default: null, index: true },
    endAt:    { type: Date, default: null, index: true },

    // Auteur
    authorId:    { type: String, default: '', index: true },
    authorEmail: { type: String, default: '' },
  },
  { timestamps: true }
);

notificationSchema.index({ visibility: 1, communeId: 1 });
notificationSchema.index({ visibility: 1, audienceCommunes: 1 });
notificationSchema.index({ createdAt: -1 });

/** 🔧 Normalisation BEFORE save (source of truth) */
notificationSchema.pre('validate', function (next) {
  // communeId en lower-case trim
  if (typeof this.communeId === 'string') {
    this.communeId = this.communeId.trim().toLowerCase();
  }
  // audienceCommunes: lower-case + trim + unique
  if (Array.isArray(this.audienceCommunes)) {
    const normed = this.audienceCommunes
      .map((s) => String(s || '').trim().toLowerCase())
      .filter(Boolean);
    this.audienceCommunes = Array.from(new Set(normed));
  }
  next();
});

module.exports = mongoose.model('Notification', notificationSchema);
