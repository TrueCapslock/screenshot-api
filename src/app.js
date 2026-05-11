import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import swaggerUi from 'swagger-ui-express';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import healthRouter from './routes/health.js';
import { errorHandler } from './middleware/errorHandler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(morgan('short'));

app.get('/', (req, res) => res.redirect('/docs'));
app.get('/favicon.ico', (req, res) => res.status(204).end());

app.use('/docs', express.static(join(__dirname, '..', 'public')));
app.use(
  '/docs/api',
  swaggerUi.serve,
  swaggerUi.setup(JSON.parse(readFileSync(join(__dirname, 'openapi.json'), 'utf-8')), {
    customSiteTitle: 'Screenshot API Docs',
  }),
);

app.use('/v1/stripe/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '5mb' }));

const { default: authRouter } = await import('./routes/auth.js');
const { default: stripeRouter } = await import('./routes/stripe.js');
const { default: accountRouter } = await import('./routes/account.js');
const { default: keysRouter } = await import('./routes/keys.js');
const { default: screenshotRouter } = await import('./routes/screenshot.js');
const { default: asyncRouter } = await import('./routes/async.js');
const { default: adminRouter } = await import('./routes/admin.js');

app.use(healthRouter);
app.use('/v1', authRouter);
app.use('/v1', stripeRouter);
app.use('/v1', accountRouter);
app.use('/v1', keysRouter);
app.use('/v1', screenshotRouter);
app.use('/v1', asyncRouter);
app.use('/v1', adminRouter);

app.use(errorHandler);

export default app;
