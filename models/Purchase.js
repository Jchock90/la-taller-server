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
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'refunded'],
    default: 'approved',
  },
  nombre: { type: String, required: true },
  apellido: { type: String, required: true },
  email: { type: String, required: true },
  telefono: { type: String, required: true },
  provincia: { type: String, required: true },
  ciudad: { type: String, required: true },
  codigoPostal: { type: String, required: true },
  items: [purchaseItemSchema],
  total: { type: Number, required: true },
  notes: { type: String, default: '' },
}, { timestamps: true });

export default mongoose.model('Purchase', purchaseSchema);
