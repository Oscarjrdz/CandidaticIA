
import { getRedisClient, getCandidates } from './api/utils/storage.js';

async function checkJids() {
    try {
        const { candidates } = await getCandidates(10, 0);
        console.log('✅ JID Sample:');
        candidates.forEach(c => {
            console.log(`- ${c.nombre}: (Phone: ${c.phone}) (WhatsApp: ${c.whatsapp})`);
        });
    } catch (e) {
        console.error('❌ Error:', e.message);
    } finally {
        process.exit(0);
    }
}

checkJids();
