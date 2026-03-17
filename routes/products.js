import express from 'express';
import Product from '../models/Product.js';

const router = express.Router();

// GET /api/products - Obtener todos los productos activos agrupados por colección
router.get('/', async (req, res) => {
  try {
    const products = await Product.find({ active: true }).sort({ collectionName: 1, order: 1 });

    // Agrupar por colección
    const collectionsMap = {};
    for (const product of products) {
      if (!collectionsMap[product.collectionName]) {
        collectionsMap[product.collectionName] = {
          name: product.collectionName,
          description: product.collectionDescription || '',
          items: [],
        };
      }
      collectionsMap[product.collectionName].items.push({
        _id: product._id,
        name: product.name,
        price: product.price,
        imageUrl: product.imageUrl,
        gallery: product.gallery,
        talles: product.talles,
        colores: product.colores,
        composicion: product.composicion,
        fabricacion: product.fabricacion,
        cuidados: product.cuidados,
        categoria: product.categoria || '',
      });
    }

    const collections = Object.values(collectionsMap);
    res.json({ collections });
  } catch (error) {
    console.error('Error obteniendo productos:', error);
    res.status(500).json({ error: 'Error al obtener productos' });
  }
});

// GET /api/products/:id - Obtener un producto por ID
router.get('/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    res.json(product);
  } catch (error) {
    console.error('Error obteniendo producto:', error);
    res.status(500).json({ error: 'Error al obtener producto' });
  }
});

export default router;
