import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import config from '../config.js';

let resend;
let transporter;

function getResend() {
  if (resend) return resend;
  if (!config.resendKey) return null;
  resend = new Resend(config.resendKey);
  return resend;
}

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
  const from = config.smtp.from || 'onboarding@resend.dev';
  const subject = 'Your Screenshot API login link';
  const text = `Click this link to log in:\n\n${link}\n\nThis link expires in 15 minutes.`;
  const html = `<p>Click the link below to log in to your Screenshot API account:</p><p><a href="${link}">${link}</a></p><p>This link expires in 15 minutes.</p>`;

  const r = getResend();
  if (r) {
    await r.emails.send({ from, to: email, subject, text, html });
    return;
  }

  const t = getTransporter();
  if (t) {
    await t.sendMail({ from, to: email, subject, text, html });
    return;
  }

  console.log('--- Magic Link (no email service configured) ---');
  console.log(`To: ${email}`);
  console.log(`Link: ${link}`);
  console.log('---');
}
