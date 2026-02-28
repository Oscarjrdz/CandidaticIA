import('dotenv').then(d => d.config({ path: '.env.vercel.local' }))
    .then(() => import('./api/utils/storage.js'))
    .then(async (m) => {
        const client = m.getRedisClient();
        try {
            // get top 5
            const ids = await client.zrevrange('candidates:list', 0, 5, 'WITHSCORES');
            console.log("Returned array length:", ids.length);
            for (let i = 0; i < ids.length; i += 2) {
                const id = ids[i];
                const score = ids[i + 1];
                const cRaw = await client.get(`candidate:${id}`);
                const c = JSON.parse(cRaw || "{}");
                console.log(`ID: ${id}`);
                console.log(`Score: ${score} -> ${new Date(parseInt(score)).toLocaleString()}`);
                console.log(`WhatsApp: ${c.whatsapp}`);
                console.log(`Nombre: ${c.nombre} / ${c.nombreReal}`);
                console.log('---');
            }
        } catch (e) {
            console.error(e);
        }
        process.exit(0);
    });
