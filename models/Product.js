import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'El nombre es obligatorio'],
    trim: true,
  },
  price: {
    type: String,
    required: [true, 'El precio es obligatorio'],
    trim: true,
  },
  imageUrl: {
    type: String,
    required: [true, 'La imagen principal es obligatoria'],
  },
  gallery: {
    type: [String],
    default: [],
  },
  collectionName: {
    type: String,
    required: [true, 'La colección es obligatoria'],
    trim: true,
  },
  collectionDescription: {
    type: String,
    default: '',
  },
  talles: {
    type: [String],
    default: [],
  },
  colores: {
    type: [String],
    default: [],
  },
  composicion: {
    type: String,
    default: '',
  },
  fabricacion: {
    type: String,
    default: '',
  },
  cuidados: {
    type: String,
    default: '',
  },
  active: {
    type: Boolean,
    default: true,
  },
  order: {
    type: Number,
    default: 0,
  },
}, {
  timestamps: true,
});

const Product = mongoose.model('Product', productSchema);

export default Product;
