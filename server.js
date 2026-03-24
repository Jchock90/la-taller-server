
import express from "express";
import crypto from "crypto";
import cors from "cors";
import jwt from "jsonwebtoken";
import { MercadoPagoConfig, Preference, Payment } from "mercadopago";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import rateLimit from "express-rate-limit";
import { addPurchaseRecord, getPurchaseRecord, updatePurchaseStatus, cleanOldRecords, loadPurchaseData } from "./dataStore.js";
import connectDB from "./config/db.js";
import productRoutes from "./routes/products.js";
import adminRoutes from './routes/admin.js';
import userRoutes from './routes/users.js';
import authMiddleware from './middleware/auth.js';
import Purchase from './models/Purchase.js';
import { syncPurchaseToAtlas } from './syncService.js';

dotenv.config();

// Conectar a MongoDB
await connectDB();

const app = express();

app.set('trust proxy', 1);

const corsOptions = {
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));

// Rutas de productos (público) y admin (protegido)
app.use('/api/products', productRoutes);
app.use('/api/admin', adminRoutes);

// Rutas de usuarios (público + protegido)
// Admin user management routes require admin auth
app.use('/api/users/admin', authMiddleware);
app.use('/api/users', userRoutes);

const createPreferenceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Demasiadas solicitudes desde esta IP, por favor intenta de nuevo más tarde." }
});

const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  message: { error: "Demasiadas notificaciones." }
});

const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});

function validatePurchaseData(data) {
  const { items, nombre, apellido, email, telefono, provincia, ciudad, codigoPostal } = data;
  
  if (!items || !Array.isArray(items) || items.length === 0) {
    return { valid: false, error: "Items inválidos" };
  }
  
  for (const item of items) {
    if (!item.title || typeof item.title !== 'string' || item.title.length === 0) {
      return { valid: false, error: "Título de producto inválido" };
    }
    if (!item.unit_price || typeof item.unit_price !== 'number' || item.unit_price <= 0) {
      return { valid: false, error: "Precio inválido" };
    }
    if (!item.quantity || typeof item.quantity !== 'number' || item.quantity <= 0 || item.quantity > 100) {
      return { valid: false, error: "Cantidad inválida" };
    }
  }
  
  if (!nombre || typeof nombre !== 'string' || nombre.trim().length === 0) {
    return { valid: false, error: "Nombre inválido" };
  }
  
  if (!apellido || typeof apellido !== 'string' || apellido.trim().length === 0) {
    return { valid: false, error: "Apellido inválido" };
  }
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) {
    return { valid: false, error: "Email inválido" };
  }
  
  if (!telefono || typeof telefono !== 'string' || telefono.trim().length < 8) {
    return { valid: false, error: "Teléfono inválido" };
  }
  
  if (!provincia || typeof provincia !== 'string' || provincia.trim().length === 0) {
    return { valid: false, error: "Provincia inválida" };
  }
  
  if (!ciudad || typeof ciudad !== 'string' || ciudad.trim().length === 0) {
    return { valid: false, error: "Ciudad inválida" };
  }
  
  if (!codigoPostal || typeof codigoPostal !== 'string' || codigoPostal.trim().length === 0) {
    return { valid: false, error: "Código postal inválido" };
  }
  
  return { valid: true };
}

