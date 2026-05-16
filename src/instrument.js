import 'dotenv/config';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as Sentry from '@sentry/node';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    release: `screenshot-api@${pkg.version}`,
    sendDefaultPii: true,
    integrations: [Sentry.consoleLoggingIntegration({ levels: ['warn', 'error'] })],
    enableLogs: true,
  });
}

export { Sentry };
