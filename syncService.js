import mongoose from 'mongoose';

let syncing = false;

export function triggerSync() {
  const atlasUri = process.env.ATLAS_URI;
  if (!atlasUri || syncing) return;

  syncing = true;

  setImmediate(async () => {
    let atlasConn;
    try {
      const products = await mongoose.connection.db.collection('products').find({}).toArray();

      atlasConn = await mongoose.createConnection(atlasUri).asPromise();
      const atlasColl = atlasConn.db.collection('products');

      await atlasColl.deleteMany({});
      if (products.length > 0) {
        await atlasColl.insertMany(products);
      }

      console.log(`☁️  Sync: ${products.length} productos → Atlas`);
    } catch (err) {
      console.error('☁️  Sync error:', err.message);
    } finally {
      if (atlasConn) await atlasConn.close();
      syncing = false;
    }
  });
}

export function syncPurchaseToAtlas(purchaseDoc) {
  const atlasUri = process.env.ATLAS_URI;
  if (!atlasUri) return;

  setImmediate(async () => {
    let atlasConn;
    try {
      atlasConn = await mongoose.createConnection(atlasUri).asPromise();
      const atlasColl = atlasConn.db.collection('purchases');

      const { _id, ...data } = purchaseDoc;
      await atlasColl.updateOne(
        { orderId: purchaseDoc.orderId },
        { $set: data },
        { upsert: true }
      );

      console.log(`☁️  Sync: Compra ${purchaseDoc.orderId} (${purchaseDoc.status}) → Atlas`);
    } catch (err) {
      console.error('☁️  Sync purchase error:', err.message);
    } finally {
      if (atlasConn) await atlasConn.close();
    }
  });
}
