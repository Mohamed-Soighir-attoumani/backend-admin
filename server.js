// === backend/server.js ===
require('dotenv').config(); // 📌 charge les variables d'environnement

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const morgan = require('morgan');
const promBundle = require('express-prom-bundle');
const cron = require('node-cron');

const logger = require('./logger');
const runBackup = require('./scripts/backup');

// Import des routes
const setupAdminRoute    = require('./routes/setup-admin');
const incidentRoutes     = require('./routes/incidents');
const articleRoutes      = require('./routes/articles');
const notificationRoutes = require('./routes/notifications');
const authRoutes         = require('./routes/auth');
const projectRoutes      = require('./routes/projects');
const deviceRoutes = require('./routes/devices');

const app = express();

// 📌 Variables d’environnement
const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || '0.0.0.0';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/backend_admin';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || null;

/* ───────────── Middlewares globaux ───────────── */
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(morgan('combined', { stream: { write: msg => logger.info(msg.trim()) } }));

// 📈 Monitoring Prometheus
app.use(
  promBundle({
    metricsPath: '/metrics',
    includeMethod: true,
    includePath: true,
    promClient: {
      collectDefaultMetrics: {
        labels: { app: 'securidem-backend' },
      },
    },
  })
);

// 🔁 Vérification du backend
app.get('/health', (_, res) => res.json({ status: 'ok', timestamp: Date.now() }));

/* ───────────── Routes applicatives ───────────── */
app.use('/api', setupAdminRoute); // ✅ corriger ici
app.use('/api/incidents', incidentRoutes);
app.use('/api/articles', articleRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api', authRoutes); // contient /login, etc.

/* Page d’accueil */
app.get('/', (_, res) => res.send('API SecuriDem opérationnelle ✅'));

/* ───────────── Tâche CRON sauvegarde MongoDB ───────────── */
cron.schedule('0 3 * * *', async () => {
  logger.info('Lancement sauvegarde quotidienne');
  try {
    await runBackup();
    logger.info('Sauvegarde terminée');
  } catch (e) {
    logger.error('Backup failed', { error: e.stack });
  }
});

/* ───────────── Gestion des erreurs ───────────── */
app.use((err, req, res, _next) => {
  logger.error('Erreur serveur 🧨', { error: err.stack });
  res.status(500).json({ message: 'Erreur interne du serveur' });
});

// ❗ 404 API – doit être tout à la fin
app.use('/api/*', (_, res) =>
  res.status(404).json({ message: 'Route API introuvable ❌' })
);

/* ───────────── Connexion DB + lancement serveur ───────────── */
mongoose
  .connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => {
    logger.info('MongoDB connecté ✅');
    if (!GITHUB_TOKEN) {
      logger.warn('GITHUB_TOKEN manquant — endpoint /cve retournera []');
    }
    app.listen(PORT, HOST, () =>
      logger.info(`Serveur disponible sur http://${HOST}:${PORT} 🚀`)
    );
  })
  .catch(err => logger.error('Erreur MongoDB ❌', err));
