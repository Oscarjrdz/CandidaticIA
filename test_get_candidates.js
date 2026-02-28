import('dotenv').then(d => d.config({ path: '.env.vercel.local' }))
  .then(() => import('./api/utils/storage.js'))
  .then(async (m) => {
      const { getCandidates } = m;
      const res = await getCandidates(10, 0, '');
      console.log('Total:', res.total);
      res.candidates.forEach(c => console.log(c.id, c.whatsapp, c.nombre, c.proyecto));
      process.exit(0);
  });
