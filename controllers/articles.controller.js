// backend/controllers/articles.controller.js
const mongoose = require("mongoose");
const Article = require("../models/Article"); // adapte le chemin si besoin

// === (Optionnel) Cloudinary ===
// Configurée ailleurs (ex. config/cloudinary.js avec cloudinary.v2.config(...))
let cloudinary = null;
try {
  cloudinary = require("cloudinary").v2;
} catch (_) {
  // Cloudinary non installé : on ignore silencieusement
}

/* ----------------------- Helpers ----------------------- */
function getUserCommune(req) {
  // On accepte soit un slug, soit un ObjectId
  if (req.user?.communeId) return { key: "communeId", value: req.user.communeId };
  if (req.user?.communeSlug) return { key: "communeSlug", value: req.user.communeSlug };
  return null;
}

function assertLocalScopeAllowed(req, payloadCommune) {
  // Autorise la création/màj "locale" uniquement dans la commune de l'admin
  const userCommune = getUserCommune(req);
  if (!userCommune) {
    const err = new Error("Compte non rattaché à une commune");
    err.status = 403;
    throw err;
  }
  if (!payloadCommune) {
    const err = new Error("Commune requise pour la portée locale");
    err.status = 400;
    throw err;
  }
  const { key, value } = userCommune;
  if (String(payloadCommune) !== String(value)) {
    const err = new Error("Commune non autorisée");
    err.status = 403;
    throw err;
  }
}

async function maybeUploadToCloudinary(file) {
  if (!file || !cloudinary) return null;
  // file.path si multer stocke en disque ; file.buffer si storage mémoire
  const uploadOpts = {};
  if (file.buffer && cloudinary.uploader.upload_stream) {
    // Stream upload
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(uploadOpts, (err, res) =>
        err ? reject(err) : resolve(res)
      );
      stream.end(file.buffer);
    });
  }
  // Upload depuis un path (multer diskStorage)
  return cloudinary.uploader.upload(file.path, uploadOpts);
}

/* ----------------------- Controllers ----------------------- */

/**
 * POST /api/articles
 * body: { title, content, visibility, startAt?, endAt?, imageUrl?, tags?, communeId? | communeSlug? }
 * file: (optionnel) image (via multer) -> Cloudinary
 */
exports.createArticle = async (req, res) => {
  try {
    const {
      title,
      content,
      visibility = "local", // "local" | "regional" | "national"
      startAt,
      endAt,
      imageUrl,
      tags = [],
      communeId,
      communeSlug,
    } = req.body;

    if (!title || !content) {
      return res.status(400).json({ message: "Titre et contenu sont requis." });
    }

    // Si visibilité locale => contrôle strict de la commune
    if (visibility === "local") {
      // On prend d'abord la commune du payload, sinon on forcera plus bas
      const payloadCommune = communeId || communeSlug;
      assertLocalScopeAllowed(req, payloadCommune || getUserCommune(req)?.value);
    }

    // Upload éventuel sur Cloudinary
    let finalImageUrl = imageUrl || null;
    let imagePublicId = null;
    if (!finalImageUrl && req.file) {
      const uploaded = await maybeUploadToCloudinary(req.file);
      if (uploaded) {
        finalImageUrl = uploaded.secure_url;
        imagePublicId = uploaded.public_id;
      }
    }

    // Construction de l'objet article
    const doc = {
      title,
      content,
      visibility,
      startAt: startAt ? new Date(startAt) : undefined,
      endAt: endAt ? new Date(endAt) : undefined,
      imageUrl: finalImageUrl,
      imagePublicId,
      tags: Array.isArray(tags) ? tags : typeof tags === "string" ? tags.split(",").map(t => t.trim()).filter(Boolean) : [],
      author: req.user?.id ? new mongoose.Types.ObjectId(req.user.id) : undefined,
      publishedAt: new Date(),
    };

    // Verrouillage commune côté serveur
    const userCommune = getUserCommune(req);
    if (visibility === "local" && userCommune) {
      if (userCommune.key === "communeId") doc.communeId = new mongoose.Types.ObjectId(userCommune.value);
      if (userCommune.key === "communeSlug") doc.communeSlug = userCommune.value;
    } else {
      // Pour d'autres portées, on accepte le payload si fourni (facultatif)
      if (communeId) doc.communeId = new mongoose.Types.ObjectId(communeId);
      if (communeSlug) doc.communeSlug = communeSlug;
    }

    const article = await Article.create(doc);
    return res.status(201).json(article);
  } catch (err) {
    console.error("createArticle error:", err);
    return res.status(err.status || 500).json({ message: err.message || "Erreur serveur" });
    }
};

/**
 * GET /api/articles
 * query: page?, limit?, q?, visibility?, onlyActive? (1|0), communeSlug?, communeId?
 * - Si user admin local -> par défaut on filtre sur sa commune quand visibility=local.
 */
