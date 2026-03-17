import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import Product from '../models/Product.js';
import Purchase from '../models/Purchase.js';
import authMiddleware from '../middleware/auth.js';
import { triggerSync, syncPurchaseToAtlas } from '../syncService.js';

const router = express.Router();

// Configurar multer (almacenamiento en memoria, max 5MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten imágenes'), false);
    }
  },
});

// POST /api/admin/upload - Subir imagen a Cloudinary
router.post('/upload', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se envió ninguna imagen' });
    }

    // Configurar Cloudinary (lazy, después de que dotenv cargue)
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });

    // Si hay una URL anterior de Cloudinary, borrar la imagen vieja
    const oldUrl = req.body.oldUrl;
    console.log('Upload recibido - oldUrl:', oldUrl || '(ninguna)');
    if (oldUrl && oldUrl.includes('res.cloudinary.com')) {
      try {
        const parts = oldUrl.split('/upload/');
        if (parts[1]) {
          const publicId = parts[1].replace(/^v\d+\//, '').replace(/\.[^.]+$/, '');
          await cloudinary.uploader.destroy(publicId);
        }
      } catch (delErr) {
        console.warn('No se pudo borrar imagen anterior:', delErr.message);
      }
    }

    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: 'lataller/productos',
          quality: 'auto',
          fetch_format: 'auto',
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      stream.end(req.file.buffer);
    });

    res.json({ url: result.secure_url });
  } catch (error) {
    console.error('Error subiendo imagen:', error);
    res.status(500).json({ error: 'Error al subir imagen' });
  }
});

// POST /api/admin/delete-image - Borrar imagen de Cloudinary
router.post('/delete-image', authMiddleware, async (req, res) => {
  try {
    const { imageUrl } = req.body;
    if (!imageUrl || !imageUrl.includes('res.cloudinary.com')) {
      return res.json({ ok: true });
    }

    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });

    const parts = imageUrl.split('/upload/');
    if (parts[1]) {
      const publicId = parts[1].replace(/^v\d+\//, '').replace(/\.[^.]+$/, '');
      await cloudinary.uploader.destroy(publicId);
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('Error borrando imagen:', error);
    res.status(500).json({ error: 'Error al borrar imagen' });
  }
});

// POST /api/admin/login - Login de administrador
router.post('/login', async (req, res) => {
  try {
    const { password } = req.body;

    if (!password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Contraseña requerida' });
    }

    const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH;
    if (!adminPasswordHash) {
      return res.status(500).json({ error: 'Configuración de admin incompleta' });
    }

    const isValid = await bcrypt.compare(password, adminPasswordHash);
    if (!isValid) {
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }

    const token = jwt.sign(
      { role: 'admin' },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({ token });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

// GET /api/admin/products - Listar TODOS los productos (incluyendo inactivos)
router.get('/products', authMiddleware, async (req, res) => {
  try {
    const products = await Product.find().sort({ collectionName: 1, order: 1 });
    res.json(products);
  } catch (error) {
    console.error('Error listando productos:', error);
    res.status(500).json({ error: 'Error al listar productos' });
  }
});

// POST /api/admin/products - Crear producto
router.post('/products', authMiddleware, async (req, res) => {
  try {
    const {
      name, price, imageUrl, gallery,
      collectionName, collectionDescription, categoria,
      talles, colores, composicion, fabricacion, cuidados,
      active, order
    } = req.body;

    const product = new Product({
      name, price, imageUrl,
      gallery: gallery || [],
      collectionName,
      collectionDescription: collectionDescription || '',
      categoria: categoria || '',
      talles: talles || [],
      colores: colores || [],
      composicion: composicion || '',
      fabricacion: fabricacion || '',
      cuidados: cuidados || '',
      active: active !== undefined ? active : true,
      order: order || 0,
    });

    await product.save();
    triggerSync();
    res.status(201).json(product);
  } catch (error) {
    console.error('Error creando producto:', error);
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(e => e.message);
      return res.status(400).json({ error: messages.join(', ') });
    }
    res.status(500).json({ error: 'Error al crear producto' });
  }
});

// PUT /api/admin/products/:id - Actualizar producto
router.put('/products/:id', authMiddleware, async (req, res) => {
  try {
    const allowedFields = [
      'name', 'price', 'imageUrl', 'gallery',
      'collectionName', 'collectionDescription', 'categoria',
      'talles', 'colores', 'composicion', 'fabricacion', 'cuidados',
      'active', 'order'
    ];

    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    const product = await Product.findByIdAndUpdate(
      req.params.id,
      updates,
      { returnDocument: 'after', runValidators: true }
    );

    if (!product) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    triggerSync();
    res.json(product);
  } catch (error) {
    console.error('Error actualizando producto:', error);
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(e => e.message);
      return res.status(400).json({ error: messages.join(', ') });
    }
    res.status(500).json({ error: 'Error al actualizar producto' });
  }
});

// DELETE /api/admin/products/:id - Eliminar producto (soft delete)
router.delete('/products/:id', authMiddleware, async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { active: false },
      { returnDocument: 'after' }
    );

    if (!product) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    res.json({ message: 'Producto desactivado', product });
    triggerSync();
  } catch (error) {
    console.error('Error eliminando producto:', error);
    res.status(500).json({ error: 'Error al eliminar producto' });
  }
});

