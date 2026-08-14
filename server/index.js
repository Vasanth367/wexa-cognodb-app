// server/index.js
require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const { verifyConnectivity, getConnectivityError, closeDriver } = require('./db');
const dbGuard = require('./dbGuard');
const authorsRouter = require('./routes/authors');
const papersRouter = require('./routes/papers');
const queriesRouter = require('./routes/queries');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Health check -- reports whether CognoDB is currently reachable.
app.get('/api/health', async (req, res) => {
  const err = getConnectivityError();
  res.json({ status: err ? 'degraded' : 'ok', dbError: err || null });
});

app.use('/api/authors', dbGuard, authorsRouter);
app.use('/api/papers', dbGuard, papersRouter);
app.use('/api/queries', dbGuard, queriesRouter);

// Central error handler -- keeps stack traces out of API responses.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'internal_error', message: err.message });
});

async function start() {
  const ok = await verifyConnectivity();
  if (!ok) {
    console.warn('WARNING: could not connect to CognoDB at startup.');
    console.warn('  ->', getConnectivityError());
    console.warn('  The server will still start; API routes will return 503 until the DB is reachable.');
  } else {
    console.log('Connected to CognoDB successfully.');
  }

  // Retry connectivity in the background every 15s in case the DB
  // becomes reachable after startup (e.g. instance was still spinning up).
  setInterval(() => { verifyConnectivity(); }, 15000);

  app.listen(PORT, () => {
    console.log(`Paper Trail server listening on http://localhost:${PORT}`);
  });
}

process.on('SIGINT', async () => {
  await closeDriver();
  process.exit(0);
});

start();
