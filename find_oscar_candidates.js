import('dotenv').then(d => d.config({ path: '.env.vercel.local' }))
  .then(() => import('./api/utils/storage.js'))
  .then(async (m) => {
      const client = m.getRedisClient();
      console.log('Fetching all candidates to check for duplicate Oscar phones...');
      const ids = await client.zrevrange('candidates:list', 0, -1);
      
      const pipeline = client.pipeline();
      ids.forEach(id => pipeline.get(`candidate:${id}`));
      const results = await pipeline.exec();
      
      let count = 0;
      results.forEach(([err, res], i) => {
          if (res) {
              const c = JSON.parse(res);
              if (c.whatsapp && c.whatsapp.includes('8116038195')) {
                  console.log(`FOUND: ID=${ids[i]} | phone=${c.whatsapp} | name=${c.nombre} | Created=${c.primerContacto}`);
                  count++;
              }
          }
      });
      console.log(`Total clones of Oscar found: ${count}`);
      process.exit(0);
  });