// PUT /api/admin/products/:id/restore - Restaurar producto eliminado
router.put('/products/:id/restore', authMiddleware, async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { active: true },
      { returnDocument: 'after' }
    );

    if (!product) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    res.json({ message: 'Producto restaurado', product });
    triggerSync();
  } catch (error) {
    console.error('Error restaurando producto:', error);
    res.status(500).json({ error: 'Error al restaurar producto' });
  }
});

// DELETE /api/admin/products/:id/permanent - Eliminar producto permanentemente
router.delete('/products/:id/permanent', authMiddleware, async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);

    if (!product) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    res.json({ message: 'Producto eliminado permanentemente' });
    triggerSync();
  } catch (error) {
    console.error('Error eliminando producto permanentemente:', error);
    res.status(500).json({ error: 'Error al eliminar producto' });
  }
});

// ============ VENTAS ============

// GET /api/admin/sales - Listar ventas con filtros
router.get('/sales', authMiddleware, async (req, res) => {
  try {
    const { status, from, to, search, page = 1, limit = 20 } = req.query;

    const filter = {};
    if (status) filter.status = status;
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(to + 'T23:59:59.999Z');
    }
    if (search) {
      const s = search.trim();
      filter.$or = [
        { nombre: { $regex: s, $options: 'i' } },
        { apellido: { $regex: s, $options: 'i' } },
        { email: { $regex: s, $options: 'i' } },
        { orderId: { $regex: s, $options: 'i' } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [sales, total] = await Promise.all([
      Purchase.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      Purchase.countDocuments(filter),
    ]);

    res.json({ sales, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (error) {
    console.error('Error listando ventas:', error);
    res.status(500).json({ error: 'Error al listar ventas' });
  }
});

// GET /api/admin/sales/stats - Estadísticas de ventas
router.get('/sales/stats', authMiddleware, async (req, res) => {
  try {
    const { from, to } = req.query;
    const dateFilter = {};
    if (from || to) {
      dateFilter.createdAt = {};
      if (from) dateFilter.createdAt.$gte = new Date(from);
      if (to) dateFilter.createdAt.$lte = new Date(to + 'T23:59:59.999Z');
    }

    const approvedFilter = { ...dateFilter, status: 'approved' };

    const [totalSales, totalRevenue, topProducts, salesByMonth] = await Promise.all([
      Purchase.countDocuments(approvedFilter),
      Purchase.aggregate([
        { $match: approvedFilter },
        { $group: { _id: null, total: { $sum: '$total' } } },
      ]),
      Purchase.aggregate([
        { $match: approvedFilter },
        { $unwind: '$items' },
        { $group: { _id: '$items.title', qty: { $sum: '$items.quantity' }, revenue: { $sum: { $multiply: ['$items.unit_price', '$items.quantity'] } } } },
        { $sort: { qty: -1 } },
        { $limit: 10 },
      ]),
      Purchase.aggregate([
        { $match: approvedFilter },
        { $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
          count: { $sum: 1 },
          revenue: { $sum: '$total' },
        }},
        { $sort: { _id: 1 } },
      ]),
    ]);

    res.json({
      totalSales,
      totalRevenue: totalRevenue[0]?.total || 0,
      topProducts,
      salesByMonth,
    });
  } catch (error) {
    console.error('Error obteniendo stats:', error);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

// PUT /api/admin/sales/:id/notes - Actualizar notas de una venta
router.put('/sales/:id/notes', authMiddleware, async (req, res) => {
  try {
    const { notes } = req.body;
    const sale = await Purchase.findByIdAndUpdate(
      req.params.id,
      { notes: notes || '' },
      { returnDocument: 'after' }
    );
    if (!sale) return res.status(404).json({ error: 'Venta no encontrada' });
    syncPurchaseToAtlas(sale.toObject());
    res.json(sale);
  } catch (error) {
    console.error('Error actualizando notas:', error);
    res.status(500).json({ error: 'Error al actualizar notas' });
  }
});

// PUT /api/admin/sales/:id/status - Cambiar estado de una venta
router.put('/sales/:id/status', authMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    const valid = ['approved', 'refunded', 'pending', 'in_process', 'rejected'];
    if (!valid.includes(status)) return res.status(400).json({ error: 'Estado inválido' });

    const sale = await Purchase.findByIdAndUpdate(
      req.params.id,
      { status },
      { returnDocument: 'after' }
    );
    if (!sale) return res.status(404).json({ error: 'Venta no encontrada' });
    syncPurchaseToAtlas(sale.toObject());
    res.json(sale);
  } catch (error) {
    console.error('Error actualizando estado:', error);
    res.status(500).json({ error: 'Error al actualizar estado' });
  }
});

// DELETE /api/admin/sales/:id - Eliminar una venta
router.delete('/sales/:id', authMiddleware, async (req, res) => {
  try {
    const sale = await Purchase.findByIdAndDelete(req.params.id);
    if (!sale) return res.status(404).json({ error: 'Venta no encontrada' });

    // Sincronizar eliminación con Atlas
    if (process.env.ATLAS_URI) {
      try {
        const { default: mongoose } = await import('mongoose');
        const atlasConn = await mongoose.createConnection(process.env.ATLAS_URI).asPromise();
        const AtlasPurchase = atlasConn.model('Purchase', Purchase.schema);
        await AtlasPurchase.deleteOne({ orderId: sale.orderId });
        await atlasConn.close();
        console.log(`☁️  Sync: Venta ${sale.orderId} eliminada de Atlas`);
      } catch (syncErr) {
        console.warn('Error sincronizando eliminación:', syncErr.message);
      }
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('Error eliminando venta:', error);
    res.status(500).json({ error: 'Error al eliminar venta' });
  }
});

export default router;
