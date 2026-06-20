import Redis from 'ioredis';
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

async function run() {
    try {
        console.log('Fetching all keys...');
        let cursor = '0';
        let keys = [];
        do {
            const result = await redis.scan(cursor, 'MATCH', '*', 'COUNT', 1000);
            cursor = result[0];
            keys.push(...result[1]);
        } while (cursor !== '0');
        
        console.log(`Found ${keys.length} keys. Auditing sizes in parallel...`);
        
        const keySizes = [];
        const CHUNK_SIZE = 100;
        
        for (let i = 0; i < keys.length; i += CHUNK_SIZE) {
            const chunk = keys.slice(i, i + CHUNK_SIZE);
            const pipeline = redis.pipeline();
            chunk.forEach(k => {
                pipeline.type(k);
                pipeline.memory('usage', k);
            });
            const results = await pipeline.exec();
            
            for (let j = 0; j < chunk.length; j++) {
                const k = chunk[j];
                const type = results[j * 2][1];
                const size = results[j * 2 + 1][1] || 0;
                keySizes.push({ key: k, size, type });
            }
            if (i % 1000 === 0 && i > 0) {
                console.log(`Processed ${i}/${keys.length}...`);
            }
        }
        
        keySizes.sort((a, b) => b.size - a.size);
        console.log('\nTop 30 largest keys:');
        console.table(keySizes.slice(0, 30).map(k => ({
            key: k.key,
            type: k.type,
            size_kb: Math.round(k.size/1024),
            size_mb: parseFloat((k.size / (1024 * 1024)).toFixed(2))
        })));
        
    } catch(e) {
        console.error(e);
    }
    process.exit(0);
}
run();
