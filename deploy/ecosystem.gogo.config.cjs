/**
 * pm2 config for gogo.org.in, on its own dedicated VPS (nothing else runs here).
 *
 * Start:   pm2 start deploy/ecosystem.config.cjs
 * Reload:  pm2 reload gogo-api
 * Status:  pm2 status
 * Logs:    pm2 logs gogo-api
 */
module.exports = {
  apps: [
    {
      name: 'gogo-api',
      cwd: '/var/www/gogo/Backend',
      script: 'server.js',
      // fork, not cluster: the booking scheduler and the socket namespace are
      // singletons. Two workers would double every dispatch/alert.
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '20s',
      max_memory_restart: '600M',
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
      error_file: '/var/log/pm2/gogo-api.error.log',
      out_file: '/var/log/pm2/gogo-api.out.log',
      merge_logs: true,
      time: true,
      kill_timeout: 12000,
    },
    {
      // The BullMQ consumers. package.json declares six worker entrypoints;
      // src/queues/workers/index.js runs all six in one process. Without this,
      // BULLMQ_ENABLED=true just piles jobs into Redis with nothing to drain them.
      name: 'gogo-workers',
      cwd: '/var/www/gogo/Backend',
      script: 'src/queues/workers/index.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '20s',
      max_memory_restart: '500M',
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
      kill_timeout: 20000,
      error_file: '/var/log/pm2/gogo-workers.error.log',
      out_file: '/var/log/pm2/gogo-workers.out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
