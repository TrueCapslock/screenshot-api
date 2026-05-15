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
import config from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const openapiSpec = JSON.parse(readFileSync(join(__dirname, 'openapi.json'), 'utf-8'));
const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use((_req, res, next) => {
  res.set('X-API-Version', config.version);
  res.req.app.locals.version = config.version;
  next();
});

app.get('/', (req, res) => res.redirect('/docs'));
app.get('/favicon.ico', (req, res) => res.status(204).end());

app.get('/openapi.json', (req, res) => {
  const spec = { ...openapiSpec, servers: [{ url: `${req.protocol}://${req.get('host')}`, description: 'Server' }] };
  res.json(spec);
});

app.use('/docs', express.static(join(__dirname, '..', 'public')));
app.use(
  '/docs/api',
  swaggerUi.serve,
  swaggerUi.setup(null, { swaggerUrl: '/openapi.json', customSiteTitle: 'Screenshot API Docs' }),
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
const { default: compareRouter } = await import('./routes/compare.js');
const { default: describeRouter } = await import('./routes/describe.js');
const { default: sessionRouter } = await import('./routes/session.js');

app.use(healthRouter);
app.use('/v1', authRouter);
app.use('/v1', stripeRouter);
app.use('/v1', accountRouter);
app.use('/v1', keysRouter);
app.use('/v1', screenshotRouter);
app.use('/v1', asyncRouter);
app.use('/v1', adminRouter);
app.use('/v1', compareRouter);
app.use('/v1', describeRouter);
app.use('/v1', sessionRouter);

app.use(errorHandler);

export default app;
