const { app, connectDb } = require('./app');
const env = require('./config');
const { setIo } = require('./activity');

// Listen FIRST, then connect to Mongo in the background. This keeps the
// process alive (and the ALB target healthy on /healthz) even if Mongo is
// briefly unreachable — DB-dependent routes will 503 until the connection
// succeeds, but the process won't crash-loop.
const server = app.listen(env.PORT, '0.0.0.0', () => {
  console.log(`🚀 ResumeRight backend on :${env.PORT} (${env.NODE_ENV})`);
});

// D3 — socket.io for the real-time activity ticker. Attaches to the same HTTP
// server (app.listen returns it). Namespace '/activity'. CORS mirrors the REST
// allowlist. Lazy-required so a missing dep can't crash the API on boot.
try {
  const { Server } = require('socket.io');
  const allowAll = env.CORS_ORIGINS.length === 1 && env.CORS_ORIGINS[0] === '*';
  const io = new Server(server, {
    cors: { origin: allowAll ? '*' : env.CORS_ORIGINS, methods: ['GET', 'POST'] },
  });
  setIo(io);
  console.log('✓ socket.io /activity ready');
} catch (e) {
  console.warn('⚠️  socket.io not available — activity ticker disabled:', e.message);
}

// Retry Mongo connection with exponential backoff so transient Atlas hiccups
// (cold start, DNS blip) don't require a pm2 restart.
(async function connectWithRetry(attempt = 1) {
  try {
    await connectDb();
    console.log('✓ MongoDB connected');
  } catch (err) {
    const delay = Math.min(30_000, 1000 * 2 ** attempt);
    console.error(`Mongo connect failed (attempt ${attempt}): ${err.message}. retrying in ${delay}ms`);
    setTimeout(() => connectWithRetry(attempt + 1), delay);
  }
})();

const shutdown = sig => () => {
  console.log(`received ${sig}, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', shutdown('SIGTERM'));
process.on('SIGINT',  shutdown('SIGINT'));

// Never crash the process on an unhandled error — log and continue so the
// ALB target stays healthy and pm2 doesn't enter a restart loop.
process.on('unhandledRejection', err => {
  console.error('unhandledRejection:', err);
});
process.on('uncaughtException', err => {
  console.error('uncaughtException:', err);
});
