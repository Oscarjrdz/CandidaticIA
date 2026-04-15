import Redis from 'ioredis';

const redis = new Redis("redis://default:8XMrmngeeqQ0p7MZRRBXycnhMG8WD5wt@redis-10341.c258.us-east-1-4.ec2.cloud.redislabs.com:10341");

const targetNames = [
    "ALFREDO XOCHIHUA",
    "PABLO LEONEL",
    "ELEAZAR GONSALES",
    "ARNULFO JAVIER",
    "ALBERTO ISMAEL"
];

async function main() {
    console.log("Connected to Redis\n");

    let cursor = '0';
    const found = [];

    do {
        const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'candidate:*', 'COUNT', 200);
        cursor = nextCursor;

        for (const key of keys) {
            try {
                const data = await redis.get(key);
                if (!data) continue;
                const candidate = JSON.parse(data);
                const name = (candidate.name || candidate.nombreReal || '').toUpperCase();

                for (const target of targetNames) {
                    if (name.includes(target)) {
                        found.push({
                            id: candidate.id,
                            name: candidate.name || candidate.nombreReal,
                            phone: candidate.whatsapp || candidate.phone,
                        });
                    }
                }
            } catch (e) { /* skip */ }
        }
    } while (cursor !== '0');

    console.log(`Found ${found.length} candidates:\n`);

    for (const c of found) {
        console.log(`\n${'='.repeat(70)}`);
        console.log(`${c.name} (${c.phone}) — ID: ${c.id}`);
        console.log(`${'='.repeat(70)}`);

        const messages = await redis.lrange(`messages:${c.id}`, 0, -1);

        if (!messages || messages.length === 0) {
            console.log("  No messages found\n");
            continue;
        }

        console.log(`  ${messages.length} messages:\n`);

        for (const msgStr of messages) {
            try {
                const msg = JSON.parse(msgStr);
                const isBot = msg.direction === 'outgoing' || msg.fromMe === true;
                const direction = isBot ? 'BRENDA' : 'CANDIDATO';
                const body = msg.body || msg.text || msg.message || '[media/empty]';
                console.log(`  [${direction}] ${body.substring(0, 600)}`);
                console.log('');
            } catch (e) {
                console.log(`  [parse error]`);
            }
        }
    }

    redis.disconnect();
}

main().catch(e => { console.error(e); redis.disconnect(); });
