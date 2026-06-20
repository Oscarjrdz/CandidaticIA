import Redis from 'ioredis';
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

async function run() {
    try {
        console.log('--- REDIS NETWORK & BANDWIDTH AUDIT ---');
        
        // 1. Get raw INFO stats
        const infoStats = await redis.info('stats');
        const statsLines = infoStats.split('\n');
        const totalNetInput = statsLines.find(l => l.startsWith('total_net_input_bytes:'));
        const totalNetOutput = statsLines.find(l => l.startsWith('total_net_output_bytes:'));
        
        console.log('\nINFO STATS:');
        console.log(' ', totalNetInput ? totalNetInput.trim() : 'total_net_input_bytes: N/A');
        console.log(' ', totalNetOutput ? totalNetOutput.trim() : 'total_net_output_bytes: N/A');

        // 2. Get client connections info
        const infoClients = await redis.info('clients');
        console.log('\nCLIENTS INFO:');
        console.log(infoClients.split('\n').filter(l => l.trim() && !l.startsWith('#')).map(l => '  ' + l.trim()).join('\n'));

        // 3. Scan for stats:bandwidth:* keys and retrieve their values
        console.log('\nBANDWIDTH HISTORICAL KEYS:');
        let cursor = '0';
        const bwKeys = [];
        do {
            const result = await redis.scan(cursor, 'MATCH', 'stats:bandwidth:*', 'COUNT', 100);
            cursor = result[0];
            bwKeys.push(...result[1]);
        } while (cursor !== '0');

        if (bwKeys.length === 0) {
            console.log('  No stats:bandwidth:* keys found.');
        } else {
            // Fetch values for all found bandwidth keys
            const pipeline = redis.pipeline();
            bwKeys.forEach(k => pipeline.get(k));
            const results = await pipeline.exec();
            
            const records = bwKeys.map((key, i) => {
                const val = results[i][1];
                const bytes = val ? parseInt(val, 10) : 0;
                const mb = (bytes / (1024 * 1024)).toFixed(2);
                return { key, val, mb: `${mb} MB` };
            });
            
            // Sort by key name
            records.sort((a, b) => b.key.localeCompare(a.key));
            console.table(records);
        }
        
    } catch(e) {
        console.error('Error during fast audit:', e);
    }
    process.exit(0);
}
run();
