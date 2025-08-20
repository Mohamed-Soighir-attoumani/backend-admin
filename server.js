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

// ENV
const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || '0.0.0.0';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/backend_admin';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || null;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '*';

/* ───────────── CORS ─────────────
   - Autorise Authorization & Cache-Control
   - Préflight qui reflète les headers demandés par le navigateur
*/
app.use(cors({
  origin: FRONTEND_ORIGIN === '*' ? true : FRONTEND_ORIGIN,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control', 'X-Requested-With'],
}));

app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || FRONTEND_ORIGIN || '*');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  // Reflète la liste exacte demandée par le navigateur pour éviter les 4xx préflight
  res.header(
    'Access-Control-Allow-Headers',
    req.headers['access-control-request-headers'] || 'Content-Type, Authorization, Cache-Control, X-Requested-With'
  );
  return res.sendStatus(204);
});

// Body & static
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Logs HTTP
app.use(morgan('combined', { stream: { write: msg => logger.info(msg.trim()) } }));

// Prometheus
app.use(promBundle({
  metricsPath: '/metrics',
  includeMethod: true,
  includePath: true,
  promClient: { collectDefaultMetrics: { labels: { app: 'securidem-backend' } } },
}));

// Health
app.get('/api/health', (_, res) => res.json({ status: 'ok', timestamp: Date.now() }));

/* ───────────── Import des routes ───────────── */
const setupAdminRoute     = require('./routes/setup-admin');
const incidentRoutes      = require('./routes/incidents');
const articleRoutes       = require('./routes/articles');
const notificationRoutes  = require('./routes/notifications');
const authRoutes          = require('./routes/auth');
const projectRoutes       = require('./routes/projects');
const deviceRoutes        = require('./routes/devices');
const userRoutes          = require('./routes/userRoutes');
const debugRoutes         = require('./routes/debug');
const changePasswordRoute = require('./routes/changePassword'); // ← routeur dédié
const meRoute             = require('./routes/me');

/* ───────────── Montage des routes ───────────── */
app.use('/api', setupAdminRoute);
app.use('/api/incidents', incidentRoutes);
app.use('/api/articles', articleRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api', authRoutes);
app.use('/api', userRoutes);
app.use('/api', debugRoutes);

// Monte /api/change-password ; à l'intérieur, les chemins sont '/' et 'POST /'
app.use(
  '/api/change-password',
  (req, _res, next) => { console.log('[HIT] /api/change-password', req.method, req.path || '/'); next(); },
  changePasswordRoute
);

// /api/me (profil connecté)
app.use('/api', meRoute);

// Accueil
app.get('/', (_, res) => res.send('API SecuriDem opérationnelle ✅'));

// CRON backup
cron.schedule('0 3 * * *', async () => {
  logger.info('Lancement sauvegarde quotidienne');
  try {
    await runBackup();
    logger.info('Sauvegarde terminée');
  } catch (e) {
    logger.error('Backup failed', { error: e.stack });
  }
});

// Handler d’erreurs
app.use((err, req, res, _next) => {
  logger.error('Erreur serveur 🧨', { error: err.stack });
  res.status(500).json({ message: 'Erreur interne du serveur' });
});

// 404 API – à la fin
app.use('/api/*', (_, res) => res.status(404).json({ message: 'Route API introuvable ❌' }));

// DB + serveur
mongoose
  .connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => {
    logger.info('MongoDB connecté ✅');
    if (!GITHUB_TOKEN) logger.warn('GITHUB_TOKEN manquant — endpoint /cve retournera []');
    app.listen(PORT, HOST, () => logger.info(`Serveur dispo sur http://${HOST}:${PORT} 🚀`));
  })
  .catch(err => logger.error('Erreur MongoDB ❌', err));
