/**
 * Quick diagnostic: find test candidate's escolaridad and recent extraction logs
 * Run: node --env-file=.env.local /tmp/check_escolaridad.js
 */
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

async function main() {
    // Check extraction log for escolaridad
    console.log('\n=== LAST 5 EXTRACTION LOGS ===');
    const logs = await redis.lrange('debug:extraction_log', 0, 4);
    for (const log of logs) {
        try {
            const parsed = JSON.parse(log);
            const ts = parsed.timestamp?.slice(11, 19);
            const escol = parsed.extracted?.escolaridad?.value || parsed.extracted?.escolaridad || 'N/A';
            const refined = parsed.refined?.escolaridad || 'NOT SAVED';
            const cid = parsed.candidateId?.slice(-8);
            console.log(`[${ts}] cand:${cid} | extracted: ${JSON.stringify(escol)} | saved: ${refined}`);
        } catch (e) { console.log('parse error'); }
    }

    // Find candidates missing escolaridad
    console.log('\n=== CANDIDATES MISSING ESCOLARIDAD ===');
    const ids = await redis.zrevrange('candidates:list', 0, 19);
    let found = 0;
    for (const id of ids) {
        const raw = await redis.get(`candidate:${id}`);
        if (!raw) continue;
        const c = JSON.parse(raw);
        if (!c.escolaridad || c.escolaridad === 'null') {
            console.log(`- ${c.nombreReal || 'Sin nombre'} | ${c.whatsapp} | escolaridad: ${c.escolaridad || 'NULL'}`);
            found++;
        }
    }
    if (found === 0) console.log('No candidates without escolaridad found in last 20.');

    // Show test/admin candidate data
    console.log('\n=== ADMIN NUMBER CANDIDATE ===');
    const adminPhone = process.env.ADMIN_NUMBER || '5218116038195';
    const adminId = await redis.hget('candidatic:phone_index', adminPhone);
    if (adminId) {
        const raw = await redis.get(`candidate:${adminId}`);
        if (raw) {
            const c = JSON.parse(raw);
            console.log(`Name: ${c.nombreReal}`);
            console.log(`Escolaridad: ${c.escolaridad}`);
            console.log(`Categoria: ${c.categoria}`);
            console.log(`Municipio: ${c.municipio}`);
            console.log(`StatusAudit: ${c.statusAudit}`);
            console.log(`ProjectId: ${c.projectId}`);
        }
    } else {
        console.log('Admin candidate not found.');
    }

    await redis.quit();
}

main().catch(console.error);
