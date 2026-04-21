// MongoDB connection with pooling + startup index creation.
// Exposes a single shared client so every request reuses the pool.

const { MongoClient } = require('mongodb');
const env = require('./config');

let client = null;
let db = null;

async function connect() {
  if (db) return db;

  client = new MongoClient(env.MONGO_URI, {
    maxPoolSize: 10,
    minPoolSize: 1,
    serverSelectionTimeoutMS: 5000,
    retryWrites: true,
  });

  await client.connect();
  db = client.db(env.DB_NAME);

  // Indexes — idempotent, safe to call on every boot
  await Promise.all([
    db.collection('users').createIndex({ email: 1 }, { unique: true }),
    db.collection('leads').createIndex({ createdAt: -1 }),
    db.collection('leads').createIndex({ email: 1 }),
    db.collection('leads').createIndex({ status: 1 }),
  ]);

  console.log(`✅ Mongo connected (${env.DB_NAME})`);
  return db;
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