exports.getArticles = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      q,
      visibility,
      onlyActive,
      communeSlug,
      communeId,
    } = req.query;

    const filter = {};
    if (visibility) filter.visibility = visibility;

    // Période d'affichage (startAt/endAt)
    if (String(onlyActive) === "1") {
      const now = new Date();
      filter.$and = [
        { $or: [{ startAt: { $exists: false } }, { startAt: { $lte: now } }] },
        { $or: [{ endAt: { $exists: false } }, { endAt: { $gte: now } }] },
      ];
    }

    // Recherche full-text simple
    if (q) {
      filter.$or = [
        { title: { $regex: q, $options: "i" } },
        { content: { $regex: q, $options: "i" } },
        { tags: { $elemMatch: { $regex: q, $options: "i" } } },
      ];
    }

    // Filtrage commune
    const userCommune = getUserCommune(req);
    if (visibility === "local") {
      // Par défaut, les admins locaux ne voient que leur commune
      if (userCommune) {
        filter[userCommune.key] = userCommune.key === "communeId"
          ? new mongoose.Types.ObjectId(userCommune.value)
          : userCommune.value;
      }
    } else {
      // Sinon, on accepte les filtres explicites
      if (communeId) filter.communeId = new mongoose.Types.ObjectId(communeId);
      if (communeSlug) filter.communeSlug = communeSlug;
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      Article.find(filter)
        .sort({ publishedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Article.countDocuments(filter),
    ]);

    res.json({
      items,
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
    });
  } catch (err) {
    console.error("getArticles error:", err);
    res.status(500).json({ message: "Erreur serveur" });
  }
};

/**
 * GET /api/articles/:id
 */
exports.getArticleById = async (req, res) => {
  try {
    const article = await Article.findById(req.params.id);
    if (!article) return res.status(404).json({ message: "Article introuvable" });

    // Si article local, vérifier l'accès de l'admin à sa commune
    if (article.visibility === "local") {
      const userCommune = getUserCommune(req);
      if (!userCommune || String(article[userCommune.key]) !== String(userCommune.value)) {
        return res.status(403).json({ message: "Accès non autorisé à cette commune" });
      }
    }

    res.json(article);
  } catch (err) {
    console.error("getArticleById error:", err);
    res.status(500).json({ message: "Erreur serveur" });
  }
};

/**
 * PUT /api/articles/:id
 * body: mêmes champs que create
 * file: (optionnel) nouvelle image
 */
exports.updateArticle = async (req, res) => {
  try {
    const id = req.params.id;
    const article = await Article.findById(id);
    if (!article) return res.status(404).json({ message: "Article introuvable" });

    // Contrôle commune si local
    if (article.visibility === "local") {
      const userCommune = getUserCommune(req);
      if (!userCommune) return res.status(403).json({ message: "Compte non rattaché à une commune" });
      if (String(article[userCommune.key]) !== String(userCommune.value)) {
        return res.status(403).json({ message: "Commune non autorisée" });
      }
    }

    const {
      title,
      content,
      visibility,
      startAt,
      endAt,
      imageUrl,
      tags,
      communeId,
      communeSlug,
    } = req.body;

    // Empêche de déplacer un article local hors de la commune de l'admin
    if (visibility === "local") {
      const userCommune = getUserCommune(req);
      assertLocalScopeAllowed(req, (communeId || communeSlug || article.communeId || article.communeSlug));
      if (userCommune.key === "communeId") article.communeId = new mongoose.Types.ObjectId(userCommune.value);
      if (userCommune.key === "communeSlug") article.communeSlug = userCommune.value;
    } else {
      // visibilité non locale : accepte un changement facultatif
      if (communeId) article.communeId = new mongoose.Types.ObjectId(communeId);
      if (communeSlug) article.communeSlug = communeSlug;
    }

    if (typeof title === "string") article.title = title;
    if (typeof content === "string") article.content = content;
    if (typeof visibility === "string") article.visibility = visibility;
    if (startAt !== undefined) article.startAt = startAt ? new Date(startAt) : undefined;
    if (endAt !== undefined) article.endAt = endAt ? new Date(endAt) : undefined;
    if (tags !== undefined) {
      article.tags = Array.isArray(tags) ? tags : typeof tags === "string" ? tags.split(",").map(t => t.trim()).filter(Boolean) : [];
    }

    // Gestion image: nouvelle imageUrl OU upload fichier
    if (imageUrl !== undefined) {
      // Si on remplace une image Cloudinary, supprimer l'ancienne si public_id connu
      if (article.imagePublicId && cloudinary && imageUrl && imageUrl !== article.imageUrl) {
        try { await cloudinary.uploader.destroy(article.imagePublicId); } catch {}
        article.imagePublicId = null;
      }
      article.imageUrl = imageUrl || null;
    } else if (req.file) {
      // upload nouvelle image
      const uploaded = await maybeUploadToCloudinary(req.file);
      if (uploaded) {
        if (article.imagePublicId && cloudinary) {
          try { await cloudinary.uploader.destroy(article.imagePublicId); } catch {}
        }
        article.imageUrl = uploaded.secure_url;
        article.imagePublicId = uploaded.public_id;
      }
    }

    const saved = await article.save();
    res.json(saved);
  } catch (err) {
    console.error("updateArticle error:", err);
    res.status(err.status || 500).json({ message: err.message || "Erreur serveur" });
  }
};

/**
 * DELETE /api/articles/:id
 */
exports.deleteArticle = async (req, res) => {
  try {
    const id = req.params.id;
    const article = await Article.findById(id);
    if (!article) return res.status(404).json({ message: "Article introuvable" });

    // Contrôle commune si local
    if (article.visibility === "local") {
      const userCommune = getUserCommune(req);
      if (!userCommune) return res.status(403).json({ message: "Compte non rattaché à une commune" });
      if (String(article[userCommune.key]) !== String(userCommune.value)) {
        return res.status(403).json({ message: "Commune non autorisée" });
      }
    }

    // Suppression image Cloudinary si présente
    if (article.imagePublicId && cloudinary) {
      try { await cloudinary.uploader.destroy(article.imagePublicId); } catch {}
    }

    await article.deleteOne();
    res.json({ message: "Article supprimé" });
  } catch (err) {
    console.error("deleteArticle error:", err);
    res.status(500).json({ message: "Erreur serveur" });
  }
};
