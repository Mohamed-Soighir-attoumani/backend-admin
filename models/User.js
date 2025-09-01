// backend/models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, default: '' },
    email: {
      type: String,
      required: true,
      unique: true,
      index: true,
      lowercase: true,
      trim: true,
    },
    password: { type: String, required: true, select: false }, // hash
    role: {
      type: String,
      enum: ['user', 'admin', 'superadmin'],
      default: 'user',
      index: true,
    },

    communeId: { type: String, default: '', index: true },
    communeName: { type: String, default: '' },

    photo: { type: String, default: '' },

    subscriptionStatus: {
      type: String,
      enum: ['none', 'active', 'expired'],
      default: 'none',
      index: true,
    },
    subscriptionEndAt: { type: Date, default: null },

    createdBy: { type: String, default: '' },

    isActive: { type: Boolean, default: true, index: true },
    tokenVersion: { type: Number, default: 0 },
  },
  { timestamps: true }
);

userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.password;
    return ret;
  },
});

module.exports = mongoose.model('User', userSchema);
