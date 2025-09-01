import express from "express";
import cors from "cors";
import { MercadoPagoConfig, Preference } from "mercadopago";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});

app.post("/create_preference", async (req, res) => {
  try {
    const { title, unit_price, quantity } = req.body;

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
      },
    });

    res.json({ id: response.id, init_point: response.init_point });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error creando preference" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
