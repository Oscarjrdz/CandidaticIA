import Redis from 'ioredis';

const test = async () => {
    const client = new Redis(process.env.REDIS_URL, {
        tls: { rejectUnauthorized: false }
    });
    const rawItems = await client.zrange('candidates_list', 0, 50, 'REV');
    console.log("Searching for Oscar...");
    for (const item of rawItems) {
        const c = JSON.parse(item);
        if (c.nombreReal && c.nombreReal.toLowerCase().includes('oscar')) {
            console.log(JSON.stringify({ id: c.id, nombreReal: c.nombreReal, tieneEmpleo: c.tieneEmpleo, whatsapp: c.whatsapp, auditStatus: c.statusAudit }, null, 2));
        }
    }
    process.exit(0);
};
test();
