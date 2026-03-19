import mongoose from 'mongoose';

const purchaseItemSchema = new mongoose.Schema({
  title: { type: String, required: true },
  unit_price: { type: Number, required: true },
  quantity: { type: Number, required: true },
  talle: { type: String, default: '' },
  color: { type: String, default: '' },
}, { _id: false });

const purchaseSchema = new mongoose.Schema({
  orderId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  paymentId: {
    type: String,
    default: '',
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true,
  },
  status: {
    type: String,
    enum: ['pending', 'in_process', 'approved', 'rejected', 'refunded', 'shipped'],
    default: 'approved',
  },
  nombre: { type: String, required: true },
  apellido: { type: String, required: true },
  email: { type: String, required: true },
  telefono: { type: String, required: true },
  direccion: { type: String, default: '' },
  pisoDepto: { type: String, default: '' },
  codigoPostal: { type: String, required: true },
  provincia: { type: String, required: true },
  ciudad: { type: String, required: true },
  items: [purchaseItemSchema],
  total: { type: Number, required: true },
  trackingUrl: { type: String, default: '' },
  shippedAt: { type: Date },
  notes: { type: String, default: '' },
}, { timestamps: true });

export default mongoose.model('Purchase', purchaseSchema);