app.post("/create_preference", createPreferenceLimiter, async (req, res) => {
  try {
    const { items, userToken, ...buyerData } = req.body;

    const validation = validatePurchaseData(req.body);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    // Optionally extract userId from user token
    let userId = null;
    if (userToken) {
      try {
        const decoded = jwt.verify(userToken, process.env.JWT_SECRET);
        if (decoded.userId) userId = decoded.userId;
      } catch (_) { /* guest checkout */ }
    }
    
    const preference = new Preference(client);
    const mpItems = items.map((item) => ({
      title: item.title,
      unit_price: Number(item.unit_price),
      quantity: Number(item.quantity),
    }));
    
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const orderId = crypto.randomUUID();
    const body = {
      items: mpItems,
      external_reference: orderId,
      back_urls: {
        success: `${frontendUrl}/success`,
        failure: `${frontendUrl}/failure`,
        pending: `${frontendUrl}/pending`,
      },
      metadata: buyerData,
    };
    
    if (process.env.NGROK_URL) {
      body.notification_url = `${process.env.NGROK_URL}/webhook`;
    }
    
    const response = await preference.create({ body });
    console.log("Preference creada:", response.id, "Order:", orderId, "Items:", mpItems.length);

    await addPurchaseRecord(orderId, { ...buyerData, items, status: 'pending' });

    // Guardar también en MongoDB como respaldo inmediato
    const total = items.reduce((s, i) => s + i.unit_price * i.quantity, 0);
    const purchaseData = {
      orderId,
      status: 'pending',
      nombre: buyerData.nombre,
      apellido: buyerData.apellido,
      email: buyerData.email,
      telefono: buyerData.telefono,
      direccion: buyerData.direccion || '',
      pisoDepto: buyerData.pisoDepto || '',
      codigoPostal: buyerData.codigoPostal,
      provincia: buyerData.provincia,
      ciudad: buyerData.ciudad,
      items,
      total,
    };
    if (userId) purchaseData.userId = userId;
    await Purchase.create(purchaseData);

    syncPurchaseToAtlas({
      orderId,
      status: 'pending',
      nombre: buyerData.nombre,
      apellido: buyerData.apellido,
      email: buyerData.email,
      telefono: buyerData.telefono,
      direccion: buyerData.direccion || '',
      pisoDepto: buyerData.pisoDepto || '',
      codigoPostal: buyerData.codigoPostal,
      provincia: buyerData.provincia,
      ciudad: buyerData.ciudad,
      items,
      total,
      createdAt: new Date(),
    });
    
    res.json({ id: response.id, init_point: response.init_point });
  } catch (error) {
    console.error("Error creando preference:", error);
    res.status(500).json({ error: "Error creando preference" });
  }
});

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

