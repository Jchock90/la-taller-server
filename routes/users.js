import express from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import rateLimit from 'express-rate-limit';
import User from '../models/User.js';
import Purchase from '../models/Purchase.js';
import userAuth from '../middleware/userAuth.js';

const router = express.Router();

let _transporter;
function getTransporter() {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: 465,
      secure: true,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
      tls: { rejectUnauthorized: false },
    });
  }
  return _transporter;
}

function sendMailWithTimeout(mailOptions, timeoutMs = 10000) {
  return Promise.race([
    getTransporter().sendMail(mailOptions),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Email timeout')), timeoutMs)),
  ]);
}

function generateToken(user) {
  return jwt.sign(
    { userId: user._id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Demasiados intentos de registro. Intenta de nuevo más tarde.' },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Demasiados intentos de login. Intenta de nuevo más tarde.' },
});

// ── REGISTRO ──────────────────────────────────────────────
router.post('/register', registerLimiter, async (req, res) => {
  try {
    const { nombre, apellido, email, password } = req.body;

    if (!nombre || !apellido || !email || !password) {
      return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Email inválido' });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ error: 'Ya existe una cuenta con este email' });
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    const user = await User.create({
      nombre: nombre.trim(),
      apellido: apellido.trim(),
      email: email.toLowerCase().trim(),
      password,
      verificationToken,
      verificationExpires,
    });

    // Send verification email
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const verifyUrl = `${frontendUrl}/verificar-email?token=${verificationToken}`;

    try {
      await sendMailWithTimeout({
        from: process.env.EMAIL_USER,
        to: user.email,
        subject: 'Verifica tu email - La Taller',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #333;">¡Hola ${user.nombre}!</h2>
            <p>Gracias por registrarte en <strong>La Taller</strong>.</p>
            <p>Para completar tu registro, verifica tu email haciendo clic en el siguiente botón:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${verifyUrl}" style="background-color: #000; color: #fff; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold;">
                Verificar mi email
              </a>
            </div>
            <p style="color: #666; font-size: 14px;">Si no creaste esta cuenta, puedes ignorar este email.</p>
            <p style="color: #666; font-size: 14px;">Este enlace expira en 24 horas.</p>
          </div>
        `,
      });
      res.status(201).json({ message: 'Cuenta creada. Revisa tu email para verificar tu cuenta.' });
    } catch (emailErr) {
      console.error('Error enviando email de verificación:', emailErr);
      res.status(201).json({ message: 'Cuenta creada, pero hubo un problema enviando el email. Usa "Reenviar verificación" para intentar de nuevo.' });
    }
  } catch (error) {
    console.error('Error en registro:', error);
    res.status(500).json({ error: 'Error al crear la cuenta' });
  }
});

// ── VERIFICAR EMAIL ───────────────────────────────────────
router.get('/verify-email', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).json({ error: 'Token de verificación requerido' });
    }

    const user = await User.findOne({
      verificationToken: token,
      verificationExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({ error: 'Token inválido o expirado' });
    }

    user.emailVerified = true;
    user.verificationToken = undefined;
    user.verificationExpires = undefined;
    await user.save();

    // Link existing purchases by email
    await Purchase.updateMany(
      { email: user.email, userId: { $exists: false } },
      { $set: { userId: user._id } }
    );

    const authToken = generateToken(user);
    res.json({ message: 'Email verificado correctamente', token: authToken, user });
  } catch (error) {
    console.error('Error verificando email:', error);
    res.status(500).json({ error: 'Error al verificar el email' });
  }
});

// ── REENVIAR VERIFICACIÓN ─────────────────────────────────
router.post('/resend-verification', registerLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email requerido' });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.json({ message: 'Si el email existe, recibirás un nuevo enlace.' });
    if (user.emailVerified) return res.json({ message: 'Tu email ya está verificado.' });

    const verificationToken = crypto.randomBytes(32).toString('hex');
    user.verificationToken = verificationToken;
    user.verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await user.save();

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const verifyUrl = `${frontendUrl}/verificar-email?token=${verificationToken}`;

    await sendMailWithTimeout({
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: 'Verifica tu email - La Taller',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333;">¡Hola ${user.nombre}!</h2>
          <p>Aquí tienes un nuevo enlace para verificar tu email:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${verifyUrl}" style="background-color: #000; color: #fff; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold;">
              Verificar mi email
            </a>
          </div>
          <p style="color: #666; font-size: 14px;">Este enlace expira en 24 horas.</p>
        </div>
      `,
    });

    res.json({ message: 'Si el email existe, recibirás un nuevo enlace.' });
  } catch (error) {
    console.error('Error reenviando verificación:', error);
    res.status(500).json({ error: 'Error al reenviar verificación' });
  }
});

// ── LOGIN ─────────────────────────────────────────────────
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña son obligatorios' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !user.password) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    if (!user.emailVerified) {
      return res.status(403).json({ error: 'Debes verificar tu email antes de iniciar sesión', needsVerification: true });
    }

    const token = generateToken(user);
    res.json({ token, user });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

// ── GOOGLE AUTH ───────────────────────────────────────────
router.post('/google', async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) {
      return res.status(400).json({ error: 'Token de Google requerido' });
    }

    // Verify Google ID token via Google's tokeninfo endpoint
    const googleRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
    if (!googleRes.ok) {
      return res.status(401).json({ error: 'Token de Google inválido' });
    }

    const payload = await googleRes.json();

    if (payload.aud !== process.env.GOOGLE_CLIENT_ID) {
      return res.status(401).json({ error: 'Token de Google inválido' });
    }

    const { sub: googleId, email, given_name, family_name } = payload;

    // Find or create user
    let user = await User.findOne({ $or: [{ googleId }, { email: email.toLowerCase() }] });

    if (user) {
      // Link Google account if not yet linked
      if (!user.googleId) {
        user.googleId = googleId;
      }
      // Google accounts are always verified
      if (!user.emailVerified) {
        user.emailVerified = true;
      }
      await user.save();
    } else {
      user = await User.create({
        nombre: given_name || '',
        apellido: family_name || '',
        email: email.toLowerCase(),
        googleId,
        emailVerified: true,
      });
    }

    // Link existing purchases by email
    await Purchase.updateMany(
      { email: user.email, userId: { $exists: false } },
      { $set: { userId: user._id } }
    );

    const token = generateToken(user);
    res.json({ token, user });
  } catch (error) {
    console.error('Error en Google auth:', error);
    res.status(500).json({ error: 'Error en autenticación con Google' });
  }
});

