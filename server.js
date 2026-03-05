
import express from "express";
import cors from "cors";
import { MercadoPagoConfig, Preference } from "mercadopago";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import rateLimit from "express-rate-limit";
import { addPurchaseRecord, getPurchaseRecord, cleanOldRecords, loadPurchaseData } from "./dataStore.js";

dotenv.config();

const app = express();

app.set('trust proxy', 1);

const corsOptions = {
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
app.use(express.json());

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
    const { items, ...buyerData } = req.body;

    const validation = validatePurchaseData(req.body);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }
    
    const preference = new Preference(client);
    const mpItems = items.map((item) => ({
      title: item.title,
      unit_price: Number(item.unit_price),
      quantity: Number(item.quantity),
    }));
    
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const body = {
      items: mpItems,
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
    console.log("Preference creada:", response.id, "Items:", mpItems.length);

    await addPurchaseRecord(response.id, { ...buyerData, items });
    
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
    
    if (isPayment) {
      console.log("Procesando pago...");

      const allPurchaseData = await loadPurchaseData();
      const purchaseKeys = Object.keys(allPurchaseData);
      console.log("Registros de compra disponibles:", purchaseKeys.length);
      
      let found = null;

      if (purchaseKeys.length > 0) {
        const lastPrefId = purchaseKeys[purchaseKeys.length - 1];
        found = { prefId: lastPrefId, ...allPurchaseData[lastPrefId] };
      }
      
      if (found) {
        const itemsList = (found.items || [])
          .map((i) => `- ${i.title} x${i.quantity} — $${(i.unit_price * i.quantity).toLocaleString("es-AR")}`)
          .join("\n");
        const total = (found.items || []).reduce((s, i) => s + i.unit_price * i.quantity, 0);

        await transporter.sendMail({
          from: process.env.EMAIL_USER,
          to: process.env.ADMIN_EMAIL,
          subject: `Nueva compra en La Taller`,
          text: `Datos del comprador:\nNombre: ${found.nombre} ${found.apellido}\nEmail: ${found.email}\nTeléfono: ${found.telefono}\nDirección: ${found.ciudad}, ${found.provincia} (CP: ${found.codigoPostal})\n\nProductos:\n${itemsList}\n\nTotal: $${total.toLocaleString("es-AR")}`,
        });

        await transporter.sendMail({
          from: process.env.EMAIL_USER,
          to: found.email,
          subject: "¡Compra exitosa en La Taller!",
          text: `Hola ${found.nombre},\n\nTu compra fue exitosa. Estos son tus productos:\n${itemsList}\n\nTotal: $${total.toLocaleString("es-AR")}\n\nPronto recibirás noticias por mail o teléfono con los datos del despacho.\n\n¡Gracias por confiar en La Taller!`,
        });
        
        console.log("Emails enviados correctamente");
      } else {
        console.log("No se encontraron datos de compra para este webhook");
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
  console.log(`CORS habilitado para: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
});

