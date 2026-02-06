
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
    const { title, unit_price, quantity, ...buyerData } = req.body;
    const preference = new Preference(client);
    const response = await preference.create({
      body: {
        items: [
          {
            title,
            unit_price: Number(unit_price),
            quantity: Number(quantity),
          },
        ],
        back_urls: {
          success: "http://localhost:5173/success",
          failure: "http://localhost:5173/failure",
          pending: "http://localhost:5173/pending",
        },
        /* auto_return: "approved", */
        metadata: buyerData,
      },
    });
    purchaseData[response.id] = { ...buyerData, title, unit_price, quantity };
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
    const { type, data } = req.body;
    if (type === "payment") {
      const paymentId = data.id;
      let found = null;
      for (const [prefId, info] of Object.entries(purchaseData)) {
        if (info && info.preference_id === prefId) {
          found = { prefId, ...info };
          break;
        }
      }
      if (!found && Object.keys(purchaseData).length > 0) {
        const lastPrefId = Object.keys(purchaseData).pop();
        found = { prefId: lastPrefId, ...purchaseData[lastPrefId] };
      }
      if (found) {
        await transporter.sendMail({
          from: process.env.EMAIL_USER,
          to: process.env.ADMIN_EMAIL,
          subject: `Nueva compra: ${found.title}`,
          text: `Datos de la compra:\n\n${JSON.stringify(found, null, 2)}`,
        });
        await transporter.sendMail({
          from: process.env.EMAIL_USER,
          to: found.email,
          subject: "¡Compra exitosa en La Taller!",
          text: `Hola ${found.nombre},\n\nTu compra fue exitosa. Pronto recibirás noticias por mail o teléfono con los datos del despacho del producto.\n\n¡Gracias por confiar en La Taller!`,
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
