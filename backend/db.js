// MongoDB connection with pooling + startup index creation.
// Exposes a single shared client so every request reuses the pool.

const { MongoClient } = require('mongodb');
const env = require('./config');

let client = null;
let db = null;

async function connect() {
  if (db) return db;

  const newClient = new MongoClient(env.MONGO_URI, {
    maxPoolSize: 10,
    minPoolSize: 1,
    serverSelectionTimeoutMS: 5000,
    retryWrites: true,
  });

  try {
    await newClient.connect();
    const newDb = newClient.db(env.DB_NAME);

    // Indexes — idempotent, safe to call on every boot
    await Promise.all([
      newDb.collection('users').createIndex({ email: 1 }, { unique: true }),
      newDb.collection('leads').createIndex({ createdAt: -1 }),
      newDb.collection('leads').createIndex({ email: 1 }),
      newDb.collection('leads').createIndex({ status: 1 }),
    ]);

    // Only commit to the module-level refs after everything succeeds, so
    // failures leave db=null (and the retry loop in server.js tries again).
    client = newClient;
    db = newDb;
    console.log(`✅ Mongo connected (${env.DB_NAME})`);
    return db;
  } catch (err) {
    // Best-effort cleanup so we don't leak a connection on failure.
    try { await newClient.close(); } catch (_) { /* ignore */ }
    throw err;
  }
}

function getDb() {
  if (!db) throw new Error('Mongo not connected — call connect() first');
  return db;
}

async function close() {
  if (client) await client.close();
  client = null; db = null;
}

module.exports = { connect, getDb, close };
