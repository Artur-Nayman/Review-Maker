module.exports = {
  apps: [
    {
      name: 'review-maker-server',
      script: 'server/index.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      watch: false,
      restart_delay: 5000,
      max_restarts: 10,
      exp_backoff_restart_delay: 100,
      kill_timeout: 10000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: 'logs/pm2-server-error.log',
      out_file: 'logs/pm2-server-out.log',
      merge_logs: true
    },
    {
      name: 'review-maker-bot',
      script: 'bot/index.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production'
      },
      watch: false,
      restart_delay: 5000,
      max_restarts: 10,
      exp_backoff_restart_delay: 100,
      kill_timeout: 10000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: 'logs/pm2-bot-error.log',
      out_file: 'logs/pm2-bot-out.log',
      merge_logs: true
    }
  ]
};
