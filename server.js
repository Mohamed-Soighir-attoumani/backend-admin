// backend/server.js
require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const morgan = require('morgan');
const promBundle = require('express-prom-bundle');
const cron = require('node-cron');

const communesRouter = require('./routes/communes');
const logger = require('./logger');
const runBackup = require('./scripts/backup');
const { secretFingerprint } = require('./utils/jwt');

const app = express();

const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || '0.0.0.0';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/backend_admin';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || null;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || process.env.FRONEND_ORIGIN || '*';

app.set('trust proxy', 1);

const ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'Cache-Control',
  'X-Requested-With',
  'x-commune-id',
  'x-app-key',
  'X-App-Key',
  'x-access-token',
  'x-token',
  'x-auth-token',
];

app.use(
  cors({
    origin: FRONTEND_ORIGIN === '*' ? true : FRONTEND_ORIGIN, // écho l’origin si '*'
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ALLOWED_HEADERS,
  })
);

// Preflight explicite (optionnel, mais utile si proxies)
app.options('*', (req, res) => {
  const origin = req.headers.origin || (FRONTEND_ORIGIN !== '*' ? FRONTEND_ORIGIN : '*');
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Vary', 'Origin');
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
app.use('/api', require('./routes/setup-admin'));
app.use('/api', require('./routes/auth'));
app.use('/api', require('./routes/me'));
app.use('/api/change-password', (req, _res, next) => { 
  console.log('[HIT] /api/change-password', req.method, req.path || '/'); 
  next(); 
}, require('./routes/changePassword'));

app.use('/api/incidents', require('./routes/incidents'));
app.use('/api/articles', require('./routes/articles'));
app.use('/api/infos', require('./routes/infos'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/devices', require('./routes/devices'));
app.use('/api/communes', communesRouter);
app.use('/api', require('./routes/userRoutes'));
app.use('/api', require('./routes/subscriptions'));
app.use('/api', require('./routes/debug'));

app.get('/', (_, res) => res.send('API SecuriDem opérationnelle ✅'));

// 404 API
app.use('/api/*', (req, res) => {
  res.status(404).json({ message: `Route API introuvable ❌ (${req.method} ${req.originalUrl})` });
});

// 🟡 Place le handler d’erreurs tout à la fin
app.use((err, req, res, _next) => {
  logger.error('Erreur serveur 🧨', { error: err.stack });
  res.status(500).json({ message: 'Erreur interne du serveur' });
});

cron.schedule('0 3 * * *', async () => {
  logger.info('Lancement sauvegarde quotidienne');
  try {
    await runBackup();
    logger.info('Sauvegarde terminée');
  } catch (e) {
    logger.error('Backup failed', { error: e.stack });
  }
});

mongoose
  .connect(MONGODB_URI /* options inutiles en Mongoose v6+ */)
  .then(() => {
    logger.info('MongoDB connecté ✅');
    logger.info(`JWT secret fingerprint: ${secretFingerprint()}`);
    if (!GITHUB_TOKEN) logger.warn('GITHUB_TOKEN manquant — endpoint /cve retournera []');

    app.listen(PORT, HOST, () => logger.info(`Serveur dispo sur http://${HOST}:${PORT} 🚀`));
  })
  .catch((err) => logger.error('Erreur MongoDB ❌', err));
