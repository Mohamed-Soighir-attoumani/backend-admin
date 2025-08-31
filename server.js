// backend/server.js
require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const morgan = require('morgan');
const promBundle = require('express-prom-bundle');
const cron = require('node-cron');

const logger = require('./logger');
const runBackup = require('./scripts/backup');

const app = express();

const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || '0.0.0.0';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/backend_admin';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || null;
const FRONTEND_ORIGIN = process.env.FRONEND_ORIGIN || process.env.FRONTEND_ORIGIN || '*';

app.set('trust proxy', 1);

const ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'Cache-Control',
  'X-Requested-With',
  'x-commune-id',
  'x-app-key',
  'X-App-Key',
];

app.use(
  cors({
    origin: FRONTEND_ORIGIN === '*' ? true : FRONTEND_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ALLOWED_HEADERS,
  })
);

app.options('*', (req, res) => {
  const origin = req.headers.origin || (FRONTEND_ORIGIN !== '*' ? FRONTEND_ORIGIN : '*');
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.header(
    'Access-Control-Allow-Headers',
    req.headers['access-control-request-headers'] || ALLOWED_HEADERS.join(', ')
  );
  return res.sendStatus(204);
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));

app.use(
  promBundle({
    metricsPath: '/metrics',
    includeMethod: true,
    includePath: true,
    promClient: { collectDefaultMetrics: { labels: { app: 'securidem-backend' } } },
  })
);

app.get('/api/health', (_, res) => res.json({ status: 'ok', timestamp: Date.now() }));

/* Routes */
const setupAdminRoute   = require('./routes/setup-admin');
const authRoutes        = require('./routes/auth');
const meRoute           = require('./routes/me');
const adminsRoutes      = require('./routes/admins'); // ta route existante
const changePasswordRoute = require('./routes/changePassword');

const incidentRoutes    = require('./routes/incidents');
const articleRoutes     = require('./routes/articles');
const infoRoutes        = require('./routes/infos');
const notificationRoutes = require('./routes/notifications');
const projectRoutes     = require('./routes/projects');
const deviceRoutes      = require('./routes/devices');
const userRoutes        = require('./routes/userRoutes');      // ✅ inclut /api/admins (fallback), /api/users
const subscriptionRoutes = require('./routes/subscriptions');  // ✅ inclut /api/subscriptions

app.use('/api', setupAdminRoute);
app.use('/api', authRoutes);
app.use('/api', meRoute);

app.use(
  '/api/admins',
  (req, _res, next) => {
    console.log('[HIT] /api/admins', req.method, req.originalUrl);
    next();
  },
  adminsRoutes
);

app.use(
  '/api/change-password',
  (req, _res, next) => {
    console.log('[HIT] /api/change-password', req.method, req.path || '/');
    next();
  },
  changePasswordRoute
);

app.use('/api/incidents', incidentRoutes);
app.use('/api/articles', articleRoutes);
app.use('/api/infos', infoRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api', userRoutes);          // ✅ /api/admins (version de ce fichier) & /api/users
app.use('/api', subscriptionRoutes);  // ✅ /api/subscriptions
app.use('/api', require('./routes/debug'));

app.get('/', (_, res) => res.send('API SecuriDem opérationnelle ✅'));

cron.schedule('0 3 * * *', async () => {
  logger.info('Lancement sauvegarde quotidienne');
  try {
    await runBackup();
    logger.info('Sauvegarde terminée');
  } catch (e) {
    logger.error('Backup failed', { error: e.stack });
  }
});

app.use((err, req, res, _next) => {
  logger.error('Erreur serveur 🧨', { error: err.stack });
  res.status(500).json({ message: 'Erreur interne du serveur' });
});

app.use('/api/*', (req, res) => {
  res
    .status(404)
    .json({ message: `Route API introuvable ❌ (${req.method} ${req.originalUrl})` });
});

mongoose
  .connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => {
    logger.info('MongoDB connecté ✅');
    if (!GITHUB_TOKEN) logger.warn('GITHUB_TOKEN manquant — endpoint /cve retournera []');
    app.listen(PORT, HOST, () =>
      logger.info(`Serveur dispo sur http://${HOST}:${PORT} 🚀`)
    );
  })
  .catch((err) => logger.error('Erreur MongoDB ❌', err));