app.post("/webhook", webhookLimiter, async (req, res) => {
  try {
    console.log("Webhook recibido:", JSON.stringify(req.body));
    console.log("Query params:", req.query);
    
    const { type, action, data } = req.body;
    const isPayment = type === "payment" || (action && action.startsWith("payment"));
    
    if (isPayment && data?.id) {
      console.log("Verificando pago", data.id, "con MercadoPago...");

      const payment = new Payment(client);
      const paymentInfo = await payment.get({ id: data.id });
      
      console.log("Estado del pago:", paymentInfo.status);

      // Si el pago sigue pendiente o en revisión, actualizar estado en DB y esperar
      if (paymentInfo.status === "pending" || paymentInfo.status === "in_process") {
        const orderId = paymentInfo.external_reference;
        if (orderId) {
          const sale = await Purchase.findOneAndUpdate(
            { orderId },
            { status: paymentInfo.status, paymentId: String(data.id) },
            { returnDocument: 'after' }
          );
          if (sale) syncPurchaseToAtlas(sale.toObject());
          console.log(`Pago ${paymentInfo.status} para order: ${orderId}`);
        }
        return res.sendStatus(200);
      }

      if (paymentInfo.status !== "approved") {
        // Pago rechazado u otro estado
        const orderId = paymentInfo.external_reference;
        if (orderId) {
          await Purchase.findOneAndUpdate(
            { orderId },
            { status: 'rejected', paymentId: String(data.id) },
            { upsert: false }
          );
        }
        console.log(`Pago ${paymentInfo.status} para order: ${orderId}`);
        return res.sendStatus(200);
      }

      // Buscar datos del comprador por external_reference
      const orderId = paymentInfo.external_reference;
      let found = orderId ? await getPurchaseRecord(orderId) : null;

      // Fallback 1: Si no está en JSON, buscar en MongoDB
      if (!found && orderId) {
        const dbRecord = await Purchase.findOne({ orderId });
        if (dbRecord) {
          found = dbRecord.toObject();
          console.log("Datos recuperados desde MongoDB (no estaban en JSON)");
        }
      }

      // Fallback 2: Si tampoco está en MongoDB, usar metadata de MercadoPago
      if (!found && paymentInfo.metadata) {
        const meta = paymentInfo.metadata;
        if (meta.nombre && meta.email) {
          found = {
            nombre: meta.nombre,
            apellido: meta.apellido || '',
            email: meta.email,
            telefono: meta.telefono || '',
            provincia: meta.provincia || '',
            ciudad: meta.ciudad || '',
            codigoPostal: meta.codigo_postal || meta.codigoPostal || '',
            items: paymentInfo.additional_info?.items?.map(i => ({
              title: i.title,
              unit_price: Number(i.unit_price),
              quantity: Number(i.quantity),
            })) || [],
          };
          console.log("Datos recuperados desde metadata de MercadoPago (no estaban en JSON ni MongoDB)");
        }
      }
      
      const protectedStatuses = ['approved', 'shipped', 'refunded'];
      if (found && !protectedStatuses.includes(found.status)) {
        await updatePurchaseStatus(orderId, 'approved');

        const itemsHtml = (found.items || [])
          .map((i) => `<li style="padding:4px 0;color:#555;">${i.title} x${i.quantity} — $${(i.unit_price * i.quantity).toLocaleString("es-AR")}</li>`)
          .join('');
        const total = (found.items || []).reduce((s, i) => s + i.unit_price * i.quantity, 0);

        await transporter.sendMail({
          from: process.env.EMAIL_USER,
          to: process.env.ADMIN_EMAIL,
          subject: `Nueva compra en La Taller`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
              <h2 style="color:#333;">Nueva compra recibida</h2>
              <div style="background:#f8f8f8;border-radius:8px;padding:16px;margin:16px 0;">
                <h3 style="margin:0 0 10px;color:#333;font-size:14px;">Datos del comprador:</h3>
                <p style="margin:4px 0;font-size:14px;color:#555;"><strong>Nombre:</strong> ${found.nombre} ${found.apellido}</p>
                <p style="margin:4px 0;font-size:14px;color:#555;"><strong>Email:</strong> ${found.email}</p>
                <p style="margin:4px 0;font-size:14px;color:#555;"><strong>Teléfono:</strong> ${found.telefono}</p>
                <p style="margin:4px 0;font-size:14px;color:#555;"><strong>Dirección:</strong> ${found.direccion || ''}${found.pisoDepto ? `, ${found.pisoDepto}` : ''}</p>
                <p style="margin:4px 0;font-size:14px;color:#555;"><strong>Ubicación:</strong> ${found.ciudad}, ${found.provincia} (CP: ${found.codigoPostal})</p>
              </div>
              <div style="background:#f8f8f8;border-radius:8px;padding:16px;margin:16px 0;">
                <h3 style="margin:0 0 10px;color:#333;font-size:14px;">Productos:</h3>
                <ul style="margin:0;padding-left:20px;font-size:14px;">${itemsHtml}</ul>
                <p style="margin:12px 0 0;font-weight:bold;color:#333;">Total: $${total.toLocaleString("es-AR")}</p>
              </div>
              <p style="font-size:12px;color:#999;margin-top:30px;">Order ID: ${orderId}</p>
            </div>
          `,
        });

        await transporter.sendMail({
          from: process.env.EMAIL_USER,
          to: found.email,
          subject: "¡Compra exitosa en La Taller!",
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
              <h2 style="color:#333;">¡Hola ${found.nombre}!</h2>
              <p style="color:#555;">Tu compra fue procesada con éxito. Estos son los detalles:</p>
              <div style="background:#f8f8f8;border-radius:8px;padding:16px;margin:20px 0;">
                <h3 style="margin:0 0 10px;color:#333;font-size:14px;">Productos:</h3>
                <ul style="margin:0;padding-left:20px;font-size:14px;">${itemsHtml}</ul>
                <p style="margin:12px 0 0;font-weight:bold;color:#333;">Total: $${total.toLocaleString("es-AR")}</p>
              </div>
              <div style="background:#f8f8f8;border-radius:8px;padding:16px;margin:16px 0;">
                <h3 style="margin:0 0 10px;color:#333;font-size:14px;">Dirección de envío:</h3>
                <p style="margin:4px 0;font-size:14px;color:#555;">${found.direccion || ''}${found.pisoDepto ? `, ${found.pisoDepto}` : ''}</p>
                <p style="margin:4px 0;font-size:14px;color:#555;">${found.ciudad}, ${found.provincia} (CP: ${found.codigoPostal})</p>
              </div>
              <p style="color:#555;">Pronto recibirás noticias por mail o teléfono con los datos del despacho.</p>
              <p style="color:#333;font-weight:bold;">¡Gracias por confiar en La Taller!</p>
              <p style="font-size:12px;color:#999;margin-top:30px;">Si tenés alguna consulta, respondé este email o contactanos por WhatsApp.</p>
            </div>
          `,
        });

        // Guardar compra en MongoDB
        const approvedData = {
            orderId,
            paymentId: String(data.id),
            status: 'approved',
            nombre: found.nombre,
            apellido: found.apellido,
            email: found.email,
            telefono: found.telefono,
            provincia: found.provincia,
            ciudad: found.ciudad,
            codigoPostal: found.codigoPostal,
            items: found.items,
            total,
        };
        await Purchase.findOneAndUpdate(
          { orderId },
          approvedData,
          { upsert: true, returnDocument: 'after' }
        );

        syncPurchaseToAtlas(approvedData);
        
        console.log("Pago aprobado - Emails enviados - Compra guardada en DB y Atlas");
      } else if (protectedStatuses.includes(found?.status)) {
        console.log("Pago ya procesado anteriormente, ignorando duplicado.");
      } else {
        console.log("No se encontraron datos de compra para order:", orderId);
      }
    }
    
    res.sendStatus(200);
  } catch (error) {
    console.error("Error en webhook:", error);
    res.sendStatus(500);
  }
});

