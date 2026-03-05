
import express from "express";
import cors from "cors";
import { MercadoPagoConfig, Preference } from "mercadopago";
import dotenv from "dotenv";
import nodemailer from "nodemailer";

dotenv.config();


const app = express();
app.use(cors());
app.use(express.json());

// Almacenamiento temporal de datos de compra (en memoria)
const purchaseData = {};

const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});

app.post("/create_preference", async (req, res) => {
  try {
    const { items, ...buyerData } = req.body;
    const preference = new Preference(client);
    const mpItems = items.map((item) => ({
      title: item.title,
      unit_price: Number(item.unit_price),
      quantity: Number(item.quantity),
    }));
    const body = {
        items: mpItems,
        back_urls: {
          success: "http://localhost:5173/success",
          failure: "http://localhost:5173/failure",
          pending: "http://localhost:5173/pending",
        },
        /* auto_return: "approved", */
        metadata: buyerData,
      };
    if (process.env.NGROK_URL) {
      body.notification_url = `${process.env.NGROK_URL}/webhook`;
    }
    const response = await preference.create({ body });
    console.log("Preference creada:", response.id, "Items:", mpItems.length);
    purchaseData[response.id] = { ...buyerData, items };
    res.json({ id: response.id, init_point: response.init_point });
  } catch (error) {
    console.error(error);
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

app.post("/webhook", async (req, res) => {
  try {
    console.log("Webhook recibido:", JSON.stringify(req.body));
    console.log("Query params:", req.query);
    const { type, action, data } = req.body;
    const isPayment = type === "payment" || (action && action.startsWith("payment"));
    if (isPayment) {
      console.log("Procesando pago, purchaseData keys:", Object.keys(purchaseData));
      let found = null;
      if (Object.keys(purchaseData).length > 0) {
        const lastPrefId = Object.keys(purchaseData).pop();
        found = { prefId: lastPrefId, ...purchaseData[lastPrefId] };
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
      }
    }
    res.sendStatus(200);
  } catch (error) {
    console.error("Error en webhook:", error);
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
