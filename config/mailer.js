import nodemailer from 'nodemailer';

let _transporter;

export function getTransporter() {
  if (_transporter) return _transporter;

  if (process.env.RESEND_API_KEY) {
    // Cloud: use Resend SMTP relay
    _transporter = nodemailer.createTransport({
      host: 'smtp.resend.com',
      port: 465,
      secure: true,
      auth: {
        user: 'resend',
        pass: process.env.RESEND_API_KEY,
      },
    });
    console.log('📧 Email: usando Resend SMTP');
  } else {
    // Local: use Gmail
    _transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
    console.log('📧 Email: usando Gmail SMTP');
  }

  return _transporter;
}

export function getFromAddress() {
  if (process.env.RESEND_API_KEY) {
    return process.env.EMAIL_FROM || 'La Taller <noreply@lataller.com.ar>';
  }
  return process.env.EMAIL_USER;
}