// ── PERFIL ────────────────────────────────────────────────
router.get('/profile', userAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ user });
  } catch (error) {
    console.error('Error obteniendo perfil:', error);
    res.status(500).json({ error: 'Error al obtener perfil' });
  }
});

// ── MIS COMPRAS ───────────────────────────────────────────
router.get('/my-purchases', userAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const purchases = await Purchase.find({
      $or: [
        { userId: user._id },
        { email: user.email },
      ],
    }).sort({ createdAt: -1 });

    res.json({ purchases });
  } catch (error) {
    console.error('Error obteniendo compras:', error);
    res.status(500).json({ error: 'Error al obtener compras' });
  }
});

// ── ADMIN: LISTAR USUARIOS ───────────────────────────────
router.get('/admin/list', async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 }).select('-password -verificationToken -verificationExpires -resetPasswordToken -resetPasswordExpires').lean();

    // Aggregate purchase stats per user
    const purchaseStats = await Purchase.aggregate([
      { $match: { userId: { $in: users.map(u => u._id) } } },
      { $group: {
        _id: '$userId',
        totalPurchases: { $sum: 1 },
        totalSpent: { $sum: '$total' },
        lastPurchase: { $max: '$createdAt' },
      }},
    ]);
    const statsMap = Object.fromEntries(purchaseStats.map(s => [s._id.toString(), s]));

    // Fetch full purchases grouped by user
    const purchases = await Purchase.find({ userId: { $in: users.map(u => u._id) } })
      .sort({ createdAt: -1 })
      .lean();
    const purchasesMap = {};
    for (const p of purchases) {
      const uid = p.userId.toString();
      if (!purchasesMap[uid]) purchasesMap[uid] = [];
      purchasesMap[uid].push(p);
    }

    const enriched = users.map(u => {
      const uid = u._id.toString();
      return {
        ...u,
        purchaseStats: statsMap[uid] || { totalPurchases: 0, totalSpent: 0, lastPurchase: null },
        purchases: purchasesMap[uid] || [],
      };
    });

    res.json({ users: enriched });
  } catch (error) {
    console.error('Error listando usuarios:', error);
    res.status(500).json({ error: 'Error al listar usuarios' });
  }
});

// ── ADMIN: ELIMINAR USUARIO ──────────────────────────────
router.delete('/admin/:id', async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ message: 'Usuario eliminado' });
  } catch (error) {
    console.error('Error eliminando usuario:', error);
    res.status(500).json({ error: 'Error al eliminar usuario' });
  }
});

export default router;
