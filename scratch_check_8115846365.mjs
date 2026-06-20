import Redis from 'ioredis';
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

async function run() {
    try {
        const candidateId = 'cand_1776843565162_d807jf8br';
        
        // Check for separate messages key
        const msgKey = `messages:${candidateId}`;
        const msgRaw = await redis.get(msgKey);
        console.log('messages key:', msgKey);
        console.log('messages raw:', msgRaw ? `${msgRaw.length} chars` : 'NULL');
        
        if (msgRaw) {
            const msgs = JSON.parse(msgRaw);
            console.log('messages count:', Array.isArray(msgs) ? msgs.length : typeof msgs);
            if (Array.isArray(msgs) && msgs.length) {
                console.log('últimos 5:', JSON.stringify(msgs.slice(-5), null, 2));
            }
        }
        
        // Check other possible keys
        const possibleKeys = [
            `chat:${candidateId}`,
            `chat:8115846365`,
            `messages:8115846365`,
        ];
        for (const k of possibleKeys) {
            const v = await redis.get(k);
            console.log(`${k}:`, v ? `${v.length} chars` : 'NULL');
        }

    } catch(e) {
        console.error(e);
    }
    process.exit(0);
}
run();
