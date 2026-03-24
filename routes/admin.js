import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { getTransporter, getFromAddress } from '../config/mailer.js';
import { v2 as cloudinary } from 'cloudinary';
import Product from '../models/Product.js';
import Purchase from '../models/Purchase.js';
import User from '../models/User.js';
import SentEmail from '../models/SentEmail.js';
import authMiddleware from '../middleware/auth.js';
import { triggerSync, syncPurchaseToAtlas, syncSentEmailToAtlas, deleteSentEmailFromAtlas } from '../syncService.js';

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

    const approvedFilter = { ...dateFilter, status: { $in: ['approved', 'shipped'] } };

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
      const transporter = getTransporter();

      const itemsList = sale.items.map(i =>
        `<li style="padding:4px 0;color:#555;">${i.title} x${i.quantity}${i.talle ? ` - ${i.talle}` : ''}${i.color ? ` - ${i.color}` : ''}</li>`
      ).join('');

      await transporter.sendMail({
        from: getFromAddress(),
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

// ────────── EMAIL ENDPOINTS ──────────

function buildEmailHtml(subject, body, footerText, richHtml) {
  const content = richHtml
    ? richHtml
    : `<div style="color:#555;font-size:15px;line-height:1.7;white-space:pre-line;">${body}</div>`;
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;text-align:left;">
      <h2 style="color:#333;text-align:left;">${subject}</h2>
      ${content}
      ${footerText ? `<p style="font-size:12px;color:#999;margin-top:30px;border-top:1px solid #eee;padding-top:15px;text-align:left;">${footerText}</p>` : ''}
      <p style="font-size:11px;color:#bbb;margin-top:20px;text-align:left;">— La Taller</p>
    </div>
  `;
}

// POST /api/admin/email/send - Enviar email individual o masivo
router.post('/email/send', authMiddleware, async (req, res) => {
  try {
    const { to, subject, body, html, attachments: clientAttachments, type } = req.body;

    if (!subject || !subject.trim()) {
      return res.status(400).json({ error: 'El asunto es obligatorio' });
    }
    if (!body && !html) {
      return res.status(400).json({ error: 'El cuerpo del mensaje es obligatorio' });
    }

    const transporter = getTransporter();
    const emailHtml = buildEmailHtml(subject.trim(), body ? body.trim() : '', type === 'newsletter' ? 'Recibiste este email porque estás registrado en La Taller.' : '', html || null);

    // Convert base64 data URIs to CID inline attachments for nodemailer
    const cidAttachments = (clientAttachments || []).map(att => {
      const commaIdx = att.dataUri.indexOf(',');
      const header = att.dataUri.slice(0, commaIdx);
      const base64Data = att.dataUri.slice(commaIdx + 1);
      const mimeMatch = header.match(/data:(image\/[^;]+);/);
      const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
      const ext = mimeType.split('/')[1];
      return {
        filename: `${att.cid}.${ext}`,
        content: Buffer.from(base64Data, 'base64'),
        cid: att.cid,
        contentType: mimeType,
        contentDisposition: 'inline',
      };
    });

    let recipients = [];

    if (type === 'newsletter') {
      const users = await User.find({ emailVerified: true }).select('email');
      recipients = users.map(u => u.email);
      if (recipients.length === 0) {
        return res.status(400).json({ error: 'No hay usuarios registrados para enviar' });
      }
    } else if (type === 'individual') {
      if (!to || !to.trim()) {
        return res.status(400).json({ error: 'El destinatario es obligatorio' });
      }
      recipients = [to.trim()];
    } else if (type === 'selected') {
      if (!Array.isArray(to) || to.length === 0) {
        return res.status(400).json({ error: 'Selecciona al menos un destinatario' });
      }
      recipients = to.map(e => e.trim()).filter(Boolean);
    } else {
      return res.status(400).json({ error: 'Tipo de envío inválido' });
    }

    let sent = 0;
    let failed = 0;
    const errors = [];

    for (let i = 0; i < recipients.length; i += 5) {
      const batch = recipients.slice(i, i + 5);
      const results = await Promise.allSettled(
        batch.map(email =>
          transporter.sendMail({
            from: getFromAddress(),
            to: email,
            subject: subject.trim(),
            html: emailHtml,
            attachments: cidAttachments,
          })
        )
      );
      results.forEach((r, idx) => {
        if (r.status === 'fulfilled') {
          sent++;
        } else {
          failed++;
          errors.push({ email: batch[idx], error: r.reason?.message || 'Error desconocido' });
        }
      });
    }

    // Save to email history
    try {
      const savedEmail = await SentEmail.create({
        subject: subject.trim(),
        bodyPreview: (body || '').slice(0, 200),
        recipients,
        type,
        sent,
        failed,
        hasImages: cidAttachments.length > 0,
      });
      syncSentEmailToAtlas(savedEmail.toObject());
    } catch (histErr) {
      console.error('Error guardando historial de email:', histErr);
    }

    console.log(`Email enviado: ${sent} exitosos, ${failed} fallidos (tipo: ${type})`);
    res.json({ sent, failed, total: recipients.length, errors: errors.slice(0, 10) });
  } catch (error) {
    console.error('Error enviando email:', error);
    res.status(500).json({ error: 'Error al enviar email' });
  }
});

// GET /api/admin/email/sent - Historial de emails enviados
router.get('/email/sent', authMiddleware, async (req, res) => {
  try {
    const emails = await SentEmail.find()
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.json(emails);
  } catch (error) {
    console.error('Error obteniendo historial:', error);
    res.status(500).json({ error: 'Error al obtener historial' });
  }
});

// DELETE /api/admin/email/sent/:id - Eliminar email del historial
router.delete('/email/sent/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await SentEmail.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ error: 'Email no encontrado' });
    deleteSentEmailFromAtlas(id);
    res.json({ ok: true });
  } catch (error) {
    console.error('Error eliminando email:', error);
    res.status(500).json({ error: 'Error al eliminar email' });
  }
});

// GET /api/admin/email/recipients - Obtener lista de destinatarios posibles
router.get('/email/recipients', authMiddleware, async (req, res) => {
  try {
    const users = await User.find().select('nombre apellido email googleId emailVerified').lean();
    // También agregar compradores sin cuenta (emails únicos de purchases que no son users)
    const userEmails = new Set(users.map(u => u.email.toLowerCase()));
    const guestPurchases = await Purchase.aggregate([
      { $match: { status: { $in: ['approved', 'shipped'] } } },
      { $group: { _id: { $toLower: '$email' }, nombre: { $first: '$nombre' }, apellido: { $first: '$apellido' }, email: { $first: '$email' } } },
    ]);
    const guests = guestPurchases
      .filter(g => !userEmails.has(g._id))
      .map(g => ({ nombre: g.nombre, apellido: g.apellido, email: g.email, isGuest: true }));

    const verifiedUsers = users.filter(u => u.emailVerified);
    res.json({
      users: users.map(u => ({ ...u, isGuest: false })),
      guests,
      total: users.length,
      totalVerified: verifiedUsers.length,
    });
  } catch (error) {
    console.error('Error obteniendo destinatarios:', error);
    res.status(500).json({ error: 'Error al obtener destinatarios' });
  }
});

export default router;
