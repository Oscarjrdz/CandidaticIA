import { getCandidates } from './api/utils/storage.js';

async function auditMissingNames() {
    console.log('🕵️‍♂️ Auditing Missing Names...');
    const { candidates } = await getCandidates(10000, 0, '', false);

    const missingRealName = candidates.filter(c => {
        const val = String(c.nombreReal || '').toLowerCase().trim();
        return !val || val === 'no proporcionado' || val === 'n/a' || val === 'na' || val.length < 2;
    });

    console.log('\n--- AUDIT RESULTS ---');
    console.log(`👥 Total Candidates: ${candidates.length}`);
    console.log(`❌ Missing "nombreReal": ${missingRealName.length}`);
    console.log('---------------------\n');

    process.exit(0);
}

auditMissingNames();
