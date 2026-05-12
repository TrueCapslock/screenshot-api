import nodemailer from 'nodemailer';
import config from '../config.js';

let transporter;

function getTransporter() {
  if (transporter) return transporter;
  if (!config.smtp.host) return null;
  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user
      ? { user: config.smtp.user, pass: config.smtp.pass }
      : undefined,
  });
  return transporter;
}

export async function sendMagicLink(email, link) {
  const t = getTransporter();
  const msg = {
    to: email,
    from: config.smtp.from || 'noreply@screenshot-api.local',
    subject: 'Your Screenshot API login link',
    text: `Click this link to log in:\n\n${link}\n\nThis link expires in 15 minutes.`,
    html: `<p>Click the link below to log in to your Screenshot API account:</p><p><a href="${link}">${link}</a></p><p>This link expires in 15 minutes.</p>`,
  };

  if (!t) {
    console.log('--- Magic Link (no SMTP configured) ---');
    console.log(`To: ${email}`);
    console.log(`Link: ${link}`);
    console.log('---');
    return;
  }

  await t.sendMail(msg);
}
