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

  const purchases = await mongoose.connection.db.collection('purchases').find({}).toArray();
  console.log(`🛒 ${purchases.length} compras encontradas localmente`);

  console.log('☁️  Conectando a Atlas...');
  const atlasConn = await mongoose.createConnection(atlasUri).asPromise();

  // Sync productos
  const atlasProd = atlasConn.db.collection('products');
  await atlasProd.deleteMany({});
  if (products.length > 0) {
    await atlasProd.insertMany(products);
  }
  console.log(`✅ ${products.length} productos sincronizados con Atlas`);

  // Sync compras
  const atlasPurch = atlasConn.db.collection('purchases');
  for (const purchase of purchases) {
    const { _id, ...purchaseData } = purchase;
    await atlasPurch.updateOne(
      { orderId: purchase.orderId },
      { $set: purchaseData },
      { upsert: true }
    );
  }
  console.log(`✅ ${purchases.length} compras sincronizadas con Atlas`);

  // Sync emails enviados
  const sentEmails = await mongoose.connection.db.collection('sentemails').find({}).toArray();
  console.log(`📧 ${sentEmails.length} emails encontrados localmente`);

  const atlasEmails = atlasConn.db.collection('sentemails');
  await atlasEmails.deleteMany({});
  for (const email of sentEmails) {
    const { _id, ...emailData } = email;
    await atlasEmails.insertOne({ ...emailData, localId: _id.toString() });
  }
  console.log(`✅ ${sentEmails.length} emails sincronizados con Atlas`);

  await atlasConn.close();
  await mongoose.disconnect();
}

sync();
