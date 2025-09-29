// backend/controllers/articles.controller.js
const Article = require("../models/Article");

// (Optionnel) Cloudinary
let cloudinary = null;
try { cloudinary = require("cloudinary").v2; } catch (_) {}

function getUserCommune(req) {
  if (req.user?.communeId) return { key: "communeId", value: String(req.user.communeId) };
  return null;
}

function assertLocalScopeAllowed(req, payloadCommune) {
  const userCommune = getUserCommune(req);
  if (!userCommune) {
    const err = new Error("Compte non rattaché à une commune");
    err.status = 403; throw err;
  }
  if (!payloadCommune) {
    const err = new Error("Commune requise pour la portée locale");
    err.status = 400; throw err;
  }
  if (String(payloadCommune) !== String(userCommune.value)) {
    const err = new Error("Commune non autorisée");
    err.status = 403; throw err;
  }
}

async function maybeUploadToCloudinary(file) {
  if (!file || !cloudinary) return null;
  const uploadOpts = {};
  if (file.buffer && cloudinary.uploader.upload_stream) {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(uploadOpts, (err, res) =>
        err ? reject(err) : resolve(res)
      );
      stream.end(file.buffer);
    });
  }
  return cloudinary.uploader.upload(file.path, uploadOpts);
}

const isHttpUrl = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);

/**
 * POST /api/articles
 * body: { title, content, visibility, startAt?, endAt?, imageUrl?, communeId?, authorName?, publisher?, sourceUrl?, status? }
 */
