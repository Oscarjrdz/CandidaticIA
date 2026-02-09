import ioredis from 'ioredis';
import dotenv from 'dotenv';
dotenv.config();

const client = new ioredis(process.env.REDIS_URL || 'redis://localhost:6379');

async function debugCandidate(phone) {
    const candidateId = await client.hget('index:phone', phone);
    if (!candidateId) {
        console.log(`❌ Candidate not found for phone: ${phone}`);
        process.exit(1);
    }
    console.log(`✅ Found Candidate ID: ${candidateId}`);

    const messages = await client.lrange(`messages:${candidateId}`, -10, -1);
    console.log('\n--- LAST 10 MESSAGES ---');
    messages.forEach((m, i) => {
        const msg = JSON.parse(m);
        console.log(`[${i}] FROM: ${msg.from} | CONTENT: ${msg.content.substring(0, 50)}...`);
        console.log(`    META: ${JSON.stringify(msg.meta || {})}`);
        console.log(`    RAW: ${m}`);
        console.log('---');
    });

    process.exit(0);
}

const phone = '5218116038195';
debugCandidate(phone);
