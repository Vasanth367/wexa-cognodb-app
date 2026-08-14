// server/dbGuard.js
// Middleware that returns a clean 503 (instead of a stack trace) when
// CognoDB is unreachable -- satisfies the "graceful error handling
// when the database is unreachable" requirement.

const { getConnectivityError } = require('./db');

function dbGuard(req, res, next) {
  const err = getConnectivityError();
  if (err) {
    return res.status(503).json({
      error: 'database_unreachable',
      message: 'Could not reach CognoDB. Check COGNODB_URI / COGNODB_PASSWORD and that the instance is running.',
      detail: err,
    });
  }
  next();
}

module.exports = dbGuard;