exports.createArticle = async (req, res) => {
  try {
    const {
      title, content,
      visibility = "local",
      startAt, endAt, imageUrl,
      communeId,
      authorName, publisher, sourceUrl, status,
    } = req.body || {};

    if (!title || !content) return res.status(400).json({ message: "Titre et contenu sont requis." });

    if (visibility === "local") {
      const payloadCommune = communeId || getUserCommune(req)?.value;
      assertLocalScopeAllowed(req, payloadCommune);
    }

    let finalImageUrl = imageUrl || null;
    let imagePublicId = null;
    if (!finalImageUrl && req.file) {
      const uploaded = await maybeUploadToCloudinary(req.file);
      if (uploaded) {
        finalImageUrl = uploaded.secure_url;
        imagePublicId = uploaded.public_id;
      }
    }

    const doc = {
      title: String(title).trim(),
      content: String(content).trim(),
      visibility,
      startAt: startAt ? new Date(startAt) : null,
      endAt:   endAt   ? new Date(endAt)   : null,
      imageUrl: finalImageUrl,
      imagePublicId,

      authorId: req.user?.id ? String(req.user.id) : '',
      authorEmail: req.user?.email || '',

      // métadonnées Play
      publishedAt: new Date(),
      authorName: (authorName || '').trim(),
      publisher: (publisher && String(publisher).trim()) || 'Association Bellevue Dembeni',
      sourceUrl: isHttpUrl(sourceUrl) ? sourceUrl : '',
      status: status === 'draft' ? 'draft' : 'published',

      // multi-commune
      communeId: '',
      audienceCommunes: [],
    };

    const userCommune = getUserCommune(req);
    if (visibility === "local" && userCommune) {
      doc.communeId = String(userCommune.value);
    } else if (communeId) {
      doc.communeId = String(communeId);
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
 * query: page?, limit?, q?, visibility?, onlyActive? (1|0), communeId?
 */
exports.getArticles = async (req, res) => {
  try {
    const { page = 1, limit = 10, q, visibility, onlyActive, communeId } = req.query;

    const filter = {};
    if (visibility) filter.visibility = visibility;

    if (String(onlyActive) === "1") {
      const now = new Date();
      filter.$and = [
        { $or: [{ startAt: { $exists: false } }, { startAt: null }, { startAt: { $lte: now } }] },
        { $or: [{ endAt: { $exists: false } }, { endAt: null }, { endAt: { $gte: now } }] },
      ];
    }

    if (q) {
      filter.$or = [
        { title:   { $regex: q, $options: "i" } },
        { content: { $regex: q, $options: "i" } },
      ];
    }

    const userCommune = getUserCommune(req);
    if (visibility === "local") {
      if (userCommune) filter[userCommune.key] = String(userCommune.value);
    } else if (communeId) {
      filter.communeId = String(communeId);
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      Article.find(filter)
        .sort({ status: -1, priority: -1, publishedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Article.countDocuments(filter),
    ]);

    res.json({ items, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
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
    const id = String(req.params.id || '').trim();
    if (!id || id.length < 12) return res.status(400).json({ message: "ID invalide" });

    const article = await Article.findById(id);
    if (!article) return res.status(404).json({ message: "Article introuvable" });

    // (si routé via contrôleur en admin uniquement — la route publique gère déjà ses propres règles)
    res.json(article);
  } catch (err) {
    console.error("getArticleById error:", err);
    res.status(500).json({ message: "Erreur serveur" });
  }
};

/**
 * PUT /api/articles/:id
 */
exports.updateArticle = async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id || id.length < 12) return res.status(400).json({ message: "ID invalide" });

    const article = await Article.findById(id);
    if (!article) return res.status(404).json({ message: "Article introuvable" });

    if (article.visibility === "local") {
      const userCommune = getUserCommune(req);
      if (!userCommune) return res.status(403).json({ message: "Compte non rattaché à une commune" });
      if (String(article[userCommune.key]) !== String(userCommune.value)) {
        return res.status(403).json({ message: "Commune non autorisée" });
      }
    }

    const {
      title, content, visibility, startAt, endAt, imageUrl, communeId,
      publishedAt, authorName, publisher, sourceUrl, status,
    } = req.body || {};

    if (visibility === "local") {
      const userCommune = getUserCommune(req);
      assertLocalScopeAllowed(req, (communeId || article.communeId));
      article.communeId = userCommune ? String(userCommune.value) : String(communeId || article.communeId || '');
      article.visibility = 'local';
    } else if (typeof visibility === 'string' && ['global','custom'].includes(visibility)) {
      article.visibility = visibility;
      article.communeId = '';
    }

    if (typeof title === "string")   article.title = String(title).trim();
    if (typeof content === "string") article.content = String(content).trim();

    if (startAt !== undefined) article.startAt = startAt ? new Date(startAt) : null;
    if (endAt   !== undefined) article.endAt   = endAt   ? new Date(endAt)   : null;

    if (imageUrl !== undefined) {
      article.imageUrl = imageUrl || null;
    } else if (req.file) {
      const uploaded = await maybeUploadToCloudinary(req.file);
      if (uploaded) {
        article.imageUrl = uploaded.secure_url;
        article.imagePublicId = uploaded.public_id || null;
      }
    }

    if (publishedAt !== undefined) article.publishedAt = publishedAt ? new Date(publishedAt) : (article.publishedAt || new Date());
    if (authorName  !== undefined) article.authorName  = String(authorName || '').trim();
    if (publisher   !== undefined) article.publisher   = String(publisher || 'Association Bellevue Dembeni').trim();
    if (sourceUrl   !== undefined) article.sourceUrl   = isHttpUrl(sourceUrl) ? sourceUrl : '';
    if (status      !== undefined) article.status      = status === 'draft' ? 'draft' : 'published';

    const saved = await article.save();
    res.json(saved);
  } catch (err) {
    console.error("updateArticle error:", err);
    res.status(err.status || 500).json({ message: err.message || "Erreur serveur" });
  }
};

exports.deleteArticle = async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id || id.length < 12) return res.status(400).json({ message: "ID invalide" });

    const article = await Article.findById(id);
    if (!article) return res.status(404).json({ message: "Article introuvable" });

    if (article.visibility === "local") {
      const userCommune = getUserCommune(req);
      if (!userCommune) return res.status(403).json({ message: "Compte non rattaché à une commune" });
      if (String(article[userCommune.key]) !== String(userCommune.value)) {
        return res.status(403).json({ message: "Commune non autorisée" });
      }
    }

    if (article.imagePublicId && cloudinary) {
      try { await cloudinary.uploader.destroy(article.imagePublicId); } catch (_) {}
    }

    await article.deleteOne();
    res.json({ message: "Article supprimé" });
  } catch (err) {
    console.error("deleteArticle error:", err);
    res.status(500).json({ message: "Erreur serveur" });
  }
};
