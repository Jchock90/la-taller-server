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
          // Quitar transformaciones (ej: w_1200,c_limit,q_auto,f_auto/) y versión (v1234/)
          const publicId = parts[1]
            .replace(/^[a-z_0-9,]+\//, '')  // quitar transformaciones
            .replace(/^v\d+\//, '')          // quitar versión
            .replace(/\.[^.]+$/, '');        // quitar extensión
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
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      stream.end(req.file.buffer);
    });

    // Insertar transformaciones en la URL para servir optimizada desde CDN
    // w_1200: max 1200px ancho (suficiente para desktop), q_auto: calidad automática, f_auto: webp/avif si soporta
    const optimizedUrl = result.secure_url.replace(
      '/upload/',
      '/upload/w_1200,c_limit,q_auto,f_auto/'
    );

    res.json({ url: optimizedUrl });
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
      const publicId = parts[1]
        .replace(/^[a-z_0-9,]+\//, '')
        .replace(/^v\d+\//, '')
        .replace(/\.[^.]+$/, '');
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
    const valid = ['approved', 'refunded', 'pending', 'in_process', 'rejected', 'shipped'];
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

// PUT /api/admin/sales/:id/tracking - Enviar link de seguimiento y marcar como despachado
router.put('/sales/:id/tracking', authMiddleware, async (req, res) => {
  try {
    const { trackingUrl } = req.body;
    if (!trackingUrl || !trackingUrl.trim()) {
      return res.status(400).json({ error: 'El link de seguimiento es obligatorio' });
    }

    const normalizedUrl = trackingUrl.trim().startsWith('http') ? trackingUrl.trim() : `https://${trackingUrl.trim()}`;

    const sale = await Purchase.findByIdAndUpdate(
      req.params.id,
      { trackingUrl: normalizedUrl, status: 'shipped', shippedAt: new Date() },
      { returnDocument: 'after' }
    );
    if (!sale) return res.status(404).json({ error: 'Venta no encontrada' });

    // Enviar email de seguimiento al comprador
    try {
      const nodemailer = (await import('nodemailer')).default;
      const transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: process.env.EMAIL_PORT,
        secure: false,
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
      });

      const itemsList = sale.items.map(i =>
        `<li style="padding:4px 0;color:#555;">${i.title} x${i.quantity}${i.talle ? ` - ${i.talle}` : ''}${i.color ? ` - ${i.color}` : ''}</li>`
      ).join('');

      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: sale.email,
        subject: '¡Tu pedido fue despachado! - La Taller',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
            <h2 style="color:#333;">¡Hola ${sale.nombre}!</h2>
            <p>Tu pedido ya fue <strong>despachado</strong> y está en camino.</p>
            <div style="background:#f8f8f8;border-radius:8px;padding:16px;margin:20px 0;">
              <h3 style="margin:0 0 10px;color:#333;font-size:14px;">Productos:</h3>
              <ul style="margin:0;padding-left:20px;font-size:14px;">${itemsList}</ul>
              <p style="margin:12px 0 0;font-weight:bold;color:#333;">Total: $${sale.total.toLocaleString('es-AR')}</p>
            </div>
            <p>Podés seguir el estado de tu envío haciendo clic en el siguiente botón:</p>
            <div style="text-align:center;margin:25px 0;">
              <a href="${trackingUrl.trim()}" style="background-color:#000;color:#fff;padding:14px 28px;text-decoration:none;border-radius:6px;font-weight:bold;display:inline-block;">
                Seguir mi envío
              </a>
            </div>
            <p style="font-size:12px;color:#999;margin-top:30px;">Si el botón no funciona, copiá y pegá este link en tu navegador:<br/><a href="${trackingUrl.trim()}" style="color:#666;">${trackingUrl.trim()}</a></p>
          </div>
        `,
      });
      console.log('Email de tracking enviado a:', sale.email);
    } catch (emailErr) {
      console.error('Error enviando email de tracking:', emailErr);
      // No falla la request si el email falla — el tracking ya se guardó
    }

    syncPurchaseToAtlas(sale.toObject());
    res.json(sale);
  } catch (error) {
    console.error('Error enviando tracking:', error);
    res.status(500).json({ error: 'Error al enviar seguimiento' });
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
