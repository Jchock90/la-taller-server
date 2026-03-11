import 'dotenv/config';
import mongoose from 'mongoose';

async function sync() {
  const atlasUri = process.env.ATLAS_URI;
  if (!atlasUri) {
    console.error('❌ Falta ATLAS_URI en .env');
    process.exit(1);
  }

  console.log('🔄 Conectando a MongoDB local...');
  await mongoose.connect(process.env.MONGODB_URI);

  const products = await mongoose.connection.db.collection('products').find({}).toArray();
  console.log(`📦 ${products.length} productos encontrados localmente`);

  if (products.length === 0) {
    console.log('⚠️  No hay productos para sincronizar');
    await mongoose.disconnect();
    return;
  }

  console.log('☁️  Conectando a Atlas...');
  const atlasConn = await mongoose.createConnection(atlasUri).asPromise();
  const atlasColl = atlasConn.db.collection('products');

  await atlasColl.deleteMany({});
  await atlasColl.insertMany(products);

  console.log(`✅ ${products.length} productos sincronizados con Atlas`);

  await atlasConn.close();
  await mongoose.disconnect();
}

sync();