cleanOldRecords();

setInterval(() => {
  cleanOldRecords();
}, 24 * 60 * 60 * 1000);

// Reconciliación al arrancar: verificar compras pendientes con MercadoPago
async function reconcilePendingPurchases() {
  try {
    const pendingPurchases = await Purchase.find({ status: { $in: ['pending', 'in_process'] } });
    if (pendingPurchases.length === 0) {
      console.log("Reconciliación: No hay compras pendientes.");
      return;
    }

    console.log(`Reconciliación: Verificando ${pendingPurchases.length} compra(s) pendiente(s)/en revisión...`);
    const payment = new Payment(client);

    for (const purchase of pendingPurchases) {
      try {
        // Sin paymentId no podemos consultar a MP
        if (!purchase.paymentId) {
          const hoursOld = (Date.now() - new Date(purchase.createdAt).getTime()) / (1000 * 60 * 60);
          if (hoursOld > 48) {
            await Purchase.findByIdAndUpdate(purchase._id, { status: 'rejected' });
            console.log(`  Order ${purchase.orderId}: Expirada (${Math.round(hoursOld)}h sin paymentId), marcada como rechazada.`);
          } else {
            console.log(`  Order ${purchase.orderId}: Sin paymentId, esperando webhook (${Math.round(hoursOld)}h).`);
          }
          continue;
        }

        // Verificar estado con MercadoPago
        const paymentInfo = await payment.get({ id: purchase.paymentId });
        console.log(`  Order ${purchase.orderId} (Payment ${purchase.paymentId}): Estado MP = ${paymentInfo.status}`);

        if (paymentInfo.status === 'approved') {
          // No sobrescribir si ya fue despachado o reembolsado
          if (['shipped', 'refunded'].includes(purchase.status)) {
            console.log(`  Order ${purchase.orderId}: Ya tiene status ${purchase.status}, no se sobrescribe.`);
            continue;
          }
          await Purchase.findByIdAndUpdate(purchase._id, { status: 'approved' });
          await updatePurchaseStatus(purchase.orderId, 'approved');
          syncPurchaseToAtlas({ ...purchase.toObject(), status: 'approved' });

          const itemsHtml = (purchase.items || [])
            .map((i) => `<li style="padding:4px 0;color:#555;">${i.title} x${i.quantity} — $${(i.unit_price * i.quantity).toLocaleString("es-AR")}</li>`)
            .join('');
          const total = purchase.total || purchase.items.reduce((s, i) => s + i.unit_price * i.quantity, 0);

          await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: process.env.ADMIN_EMAIL,
            subject: `Nueva compra en La Taller (reconciliada)`,
            html: `
              <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
                <h2 style="color:#333;">Nueva compra reconciliada</h2>
                <p style="color:#555;font-size:14px;">Esta compra fue aprobada mientras el servidor estaba apagado.</p>
                <div style="background:#f8f8f8;border-radius:8px;padding:16px;margin:16px 0;">
                  <h3 style="margin:0 0 10px;color:#333;font-size:14px;">Datos del comprador:</h3>
                  <p style="margin:4px 0;font-size:14px;color:#555;"><strong>Nombre:</strong> ${purchase.nombre} ${purchase.apellido}</p>
                  <p style="margin:4px 0;font-size:14px;color:#555;"><strong>Email:</strong> ${purchase.email}</p>
                  <p style="margin:4px 0;font-size:14px;color:#555;"><strong>Teléfono:</strong> ${purchase.telefono}</p>
                  <p style="margin:4px 0;font-size:14px;color:#555;"><strong>Dirección:</strong> ${purchase.direccion || ''}${purchase.pisoDepto ? `, ${purchase.pisoDepto}` : ''}</p>
                  <p style="margin:4px 0;font-size:14px;color:#555;"><strong>Ubicación:</strong> ${purchase.ciudad}, ${purchase.provincia} (CP: ${purchase.codigoPostal})</p>
                </div>
                <div style="background:#f8f8f8;border-radius:8px;padding:16px;margin:16px 0;">
                  <h3 style="margin:0 0 10px;color:#333;font-size:14px;">Productos:</h3>
                  <ul style="margin:0;padding-left:20px;font-size:14px;">${itemsHtml}</ul>
                  <p style="margin:12px 0 0;font-weight:bold;color:#333;">Total: $${total.toLocaleString("es-AR")}</p>
                </div>
                <p style="font-size:12px;color:#999;margin-top:30px;">Order ID: ${purchase.orderId}</p>
              </div>
            `,
          });

          await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: purchase.email,
            subject: "¡Compra exitosa en La Taller!",
            html: `
              <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
                <h2 style="color:#333;">¡Hola ${purchase.nombre}!</h2>
                <p style="color:#555;">Tu compra fue procesada con éxito. Estos son los detalles:</p>
                <div style="background:#f8f8f8;border-radius:8px;padding:16px;margin:20px 0;">
                  <h3 style="margin:0 0 10px;color:#333;font-size:14px;">Productos:</h3>
                  <ul style="margin:0;padding-left:20px;font-size:14px;">${itemsHtml}</ul>
                  <p style="margin:12px 0 0;font-weight:bold;color:#333;">Total: $${total.toLocaleString("es-AR")}</p>
                </div>
                <div style="background:#f8f8f8;border-radius:8px;padding:16px;margin:16px 0;">
                  <h3 style="margin:0 0 10px;color:#333;font-size:14px;">Dirección de envío:</h3>
                  <p style="margin:4px 0;font-size:14px;color:#555;">${purchase.direccion || ''}${purchase.pisoDepto ? `, ${purchase.pisoDepto}` : ''}</p>
                  <p style="margin:4px 0;font-size:14px;color:#555;">${purchase.ciudad}, ${purchase.provincia} (CP: ${purchase.codigoPostal})</p>
                </div>
                <p style="color:#555;">Pronto recibirás noticias por mail o teléfono con los datos del despacho.</p>
                <p style="color:#333;font-weight:bold;">¡Gracias por confiar en La Taller!</p>
                <p style="font-size:12px;color:#999;margin-top:30px;">Si tenés alguna consulta, respondé este email o contactanos por WhatsApp.</p>
              </div>
            `,
          });

          console.log(`  Compra ${purchase.orderId} reconciliada - emails enviados.`);
        } else if (paymentInfo.status === 'rejected' || paymentInfo.status === 'cancelled') {
          await Purchase.findByIdAndUpdate(purchase._id, { status: 'rejected' });
          await updatePurchaseStatus(purchase.orderId, 'rejected');
          console.log(`  Pago ${purchase.orderId} rechazado/cancelado.`);
        } else if (paymentInfo.status === 'in_process') {
          await Purchase.findByIdAndUpdate(purchase._id, { status: 'in_process' });
          console.log(`  Pago ${purchase.orderId} sigue en revisión.`);
        }
      } catch (err) {
        console.error(`  Error verificando order ${purchase.orderId}:`, err.message);
      }
    }

    console.log("Reconciliación completada.");
  } catch (error) {
    console.error("Error en reconciliación:", error);
  }
}

// Ejecutar reconciliación 5s después de arrancar
setTimeout(() => reconcilePendingPurchases(), 5000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
  console.log(`CORS habilitado para: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
});

