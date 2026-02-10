import fs from 'fs';
import path from 'path';

// Manual .env.local loader
const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
        const [key, ...valueParts] = line.split('=');
        if (key && valueParts.length > 0) {
            process.env[key.trim()] = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
        }
    });
}

async function auditTitan() {
    const { getCandidates, getCandidatesStats } = await import('./api/utils/storage.js');

    console.log('🕵️‍♂️ Titan Deep Audit...');
    const stats = await getCandidatesStats();
    console.log('📊 Dashboard Stats:', stats);

    const { candidates } = await getCandidates(10000, 0, '', false);

    const missingName = candidates.filter(c => {
        const val = String(c.nombreReal || '').toLowerCase().trim();
        return !val || val === 'no proporcionado' || val === 'n/a' || val === 'na' || val.length < 2;
    });

    console.log(`❌ Truly missing "nombreReal": ${missingName.length}`);

    // Simulate query: "quienes le falte el nombre"
    // AI might translate to statusAudit: "pending"
    const pendingCount = candidates.filter(c => c.statusAudit === 'pending').length;
    console.log(`🟡 Candidates marked as "pending": ${pendingCount}`);

    process.exit(0);
}

auditTitan();
