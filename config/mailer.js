import nodemailer from 'nodemailer';

let _transporter;

export function getTransporter() {
  if (_transporter) return _transporter;

  if (process.env.RESEND_API_KEY) {
    // Cloud: use Resend HTTP API (port 443) — SMTP ports are blocked on Render free tier
    const apiKey = process.env.RESEND_API_KEY;
    _transporter = {
      sendMail: async (opts) => {
        const body = {
          from: opts.from,
          to: Array.isArray(opts.to) ? opts.to : [opts.to],
          subject: opts.subject,
        };
        if (opts.html) body.html = opts.html;
        if (opts.text) body.text = opts.text;
        if (opts.attachments?.length) {
          body.attachments = opts.attachments.map(a => ({
            filename: a.filename,
            content: a.content instanceof Buffer ? a.content.toString('base64') : a.content,
            content_type: a.contentType,
          }));
        }

        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(`Resend API error ${res.status}: ${err.message || JSON.stringify(err)}`);
        }

        const data = await res.json();
        return { messageId: data.id, response: '250 OK' };
      },
    };
    console.log('📧 Email: usando Resend HTTP API');
  } else {
    // Local: use Gmail SMTP
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
    const from = process.env.EMAIL_FROM || 'noreply@lataller.com.ar';
    // Ensure valid format: "Name <email>" or "email@domain"
    if (from.includes('<') && from.includes('>')) return from;
    if (from.includes('@')) return `La Taller <${from}>`;
    return 'La Taller <noreply@lataller.com.ar>';
  }
  return process.env.EMAIL_USER;
}
