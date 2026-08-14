// server/routes/papers.js
const express = require('express');
const { runQuery } = require('../db');
const router = express.Router();

// GET /api/papers?search=xyz
router.get('/', async (req, res, next) => {
  try {
    const search = (req.query.search || '').trim();
    const records = await runQuery(
      `MATCH (p:Paper)
       WHERE $search = '' OR toLower(p.title) CONTAINS toLower($search)
       RETURN p.id AS id, p.title AS title, p.year AS year, p.venue AS venue
       ORDER BY p.year DESC
       LIMIT 25`,
      { search }
    );
    res.json(records.map(r => r.toObject()));
  } catch (err) { next(err); }
});

module.exports = router;
