module.exports = {
  apps: [
    {
      name: 'cf-nest-api-v2',
      script: 'dist/src/main.js',
      // watch: true, // optional for dev
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
  ],
};
