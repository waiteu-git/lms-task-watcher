module.exports = {
  apps: [
    {
      name: 'letus-api',
      script: 'server.js',
      cwd: '/home/pi/letus-api',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      watch: false,
      restart_delay: 5000,
      max_restarts: 10,
    },
  ],
}
