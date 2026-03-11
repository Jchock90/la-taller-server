import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import Product from '../models/Product.js';
import authMiddleware from '../middleware/auth.js';
import { triggerSync } from '../syncService.js';

const router = express.Router();

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
      collectionName, collectionDescription,
      talles, colores, composicion, fabricacion, cuidados,
      active, order
    } = req.body;

    const product = new Product({
      name, price, imageUrl,
      gallery: gallery || [],
      collectionName,
      collectionDescription: collectionDescription || '',
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
      'collectionName', 'collectionDescription',
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

export default router;
