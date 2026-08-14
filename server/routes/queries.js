// server/routes/queries.js
// The four "showcase" graph queries required by the assignment:
//   1. citation-path   - multi-hop variable-length traversal (>= 2 hops)
//   2. recommend       - a query a relational DB would find awkward
//                         (friend-of-friend / collaborative filtering pattern)
//   3. topic-influence  - multi-hop diffusion of ideas through citations
//   4. shortest-path    - shortest collaboration path between two authors
//
// All four use parameterised Cypher via the official driver -- no
// string concatenation of user input into the query text.

const express = require('express');
const { runQuery } = require('../db');
const router = express.Router();

// GET /api/topics
router.get('/topics', async (req, res, next) => {
  try {
    const records = await runQuery(`MATCH (t:Topic) RETURN t.id AS id, t.name AS name ORDER BY t.name`);
    res.json(records.map(r => r.toObject()));
  } catch (err) { next(err); }
});

// GET /api/queries/citation-path?from=P1&to=P2
// Multi-hop (2-4 hop) variable-length traversal along CITES edges.
// This is the classic "recursive ancestry" query that requires a
// recursive CTE (or a loop in application code) in SQL, and is a
// single line of Cypher here.
router.get('/citation-path', async (req, res, next) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({ error: 'bad_request', message: 'from and to paper ids are required' });
    }
    const records = await runQuery(
      `MATCH path = shortestPath((p1:Paper {id: $from})-[:CITES*1..6]->(p2:Paper {id: $to}))
       RETURN [n IN nodes(path) | {id: n.id, title: n.title, year: n.year}] AS nodes,
              length(path) AS hops`,
      { from, to }
    );
    if (records.length === 0) {
      return res.json({ found: false, nodes: [], hops: 0 });
    }
    const row = records[0].toObject();
    res.json({ found: true, nodes: row.nodes, hops: row.hops });
  } catch (err) { next(err); }
});

// GET /api/queries/recommend/:authorId
// "People who collaborated with your collaborators, but not with you yet" --
// a friend-of-a-friend pattern that needs a self-join two levels deep in
// SQL (and a NOT EXISTS anti-join on top of that). In Cypher it's one
// pattern match.
router.get('/recommend/:authorId', async (req, res, next) => {
  try {
    const { authorId } = req.params;
    const records = await runQuery(
      `MATCH (me:Author {id: $authorId})-[:WROTE]->(:Paper)<-[:WROTE]-(collaborator:Author)
             -[:WROTE]->(:Paper)<-[:WROTE]-(candidate:Author)
       WHERE candidate <> me
         AND NOT (me)-[:WROTE]->(:Paper)<-[:WROTE]-(candidate)
       WITH candidate, count(DISTINCT collaborator) AS sharedCollaborators
       OPTIONAL MATCH (candidate)-[:WROTE]->(:Paper)-[:ABOUT]->(t:Topic)<-[:ABOUT]-(:Paper)<-[:WROTE]-(me)
       WITH candidate, sharedCollaborators, count(DISTINCT t) AS sharedTopics
       RETURN candidate.id AS id, candidate.name AS name, candidate.hIndex AS hIndex,
              sharedCollaborators, sharedTopics,
              (sharedCollaborators * 2 + sharedTopics) AS score
       ORDER BY score DESC, sharedCollaborators DESC
       LIMIT 8`,
      { authorId }
    );
    res.json(records.map(r => r.toObject()));
  } catch (err) { next(err); }
});

// GET /api/queries/topic-influence/:topicId
// Multi-hop diffusion: starting from papers about topic T, walk 1-2 CITES
// hops forward and see which *other* topics those citing papers belong to.
// This traces how an idea spreads across fields -- a graph-native question
// that requires recursive traversal, not a lookup.
router.get('/topic-influence/:topicId', async (req, res, next) => {
  try {
    const { topicId } = req.params;
    const records = await runQuery(
      `MATCH (t:Topic {id: $topicId})<-[:ABOUT]-(origin:Paper)<-[:CITES*1..2]-(citing:Paper)-[:ABOUT]->(t2:Topic)
       WHERE t2.id <> t.id
       RETURN t2.id AS id, t2.name AS name, count(DISTINCT citing) AS citingPapers,
              count(DISTINCT origin) AS sourcePapers
       ORDER BY citingPapers DESC
       LIMIT 10`,
      { topicId }
    );
    res.json(records.map(r => r.toObject()));
  } catch (err) { next(err); }
});

// GET /api/queries/shortest-path?from=A1&to=A2
// Shortest collaboration path between two researchers, hopping through
// shared papers (Author-Paper-Author-Paper-...-Author).
router.get('/shortest-path', async (req, res, next) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({ error: 'bad_request', message: 'from and to author ids are required' });
    }
    const records = await runQuery(
      `MATCH path = shortestPath((a1:Author {id: $from})-[:WROTE*..12]-(a2:Author {id: $to}))
       RETURN [n IN nodes(path) | {
                 id: coalesce(n.id, ''),
                 label: coalesce(n.name, n.title),
                 kind: CASE WHEN n:Author THEN 'author' ELSE 'paper' END
               }] AS nodes,
              length(path) AS hops`,
      { from, to }
    );
    if (records.length === 0) {
      return res.json({ found: false, nodes: [], hops: 0 });
    }
    const row = records[0].toObject();
    res.json({ found: true, nodes: row.nodes, hops: row.hops });
  } catch (err) { next(err); }
});

module.exports = router;
