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
const { secretFingerprint } = require('./utils/jwt');

const Commune = require('./models/Commune');
// ⬇️ Correction: importer le bon router
const communeRoutes = require('./routes/communeRoutes');

// ✅ Auth middleware pour /api/me pare-balles
const auth = require('./middleware/authMiddleware');

const app = express();

const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || '0.0.0.0';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/backend_admin';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || null;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || process.env.FRONEND_ORIGIN || '*';

app.set('trust proxy', 1);

const ALLOWED_HEADERS = [
  'Content-Type','Authorization','Cache-Control','X-Requested-With',
  'x-commune-id','x-app-key','X-App-Key','x-access-token','x-token','x-auth-token',
];

app.use(cors({
  origin: FRONTEND_ORIGIN === '*' ? true : FRONTEND_ORIGIN,
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ALLOWED_HEADERS,
}));

app.options('*', (req, res) => {
  const origin = req.headers.origin || (FRONTEND_ORIGIN !== '*' ? FRONTEND_ORIGIN : '*');
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers',
    req.headers['access-control-request-headers'] || ALLOWED_HEADERS.join(', ')
  );
  return res.sendStatus(204);
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));

app.use(promBundle({
  metricsPath: '/metrics',
  includeMethod: true,
  includePath: true,
  promClient: { collectDefaultMetrics: { labels: { app: 'securidem-backend' } } },
}));

app.get('/api/health', (_, res) => res.json({ status: 'ok', timestamp: Date.now() }));

// ✅ Pare-balles: expose /api/me ici pour éviter tout 404 (même si routes/me.js bug)
app.get('/api/me', auth, (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      role: req.user.role,
      communeId: req.user.communeId || '',
      communeName: req.user.communeName || '',
      tv: typeof req.user.tv === 'number' ? req.user.tv : 0,
      impersonated: !!req.user.impersonated,
      origUserId: req.user.origUserId || null,
      // champs facultatifs (la route dédiée peut enrichir)
      name: null,
      photo: null,
    },
  });
});

/* Routes API */
app.use('/api', require('./routes/setup-admin'));
app.use('/api', require('./routes/auth'));
app.use('/api', require('./routes/me')); // garde la version enrichie (name/photo...), pare-balles couvre le 404
app.use('/api/change-password', (req, _res, next) => { console.log('[HIT] /api/change-password', req.method, req.path || '/'); next(); }, require('./routes/changePassword'));
app.use('/api/incidents', require('./routes/incidents'));
app.use('/api/articles', require('./routes/articles'));
app.use('/api/infos', require('./routes/infos'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/devices', require('./routes/devices'));

// IMPORTANT: router des communes
// ⬇️ Correction: utiliser communeRoutes (et ne pas doubler "/api" dans le fichier de routes)
app.use('/api/communes', communeRoutes);
// ✅ Alias public pour couvrir les appels mobile sans /api
app.use('/communes', communeRoutes);

app.use('/api', require('./routes/userRoutes'));
app.use('/api', require('./routes/subscriptions'));
app.use('/api', require('./routes/debug'));

app.get('/', (_, res) => res.send('API SecuriDem opérationnelle ✅'));

// Cron backup
cron.schedule('0 3 * * *', async () => {
  logger.info('Lancement sauvegarde quotidienne');
  try {
    await runBackup();
    logger.info('Sauvegarde terminée');
  } catch (e) {
    logger.error('Backup failed', { error: e.stack });
  }
});

// Error handler
app.use((err, req, res, _next) => {
  logger.error('Erreur serveur 🧨', { error: err.stack });
  res.status(500).json({ message: 'Erreur interne du serveur' });
});

// 404 API (après toutes les routes)
app.use('/api/*', (req, res) => {
  res.status(404).json({ message: `Route API introuvable ❌ (${req.method} ${req.originalUrl})` });
});

// --------- Maintenance indexes + seed ----------
async function fixCommuneIndexes() {
  try {
    // Récupérer les indexes et drop le 'slug_1' s'il est unique
    const collection = mongoose.connection.collection('communes');
    const indexes = await collection.indexes();
    const slugIdx = indexes.find(i => i.name === 'slug_1');
    if (slugIdx && slugIdx.unique) {
      await collection.dropIndex('slug_1');
      logger.info('Index unique slug_1 supprimé ✅');
      // Recréer un index simple non-unique si tu veux
      await collection.createIndex({ slug: 1 }, { name: 'slug_1' });
      logger.info('Index slug_1 recréé (non-unique) ✅');
    }
  } catch (e) {
    logger.warn('Impossible de modifier les indexes slug_1 (peut-être déjà correct)', { error: e.message });
  }
}

async function ensureDefaultCommunes() {
  const count = await Commune.countDocuments();
  if (count > 0) return;

  const base = [
    { id: 'dembeni',   name: 'Dembéni',   region: 'Mayotte', imageUrl: '/uploads/communes/dembeni.jpg' },
    { id: 'mamoudzou', name: 'Mamoudzou', region: 'Mayotte', imageUrl: '/uploads/communes/mamoudzou.jpg' },
    { id: 'chirongui', name: 'Chirongui', region: 'Mayotte', imageUrl: '/uploads/communes/chirongui.jpg' },
  ].map(c => ({ ...c, slug: c.id })); // slug=id

  await Commune.insertMany(base, { ordered: true });
  logger.info('Communes par défaut insérées ✅');
}

mongoose
  .connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    logger.info('MongoDB connecté ✅');
    logger.info(`JWT secret fingerprint: ${secretFingerprint()}`);
    if (!GITHUB_TOKEN) logger.warn('GITHUB_TOKEN manquant — endpoint /cve retournera []');

    // 1) Corriger l’index unique historique si présent
    await fixCommuneIndexes();
    // 2) Seed si vide
    await ensureDefaultCommunes();

    app.listen(PORT, HOST, () => logger.info(`Serveur dispo sur http://${HOST}:${PORT} 🚀`));
  })
  .catch((err) => logger.error('Erreur MongoDB ❌', err));
