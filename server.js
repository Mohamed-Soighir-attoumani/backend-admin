// backend/server.js
require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");
const morgan = require("morgan");
const promBundle = require("express-prom-bundle");
const cron = require("node-cron");

const logger = require("./logger");
const runBackup = require("./scripts/backup");
const { secretFingerprint } = require("./utils/jwt");

const Commune = require("./models/Commune");

// Router des communes
const communeRoutes = require("./routes/communeRoutes");

// Auth middleware pour /api/me
const auth = require("./middleware/authMiddleware");

// Routers
const infosRouter = require("./routes/infos");
const notificationsRouter = require("./routes/notifications");

const app = express();

const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || "0.0.0.0";

const MONGODB_URI =
  process.env.MONGODB_URI ||
  "mongodb://127.0.0.1:27017/backend_admin";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || null;

const FRONTEND_ORIGIN =
  process.env.FRONTEND_ORIGIN ||
  process.env.FRONEND_ORIGIN ||
  "*";

/* =========================================================
   CONFIGURATION EXPRESS
========================================================= */

app.set("trust proxy", 1);

const ALLOWED_HEADERS = [
  "Content-Type",
  "Authorization",
  "Cache-Control",
  "X-Requested-With",
  "x-commune-id",
  "x-app-key",
  "X-App-Key",
  "x-access-token",
  "x-token",
  "x-auth-token",
];

app.use(
  cors({
    origin:
      FRONTEND_ORIGIN === "*"
        ? true
        : FRONTEND_ORIGIN,
    credentials: true,
    methods: [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ],
    allowedHeaders: ALLOWED_HEADERS,
  })
);

app.options("*", (req, res) => {
  const origin =
    req.headers.origin ||
    (FRONTEND_ORIGIN !== "*"
      ? FRONTEND_ORIGIN
      : "*");

  res.header(
    "Access-Control-Allow-Origin",
    origin
  );

  res.header(
    "Access-Control-Allow-Credentials",
    "true"
  );

  res.header(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,PATCH,DELETE,OPTIONS"
  );

  res.header(
    "Access-Control-Allow-Headers",
    req.headers[
      "access-control-request-headers"
    ] || ALLOWED_HEADERS.join(", ")
  );

  return res.sendStatus(204);
});

app.use(
  express.json({
    limit: "10mb",
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "10mb",
  })
);

app.use(
  "/uploads",
  express.static(
    path.join(__dirname, "uploads")
  )
);

app.use(
  morgan("combined", {
    stream: {
      write: (message) =>
        logger.info(message.trim()),
    },
  })
);

/* =========================================================
   MÉTRIQUES
========================================================= */

app.use(
  promBundle({
    metricsPath: "/metrics",
    includeMethod: true,
    includePath: true,
    promClient: {
      collectDefaultMetrics: {
        labels: {
          app: "securidem-backend",
        },
      },
    },
  })
);

/* =========================================================
   ROUTE DE SANTÉ
========================================================= */

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: Date.now(),
  });
});

/* =========================================================
   ROUTES API
========================================================= */

app.use(
  "/api",
  require("./routes/setup-admin")
);

app.use(
  "/api",
  require("./routes/auth")
);

app.use(
  "/api",
  require("./routes/me")
);

app.use(
  "/api/change-password",
  (req, _res, next) => {
    console.log(
      "[HIT] /api/change-password",
      req.method,
      req.path || "/"
    );

    next();
  },
  require("./routes/changePassword")
);

app.use(
  "/api/incidents",
  require("./routes/incidents")
);

app.use(
  "/api/articles",
  require("./routes/articles")
);

// Notifications
app.use(
  "/api/notifications",
  notificationsRouter
);

// Informations
app.use(
  "/api/infos",
  infosRouter
);

app.use(
  "/api/info",
  infosRouter
);

app.use(
  "/infos",
  infosRouter
);

app.use(
  "/api/projects",
  require("./routes/projects")
);

app.use(
  "/api/devices",
  require("./routes/devices")
);

// Communes
app.use(
  "/api/communes",
  communeRoutes
);

app.use(
  "/communes",
  communeRoutes
);

app.use(
  "/api",
  require("./routes/userRoutes")
);

app.use(
  "/api",
  require("./routes/subscriptions")
);

app.use(
  "/api",
  require("./routes/debug")
);

/* =========================================================
   ROUTE RACINE
========================================================= */

app.get("/", (_req, res) => {
  res.send(
    "API SecuriDem opérationnelle ✅"
  );
});

/* =========================================================
   ROUTE /API/ME DE SECOURS
========================================================= */

app.get(
  "/api/me",
  auth,
  (req, res) => {
    res.json({
      user: {
        id: req.user.id,
        email: req.user.email,
        role: req.user.role,

        communeId:
          req.user.communeId || "",

        communeName:
          req.user.communeName || "",

        tv:
          typeof req.user.tv === "number"
            ? req.user.tv
            : 0,

        impersonated:
          Boolean(req.user.impersonated),

        origUserId:
          req.user.origUserId || null,

        name: null,
        photo: null,
      },
    });
  }
);

/* =========================================================
   SAUVEGARDE AUTOMATIQUE
========================================================= */

cron.schedule(
  "0 3 * * *",
  async () => {
    logger.info(
      "Lancement sauvegarde quotidienne"
    );

    try {
      await runBackup();

      logger.info(
        "Sauvegarde terminée"
      );
    } catch (error) {
      logger.error(
        "Backup failed",
        {
          error: error.stack,
        }
      );
    }
  }
);

/* =========================================================
   GESTIONNAIRE D’ERREURS
========================================================= */

