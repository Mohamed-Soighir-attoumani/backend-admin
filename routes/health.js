// routes/health.js
import express from 'express';
const router = express.Router();
router.get('/health', (_, res) => res.json({ status: 'ok', timestamp: Date.now() }));
export default router;
