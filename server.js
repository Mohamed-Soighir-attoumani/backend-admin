// === backend/server.js ===
require('dotenv').config(); // 📌 charge les variables d'environnement en premier

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const morgan = require('morgan');
const promBundle = require('express-prom-bundle');
const cron = require('node-cron');

const logger = require('./logger');
const runBackup = require('./scripts/backup');
const setupAdminRoute = require("./routes/setup-admin");

// Routes métier
const incidentRoutes     = require('./routes/incidents');
const articleRoutes      = require('./routes/articles');
const notificationRoutes = require('./routes/notifications');
const authRoutes         = require('./routes/auth');
const projectRoutes      = require('./routes/projects');




const app  = express();

// 📌 Variables avec fallback
const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || '0.0.0.0';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/backend_admin';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || null;

/* ──────────────────────────────────────────────────────────── */
/* 1. Middlewares globaux                                      */
/* ──────────────────────────────────────────────────────────── */
app.use("/api", setupAdminRoute);
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(morgan('combined', { stream: { write: msg => logger.info(msg.trim()) } }));

/* Metrics Prometheus (/metrics) */
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
  }),
);

/* Health-check simple (/health) */
app.get('/health', (_, res) => res.json({ status: 'ok', timestamp: Date.now() }));

/* ──────────────────────────────────────────────────────────── */
/* 2. Routes applicatives                                      */
/* ──────────────────────────────────────────────────────────── */

app.use('/api/incidents',    incidentRoutes);
app.use('/api/articles',     articleRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/projects',     projectRoutes);
app.use('/api',              authRoutes);


/* Page d’accueil */
app.get('/', (_, res) => res.send('API SecuriDem opérationnelle ✅'));

/* ──────────────────────────────────────────────────────────── */
/* 3. Cron de sauvegarde quotidienne (03 h00)                   */
/* ──────────────────────────────────────────────────────────── */
cron.schedule('0 3 * * *', async () => {
  logger.info('Lancement sauvegarde quotidienne');
  try {
    await runBackup();
    logger.info('Sauvegarde terminée');
  } catch (e) {
    logger.error('Backup failed', { error: e.stack });
  }
});

/* ──────────────────────────────────────────────────────────── */
/* 4. Gestion des erreurs et 404                               */
/* ──────────────────────────────────────────────────────────── */
/* Handler d’erreurs global */
app.use((err, req, res, _next) => {
  logger.error('Erreur serveur 🧨', { error: err.stack });
  res.status(500).json({ message: 'Erreur interne du serveur' });
});

/* 404 pour toute route API inconnue (à placer très en bas) */
app.use('/api/*', (_, res) =>
  res.status(404).json({ message: 'Route API introuvable ❌' }),
);

/* ──────────────────────────────────────────────────────────── */
/* 5. Connexion MongoDB + démarrage serveur                    */
/* ──────────────────────────────────────────────────────────── */
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
      logger.info(`Serveur disponible sur http://${HOST}:${PORT} 🚀`),
    );
  })
  .catch(err => logger.error('Erreur MongoDB ❌', err));
