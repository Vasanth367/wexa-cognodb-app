// server/db.js
// Thin wrapper around the official Neo4j driver, pointed at CognoDB.
// CognoDB speaks openCypher over Bolt, so the standard neo4j-driver
// works unmodified -- only the connection details change.

const neo4j = require('neo4j-driver');

const URI = process.env.COGNODB_URI;
const USER = process.env.COGNODB_USER || 'cognodb';
const PASSWORD = process.env.COGNODB_PASSWORD;

let driver = null;
let connectivityError = null;

function getDriver() {
  if (!URI || !PASSWORD) {
    throw new Error(
      'Missing COGNODB_URI or COGNODB_PASSWORD. Copy .env.example to .env and fill in ' +
      'the connection details from console.cognodb.com.'
    );
  }
  if (!driver) {
    driver = neo4j.driver(URI, neo4j.auth.basic(USER, PASSWORD), {
      maxConnectionPoolSize: 20,
      connectionAcquisitionTimeout: 10000,
    });
  }
  return driver;
}

// Called once at startup so the server can report a clear error instead
// of failing mysteriously on the first request.
async function verifyConnectivity() {
  try {
    const d = getDriver();
    await d.verifyConnectivity();
    connectivityError = null;
    return true;
  } catch (err) {
    connectivityError = err.message;
    return false;
  }
}

function getConnectivityError() {
  return connectivityError;
}

// Every route uses this helper so query params are always passed
// parameterised (never string-concatenated into the Cypher text).
async function runQuery(cypher, params = {}) {
  const d = getDriver();
  const session = d.session();
  try {
    const result = await session.run(cypher, params);
    return result.records;
  } finally {
    await session.close();
  }
}

async function closeDriver() {
  if (driver) await driver.close();
}

module.exports = { getDriver, verifyConnectivity, getConnectivityError, runQuery, closeDriver };
