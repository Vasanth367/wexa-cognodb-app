// server/routes/authors.js
const express = require('express');
const { runQuery } = require('../db');
const router = express.Router();

// GET /api/authors?search=xyz
// Simple lookup used to populate the search boxes in the UI.
router.get('/', async (req, res, next) => {
  try {
    const search = (req.query.search || '').trim();
    const records = await runQuery(
      `MATCH (a:Author)
       WHERE $search = '' OR toLower(a.name) CONTAINS toLower($search)
       RETURN a.id AS id, a.name AS name, a.hIndex AS hIndex
       ORDER BY a.name
       LIMIT 25`,
      { search }
    );
    res.json(records.map(r => r.toObject()));
  } catch (err) { next(err); }
});

// GET /api/authors/:id
// Author profile: their papers, co-authors and affiliation, shaped as
// a small nodes/edges graph the frontend can render directly with vis-network.
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const profileRecords = await runQuery(
      `MATCH (a:Author {id: $id})
       OPTIONAL MATCH (a)-[:AFFILIATED_WITH]->(i:Institution)
       RETURN a.id AS id, a.name AS name, a.hIndex AS hIndex, a.joinedYear AS joinedYear,
              i.name AS institution, i.country AS country`,
      { id }
    );
    if (profileRecords.length === 0) {
      return res.status(404).json({ error: 'not_found', message: `No author with id ${id}` });
    }
    const profile = profileRecords[0].toObject();

    // Multi-hop: papers this author wrote, the co-authors on those papers,
    // and one more hop out to papers those co-authors also wrote.
    const graphRecords = await runQuery(
      `MATCH (a:Author {id: $id})-[:WROTE]->(p:Paper)
       OPTIONAL MATCH (co:Author)-[:WROTE]->(p)
       WHERE co.id <> a.id
       RETURN p.id AS paperId, p.title AS paperTitle, p.year AS year, p.venue AS venue,
              collect(DISTINCT {id: co.id, name: co.name}) AS coAuthors
       ORDER BY p.year DESC`,
      { id }
    );

    const papers = graphRecords.map(r => r.toObject());

    // Build a nodes/edges structure for the graph visualization.
    const nodes = new Map();
    const edges = [];
    nodes.set(profile.id, { id: profile.id, label: profile.name, group: 'me' });
    for (const p of papers) {
      nodes.set(p.paperId, { id: p.paperId, label: p.paperTitle, group: 'paper' });
      edges.push({ from: profile.id, to: p.paperId, label: 'WROTE' });
      for (const co of p.coAuthors) {
        if (!co.id) continue;
        nodes.set(co.id, { id: co.id, label: co.name, group: 'coauthor' });
        edges.push({ from: co.id, to: p.paperId, label: 'WROTE' });
      }
    }

    res.json({
      profile,
      papers,
      graph: { nodes: Array.from(nodes.values()), edges },
    });
  } catch (err) { next(err); }
});

module.exports = router;
