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

/* ===================== ENV ===================== */
const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || '0.0.0.0';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/backend_admin';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || null;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '*';

/* ===================== CORS ===================== */
app.use(cors({
  origin: FRONTEND_ORIGIN === '*' ? true : FRONTEND_ORIGIN,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  // 👇 IMPORTANT : on autorise aussi la clé app
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'Cache-Control',
    'X-Requested-With',
    'x-app-key',
    'X-App-Key'
  ],
}));

app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || FRONTEND_ORIGIN || '*');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  // On reflète les headers préflight demandés par le navigateur
  res.header(
    'Access-Control-Allow-Headers',
    req.headers['access-control-request-headers']
      || 'Content-Type, Authorization, Cache-Control, X-Requested-With, x-app-key, X-App-Key'
  );
  return res.sendStatus(204);
});

/* ===================== Body & Static ===================== */
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

/* ===================== Logs HTTP ===================== */
app.use(morgan('combined', { stream: { write: msg => logger.info(msg.trim()) } }));

/* ===================== Prometheus ===================== */
app.use(promBundle({
  metricsPath: '/metrics',
  includeMethod: true,
  includePath: true,
  promClient: { collectDefaultMetrics: { labels: { app: 'securidem-backend' } } },
}));

/* ===================== Health ===================== */
app.get('/api/health', (_, res) => res.json({ status: 'ok', timestamp: Date.now() }));

/* ===================== Import des routes ===================== */
const setupAdminRoute     = require('./routes/setup-admin');
const authRoutes          = require('./routes/auth');
const meRoute             = require('./routes/me');
const adminsRoutes        = require('./routes/admins');
const changePasswordRoute = require('./routes/changePassword');

const incidentRoutes      = require('./routes/incidents');
const articleRoutes       = require('./routes/articles');
const notificationRoutes  = require('./routes/notifications');
const projectRoutes       = require('./routes/projects');
const deviceRoutes        = require('./routes/devices');
const userRoutes          = require('./routes/userRoutes');
const debugRoutes         = require('./routes/debug');

/* ===================== Montage des routes ===================== */
app.use('/api', setupAdminRoute);
app.use('/api', authRoutes);
app.use('/api', meRoute);

app.use('/api/admins',
  (req, _res, next) => { console.log('[HIT] /api/admins', req.method, req.originalUrl); next(); },
  adminsRoutes
);

app.use('/api/change-password',
  (req, _res, next) => { console.log('[HIT] /api/change-password', req.method, req.path || '/'); next(); },
  changePasswordRoute
);

app.use('/api/incidents', incidentRoutes);
app.use('/api/articles', articleRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api', userRoutes);
app.use('/api', debugRoutes);

/* ===================== Accueil ===================== */
app.get('/', (_, res) => res.send('API SecuriDem opérationnelle ✅'));

/* ===================== CRON backup ===================== */
cron.schedule('0 3 * * *', async () => {
  logger.info('Lancement sauvegarde quotidienne');
  try {
    await runBackup();
    logger.info('Sauvegarde terminée');
  } catch (e) {
    logger.error('Backup failed', { error: e.stack });
  }
});

/* ===================== Handler d’erreurs ===================== */
app.use((err, req, res, _next) => {
  logger.error('Erreur serveur 🧨', { error: err.stack });
  res.status(500).json({ message: 'Erreur interne du serveur' });
});

/* ===================== 404 API ===================== */
app.use('/api/*', (req, res) => {
  res.status(404).json({ message: `Route API introuvable ❌ (${req.method} ${req.originalUrl})` });
});

/* ===================== DB + serveur ===================== */
mongoose
  .connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => {
    logger.info('MongoDB connecté ✅');
    if (!GITHUB_TOKEN) logger.warn('GITHUB_TOKEN manquant — endpoint /cve retournera []');
    app.listen(PORT, HOST, () => logger.info(`Serveur dispo sur http://${HOST}:${PORT} 🚀`));
  })
  .catch(err => logger.error('Erreur MongoDB ❌', err));
