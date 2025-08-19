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

// Middlewares globaux
app.use(cors({
  origin: FRONTEND_ORIGIN,
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization'],
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
}));
app.options('*', cors());

app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
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

// Routes
const setupAdminRoute     = require('./routes/setup-admin');
const incidentRoutes      = require('./routes/incidents');
const articleRoutes       = require('./routes/articles');
const notificationRoutes  = require('./routes/notifications');
const authRoutes          = require('./routes/auth');
const projectRoutes       = require('./routes/projects');
const deviceRoutes        = require('./routes/devices');
const userRoutes          = require('./routes/userRoutes');
const changePasswordRoute = require('./routes/changePassword'); 
const meRoute             = require('./routes/me');

app.use('/api', setupAdminRoute);
app.use('/api/incidents', incidentRoutes);
app.use('/api/articles', articleRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api', authRoutes);
app.use('/api', userRoutes);

// 🔴 IMPORTANT : on monte le routeur SUR le chemin final
// → dans le fichier de route, les chemins sont juste '/'
app.use('/api/change-password', changePasswordRoute);

app.use('/api', meRoute);

// Page d’accueil
app.get('/', (_, res) => res.send('API SecuriDem opérationnelle ✅'));

// Cron
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
