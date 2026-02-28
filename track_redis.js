import('dotenv').then(d => d.config({ path: '.env.vercel.local' }))
  .then(() => import('./api/utils/storage.js'))
  .then(async (m) => {
    const client = m.getRedisClient();
    console.log('👀 Monitoring candidate deletions...');
    
    await client.monitor((err, monitor) => {
        if (err) {
            console.error('Monitor start error:', err);
            process.exit(1);
        }
        console.log('▶️ Monitor is active, listening for DEL, UNLINK, SREM, ZREM...');
        
        monitor.on('monitor', (time, args, source, database) => {
            const cmd = args[0].toUpperCase();
            if (['DEL', 'UNLINK', 'SREM', 'ZREM', 'HDEL'].includes(cmd)) {
                // Ignore routine log messages
                const target = args.slice(1).join(' ');
                if (target.includes('candidate') && !target.includes('webhook:processed') && !target.includes('messages:') && !target.includes('stats:') && !target.includes('lock:')) {
                    console.log(`[${new Date(Math.floor(time * 1000)).toISOString()}] 🚨 SUSPICIOUS DELETION: ${cmd} ${target}`);
                    console.log('Command Array:', args);
                }
            }
        });
    });
});
