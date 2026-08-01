const nodemailer = require('nodemailer');

// Reads SMTP config from environment variables (set these on Render).
// Works with Gmail (smtp.gmail.com, port 465, an "App Password" — not your
// normal Gmail password) or any other SMTP provider.
//
// Required env vars:
//   SMTP_HOST      e.g. smtp.gmail.com
//   SMTP_PORT      e.g. 465
//   SMTP_USER      the sending email address
//   SMTP_PASS      the app password / SMTP password
//   ALERT_EMAIL_TO who should receive birthday alerts (comma-separated for multiple)
//   BIRTHDAY_CRON_SECRET  a secret token to protect the /birthdays/send-today endpoint

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn('Email not configured: missing SMTP_HOST / SMTP_USER / SMTP_PASS env vars.');
    return null;
  }
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 465,
    secure: (Number(process.env.SMTP_PORT) || 465) === 465, // true for 465, false for 587
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return transporter;
}

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function buildBirthdayEmailHtml(people, dateLabel) {
  const rows = people.map(p => `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;font-weight:600;color:#111">${p.name}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;color:#333">${p.phone || '—'}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;color:#333">${p.department || '—'}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;color:#333;text-transform:capitalize">${p.type || '—'}</td>
    </tr>
  `).join('');

  return `
  <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff">
    <div style="background:#5C1B32;padding:24px;text-align:center">
      <h1 style="color:#fff;font-size:20px;margin:0">🎂 Birthdays Today — ${dateLabel}</h1>
      <p style="color:#E8D9AE;font-size:13px;margin:6px 0 0">Dwellers Gold Worldwide — Church Check-in</p>
    </div>
    <div style="padding:20px">
      <p style="font-size:14px;color:#333;margin-bottom:16px">
        ${people.length} ${people.length === 1 ? 'person has' : 'people have'} a birthday today. Give them a shout! 🎉
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="text-align:left">
            <th style="padding:10px 14px;color:#666;font-size:12px;border-bottom:2px solid #eee">Name</th>
            <th style="padding:10px 14px;color:#666;font-size:12px;border-bottom:2px solid #eee">Phone</th>
            <th style="padding:10px 14px;color:#666;font-size:12px;border-bottom:2px solid #eee">Department</th>
            <th style="padding:10px 14px;color:#666;font-size:12px;border-bottom:2px solid #eee">Type</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div style="padding:16px;text-align:center;color:#999;font-size:11px">
      Automated message from your Church Check-in system.
    </div>
  </div>`;
}

// Sends the birthday alert email if there is at least one birthday today.
// Returns { sent: boolean, count: number, error?: string }
async function sendBirthdayEmailIfAny(people, dateLabel) {
  if (!people || people.length === 0) {
    return { sent: false, count: 0 };
  }
  const t = getTransporter();
  if (!t) {
    return { sent: false, count: people.length, error: 'Email not configured (missing SMTP env vars)' };
  }
  const to = process.env.ALERT_EMAIL_TO;
  if (!to) {
    return { sent: false, count: people.length, error: 'ALERT_EMAIL_TO env var not set' };
  }

  const names = people.map(p => p.name).join(', ');
  await t.sendMail({
    from: `"Dwellers Gold Worldwide" <${process.env.SMTP_USER}>`,
    to,
    subject: `🎂 ${people.length === 1 ? "It's" : 'Multiple'} birthday${people.length === 1 ? '' : 's'} today: ${names}`,
    html: buildBirthdayEmailHtml(people, dateLabel),
  });

  return { sent: true, count: people.length };
}

module.exports = { sendBirthdayEmailIfAny, MONTH_NAMES };
