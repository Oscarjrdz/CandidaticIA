const Redis = require('ioredis');

async function main() {
    const client = new Redis(process.env.REDIS_URL);

    // Try direct key first
    let raw = await client.get('candidate:8115846365');
    
    if (!raw) {
        // Search by whatsapp number
        const keys = await client.keys('candidate:*');
        console.log('Buscando entre', keys.length, 'candidates...');
        for (const key of keys) {
            const r = await client.get(key);
            if (r && r.includes('8115846365')) {
                raw = r;
                console.log('Encontrado en key:', key);
                break;
            }
        }
    } else {
        console.log('Encontrado en key: candidate:8115846365');
    }

    if (raw) {
        const c = JSON.parse(raw);
        console.log('\n--- TIMESTAMPS ---');
        console.log('lastUserMessageAt: ', c.lastUserMessageAt);
        console.log('lastHumanMessageAt:', c.lastHumanMessageAt);
        console.log('lastBotMessageAt:  ', c.lastBotMessageAt);
        console.log('\n--- UNREAD STATE ---');
        console.log('unread:', c.unread);
        console.log('unreadMsgCount:', c.unreadMsgCount);
        console.log('\n--- MESSAGES ---');
        console.log('messages count:', c.messages?.length ?? 'sin campo messages');
        if (c.messages?.length) {
            console.log('últimos 5:', JSON.stringify(c.messages.slice(-5), null, 2));
        }
    } else {
        console.log('No encontrado con número 8115846365');
    }

    client.disconnect();
}
main().catch(console.error);
