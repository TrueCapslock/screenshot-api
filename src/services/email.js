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
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  return transporter;
}

export async function sendMagicLink(email, link) {
  const from = config.smtp.from || 'onboarding@resend.dev';
  const subject = 'Your Screenshot API login link';
  const text = `Click this link to log in:\n\n${link}\n\nThis link expires in 15 minutes.`;
  const html = `<table role="presentation" style="width:100%;background:#f4f6f8;padding:40px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<tr><td align="center">
  <table role="presentation" style="max-width:480px;width:100%;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
    <tr><td style="padding:32px 32px 0;">
      <h1 style="font-size:20px;font-weight:700;margin:0 0 16px;color:#1a1a2e;">Screenshot API</h1>
      <p style="font-size:15px;line-height:1.5;color:#555;margin:0 0 20px;">Click the button below to log in to your account. This link expires in 15 minutes.</p>
    </td></tr>
    <tr><td style="padding:0 32px;">
      <table role="presentation" style="width:100%;"><tr><td align="center">
        <a href="${link}" style="display:inline-block;padding:14px 32px;background:#0066ff;color:#fff;text-decoration:none;font-size:15px;font-weight:600;border-radius:8px;">Log In to Screenshot API</a>
      </td></tr></table>
    </td></tr>
    <tr><td style="padding:24px 32px 32px;">
      <p style="font-size:13px;color:#999;margin:0;text-align:center;">If you did not request this email, you can safely ignore it.</p>
    </td></tr>
  </table>
</td></tr>
</table>`;

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

export async function sendAlertNotification(email, alertName, url, diffPercentage) {
  const from = config.smtp.from || 'onboarding@resend.dev';
  const subject = `Alert: ${alertName} — ${diffPercentage}% difference detected`;
  const text = `Alert "${alertName}" triggered!\n\nURL: ${url}\nDifference: ${diffPercentage}%\n\nLog in to your dashboard for details.`;
  const html = `<table role="presentation" style="width:100%;background:#f4f6f8;padding:40px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<tr><td align="center">
  <table role="presentation" style="max-width:480px;width:100%;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
    <tr><td style="padding:32px 32px 0;">
      <h1 style="font-size:20px;font-weight:700;margin:0 0 16px;color:#1a1a2e;">Screenshot API Alert</h1>
      <p style="font-size:15px;line-height:1.5;color:#555;margin:0 0 8px;">Alert <strong>${alertName}</strong> triggered!</p>
      <p style="font-size:14px;color:#555;margin:0 0 4px;">URL: <a href="${url}" style="color:#0066ff;">${url}</a></p>
      <p style="font-size:14px;color:#555;margin:0 0 20px;">Difference: <strong style="color:${diffPercentage > 1 ? '#dc3545' : '#e67e22'};">${diffPercentage}%</strong></p>
    </td></tr>
    <tr><td style="padding:0 32px 32px;">
      <table role="presentation" style="width:100%;"><tr><td align="center">
        <a href="${config.baseUrl}/docs" style="display:inline-block;padding:14px 32px;background:#0066ff;color:#fff;text-decoration:none;font-size:15px;font-weight:600;border-radius:8px;">View in Dashboard</a>
      </td></tr></table>
    </td></tr>
  </table>
</td></tr>
</table>`;

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

  console.log('--- Alert Notification (no email service configured) ---');
  console.log(`To: ${email}`);
  console.log(`Alert: ${alertName}`);
  console.log(`URL: ${url}`);
  console.log(`Diff: ${diffPercentage}%`);
  console.log('---');
}
