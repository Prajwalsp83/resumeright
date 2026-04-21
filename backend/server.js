const { app, connectDb } = require('./app');
const env = require('./config');

async function main() {
  await connectDb();
  const server = app.listen(env.PORT, '0.0.0.0', () => {
    console.log(`🚀 ResumeRight backend on :${env.PORT} (${env.NODE_ENV})`);
  });

  const shutdown = sig => () => {
    console.log(`received ${sig}, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', shutdown('SIGTERM'));
  process.on('SIGINT',  shutdown('SIGINT'));
}

main().catch(err => {
  console.error('fatal startup error:', err);
  process.exit(1);
});
