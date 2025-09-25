module.exports = {
  apps: [
    {
      name: 'cf-nest-api-v2',
      script: 'dist/src/main.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      //   env_production: {
      //     NODE_ENV: 'production',
      //     PORT: 3000,
      //   },
    },
    {
      name: 'dev-cf-nest-api-v2',
      script: 'dist/src/main.js',
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
    },
    {
      name: 'stag-cf-nest-api-v2',
      script: 'dist/src/main.js',
      // watch: true, // optional for dev
      env: {
        NODE_ENV: 'staging',
        PORT: 3001,
      },
    },
  ],
};
