// PM2 config. The bootstrap script writes /home/ubuntu/backend/.env from
// SSM Parameter Store, and dotenv picks that up automatically.
module.exports = {
  apps: [{
    name: 'resumeright',
    script: 'server.js',
    exec_mode: 'fork',
    instances: 1,
    max_memory_restart: '400M',
    env: { NODE_ENV: 'production' },
    time: true,
  }],
};
