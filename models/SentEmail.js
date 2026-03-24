import mongoose from 'mongoose';

const sentEmailSchema = new mongoose.Schema({
  subject: { type: String, required: true },
  bodyPreview: { type: String, default: '' },
  recipients: [{ type: String }],
  type: { type: String, enum: ['individual', 'selected', 'newsletter'], required: true },
  sent: { type: Number, default: 0 },
  failed: { type: Number, default: 0 },
  hasImages: { type: Boolean, default: false },
}, { timestamps: true });

sentEmailSchema.index({ createdAt: -1 });

export default mongoose.model('SentEmail', sentEmailSchema);