app.use(
  (error, req, res, _next) => {
    logger.error(
      "Erreur serveur 🧨",
      {
        method: req.method,
        url: req.originalUrl,
        error: error.stack,
      }
    );

    res.status(500).json({
      message:
        "Erreur interne du serveur",
    });
  }
);

/* =========================================================
   ROUTES API NON TROUVÉES
========================================================= */

app.use(
  "/api/*",
  (req, res) => {
    res.status(404).json({
      message:
        `Route API introuvable ❌ ` +
        `(${req.method} ${req.originalUrl})`,
    });
  }
);

/* =========================================================
   CORRECTION DES INDEX COMMUNES
========================================================= */

async function fixCommuneIndexes() {
  try {
    const collection =
      mongoose.connection.collection(
        "communes"
      );

    const indexes =
      await collection.indexes();

    /*
     * Supprime l’ancien index unique
     * sur slug si nécessaire.
     */
    const slugIndex =
      indexes.find(
        (index) =>
          index.name === "slug_1"
      );

    if (
      slugIndex &&
      slugIndex.unique
    ) {
      await collection.dropIndex(
        "slug_1"
      );

      logger.info(
        "Index unique slug_1 supprimé ✅"
      );

      await collection.createIndex(
        {
          slug: 1,
        },
        {
          name: "slug_1",
        }
      );

      logger.info(
        "Index slug_1 recréé en non-unique ✅"
      );
    }

    /*
     * Supprime l’ancien index id_1.
     *
     * Le champ id n’est plus utilisé.
     * MongoDB génère automatiquement _id.
     */
    const idIndex =
      indexes.find(
        (index) =>
          index.name === "id_1"
      );

    if (idIndex) {
      await collection.dropIndex(
        "id_1"
      );

      logger.info(
        "Index id_1 supprimé ✅"
      );
    }

    const indexesAfter =
      await collection.indexes();

    logger.info(
      `Indexes communes après correction : ${
        indexesAfter
          .map(
            (index) =>
              index.name
          )
          .join(", ")
      }`
    );
  } catch (error) {
    logger.warn(
      "Impossible de corriger les index des communes",
      {
        error: error.message,
      }
    );
  }
}

/* =========================================================
   CRÉATION DES COMMUNES PAR DÉFAUT
========================================================= */

async function ensureDefaultCommunes() {
  const defaultCommunes = [
    {
      name: "Dembéni",
      slug: "dembeni",
      region: "Mayotte",
      imageUrl:
        "/uploads/communes/dembeni.jpg",
    },
    {
      name: "Mamoudzou",
      slug: "mamoudzou",
      region: "Mayotte",
      imageUrl:
        "/uploads/communes/mamoudzou.jpg",
    },
    {
      name: "Chirongui",
      slug: "chirongui",
      region: "Mayotte",
      imageUrl:
        "/uploads/communes/chirongui.jpg",
    },
  ];

  for (
    const commune
    of defaultCommunes
  ) {
    await Commune.findOneAndUpdate(
      {
        slug: commune.slug,
      },
      {
        $setOnInsert: commune,
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    );
  }

  logger.info(
    "Communes par défaut vérifiées et insérées ✅"
  );
}

/* =========================================================
   DÉMARRAGE DU SERVEUR
========================================================= */

async function startServer() {
  try {
    if (!MONGODB_URI) {
      throw new Error(
        "La variable MONGODB_URI est absente"
      );
    }

    await mongoose.connect(
      MONGODB_URI
    );

    logger.info(
      "MongoDB connecté ✅"
    );

    logger.info(
      `JWT secret fingerprint: ${secretFingerprint()}`
    );

    if (!GITHUB_TOKEN) {
      logger.warn(
        "GITHUB_TOKEN manquant — endpoint /cve retournera []"
      );
    }

    /*
     * Une erreur de maintenance ne doit
     * pas empêcher le serveur de démarrer.
     */
    try {
      await fixCommuneIndexes();
    } catch (error) {
      logger.error(
        "Erreur pendant la correction des index communes",
        {
          error: error.stack,
        }
      );
    }

    /*
     * Une erreur de création des communes
     * ne doit pas empêcher Render
     * de détecter le port HTTP.
     */
    try {
      await ensureDefaultCommunes();
    } catch (error) {
      logger.error(
        "Erreur pendant l’initialisation des communes",
        {
          error: error.stack,
        }
      );
    }

    app.listen(
      PORT,
      HOST,
      () => {
        logger.info(
          `Serveur disponible sur http://${HOST}:${PORT} 🚀`
        );
      }
    );
  } catch (error) {
    logger.error(
      "Connexion MongoDB impossible ❌",
      {
        error: error.stack,
      }
    );

    process.exit(1);
  }
}

/* =========================================================
   GESTION DES ARRÊTS PROPRES
========================================================= */

async function shutdown(signal) {
  logger.info(
    `${signal} reçu, arrêt du serveur...`
  );

  try {
    await mongoose.connection.close();

    logger.info(
      "Connexion MongoDB fermée ✅"
    );
  } catch (error) {
    logger.error(
      "Erreur pendant la fermeture MongoDB",
      {
        error: error.stack,
      }
    );
  }

  process.exit(0);
}

process.on(
  "SIGTERM",
  () => shutdown("SIGTERM")
);

process.on(
  "SIGINT",
  () => shutdown("SIGINT")
);

process.on(
  "unhandledRejection",
  (reason) => {
    logger.error(
      "Promesse non gérée",
      {
        error:
          reason instanceof Error
            ? reason.stack
            : String(reason),
      }
    );
  }
);

process.on(
  "uncaughtException",
  (error) => {
    logger.error(
      "Exception non interceptée",
      {
        error: error.stack,
      }
    );

    process.exit(1);
  }
);

/* =========================================================
   LANCEMENT
========================================================= */

startServer();
