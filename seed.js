import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Product from './models/Product.js';

dotenv.config();

const PRODUCTS_SEED = [
  {
    name: 'Blazer Oversize',
    price: '$45.200',
    imageUrl: 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1936&q=80',
    gallery: [
      'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1936&q=80',
      'https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1594938298603-c8148c4dae35?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1611312449408-fcece27cdbb7?auto=format&fit=crop&w=1200&q=80',
    ],
    collectionName: 'Colección Atemporal',
    collectionDescription: 'Piezas clásicas diseñadas para trascender temporadas',
    talles: ['S', 'M', 'L', 'XL'],
    colores: ['Negro', 'Gris Oxford', 'Beige'],
    composicion: '70% Lana merino, 30% Poliéster reciclado',
    fabricacion: 'Confección artesanal en taller propio con corte italiano. Forro interior de satén. Terminaciones a mano con hilo de seda. Botones de nácar natural.',
    cuidados: 'Lavado en seco. No usar secadora. Planchar a temperatura media.',
    order: 1,
  },
  {
    name: 'Vestido Midaxi',
    price: '$15.200',
    imageUrl: 'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1887&q=80',
    gallery: [
      'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1887&q=80',
      'https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=1200&q=80',
    ],
    collectionName: 'Colección Atemporal',
    collectionDescription: 'Piezas clásicas diseñadas para trascender temporadas',
    talles: ['XS', 'S', 'M', 'L'],
    colores: ['Negro', 'Borgoña', 'Verde bosque'],
    composicion: '85% Viscosa ecológica, 15% Elastano',
    fabricacion: 'Corte y confección artesanal. Costura francesa en todas las uniones. Ruedo invisible hecho a mano. Tela importada con certificación OEKO-TEX.',
    cuidados: 'Lavar a mano con agua fría. Secar a la sombra. Planchar del revés.',
    order: 2,
  },
  {
    name: 'Pantalón Wide Leg',
    price: '$12.800',
    imageUrl: 'https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1887&q=80',
    gallery: [
      'https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1887&q=80',
      'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1584370848010-d7fe6bc767ec?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1506629082955-511b1aa562c8?auto=format&fit=crop&w=1200&q=80',
    ],
    collectionName: 'Colección Atemporal',
    collectionDescription: 'Piezas clásicas diseñadas para trascender temporadas',
    talles: ['S', 'M', 'L', 'XL', 'XXL'],
    colores: ['Crudo', 'Negro', 'Camel'],
    composicion: '100% Algodón orgánico de alto gramaje',
    fabricacion: 'Pierna wide leg con pinzas delanteras. Cintura alta con pretina forrada. Cierre YKK invisible lateral. Dobladillo con puntada ciega artesanal.',
    cuidados: 'Lavado a máquina en frío. No usar blanqueador. Secar colgado.',
    order: 3,
  },
  {
    name: 'Top Asimétrico',
    price: '$12.800',
    imageUrl: 'https://images.unsplash.com/photo-1576566588028-4147f3842f27?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1964&q=80',
    gallery: [
      'https://images.unsplash.com/photo-1576566588028-4147f3842f27?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1964&q=80',
      'https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1525507119028-ed4c629a60a3?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1485968579580-b6d095142e6e?auto=format&fit=crop&w=1200&q=80',
    ],
    collectionName: 'Colección Experimental',
    collectionDescription: 'Diseños vanguardistas que desafían convenciones',
    talles: ['XS', 'S', 'M', 'L'],
    colores: ['Blanco roto', 'Negro', 'Terracota'],
    composicion: '60% Algodón pima, 40% Modal',
    fabricacion: 'Diseño asimétrico con corte al bies. Costuras planas para mayor comodidad. Tejido con acabado enzimático para suavidad extra. Etiqueta impresa (sin costuras molestas).',
    cuidados: 'Lavar a máquina en ciclo delicado. No retorcer. Secar en horizontal.',
    order: 4,
  },
  {
    name: 'Chaleco Escultural',
    price: '$21.300',
    imageUrl: 'https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1887&q=80',
    gallery: [
      'https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1887&q=80',
      'https://images.unsplash.com/photo-1558171813-4c088753af8f?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1608234808654-2a8875faa7fd?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1617137968427-85924c800a22?auto=format&fit=crop&w=1200&q=80',
    ],
    collectionName: 'Colección Experimental',
    collectionDescription: 'Diseños vanguardistas que desafían convenciones',
    talles: ['S', 'M', 'L'],
    colores: ['Negro', 'Blanco hueso', 'Gris perla'],
    composicion: '55% Lana virgen, 35% Poliamida, 10% Cashmere',
    fabricacion: 'Estructura escultural con entretela termoadhesiva. Forrado en jacquard de seda. Ojales abiertos a mano. Cada pieza lleva 12 horas de confección artesanal.',
    cuidados: 'Solo lavado en seco. Guardar en percha acolchada. Vaporizar para arrugas.',
    order: 5,
  },
  {
    name: 'Falda Capas',
    price: '$16.700',
    imageUrl: 'https://images.unsplash.com/photo-1551232864-3f0890e580d9?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1887&q=80',
    gallery: [
      'https://images.unsplash.com/photo-1551232864-3f0890e580d9?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1887&q=80',
      'https://images.unsplash.com/photo-1583496661160-fb5886a0aaaa?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1592301933927-35b597393c0a?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1590548784585-643d2b9f2925?auto=format&fit=crop&w=1200&q=80',
    ],
    collectionName: 'Colección Experimental',
    collectionDescription: 'Diseños vanguardistas que desafían convenciones',
    talles: ['XS', 'S', 'M', 'L', 'XL'],
    colores: ['Negro', 'Nude', 'Azul noche'],
    composicion: '80% Poliéster reciclado, 20% Viscosa',
    fabricacion: 'Sistema de capas superpuestas con corte láser en los bordes. Cintura elástica oculta con grip de silicona. Largo midi asimétrico. Telas teñidas con pigmentos naturales.',
    cuidados: 'Lavar a máquina en frío con bolsa de red. No usar suavizante. Secar colgado.',
    order: 6,
  },
];

async function seed() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Conectado a MongoDB');

    const count = await Product.countDocuments();
    if (count > 0) {
      console.log(`Ya existen ${count} productos en la base de datos.`);
      console.log('Para re-seedear, borra la colección primero.');
      process.exit(0);
    }

    const result = await Product.insertMany(PRODUCTS_SEED);
    console.log(`${result.length} productos insertados correctamente:`);
    result.forEach(p => console.log(`  - ${p.name} (${p.collection})`));

    process.exit(0);
  } catch (error) {
    console.error('Error en seed:', error);
    process.exit(1);
  }
}

seed();
