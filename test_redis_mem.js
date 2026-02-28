import('dotenv').then(d => d.config({ path: '.env.vercel.local' }))
  .then(() => import('./api/utils/storage.js'))
  .then(async (m) => {
    const client = m.getRedisClient();
    try {
      const info = await client.info('memory');
      console.log(info);
    } catch (e) {
      console.log(e);
    }
    process.exit(0);
  });
