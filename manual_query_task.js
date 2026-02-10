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

const normalize = (str) => String(str || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

async function testTitanV5() {
    const { getCandidates } = await import('./api/utils/storage.js');

    console.log('🔍 Testing Titan Search v5.0 Logic...');
    const { candidates } = await getCandidates(10000, 0, '', false);

    const queryTerm = "Oscar";
    const statusRequested = "complete";

    const filtered = candidates.filter(c => {
        const nameMatch = normalize(c.nombreReal).includes(normalize(queryTerm));
        const statusMatch = c.statusAudit === statusRequested;
        return nameMatch && statusMatch;
    });

    console.log('\n--- TEST RESULTS ---');
    console.log(`👤 Name contains: "${queryTerm}"`);
    console.log(`✅ Status is: "${statusRequested}"`);
    console.log(`👥 Total Matches: ${filtered.length}`);
    console.log('---------------------\n');

    process.exit(0);
}

testTitanV5();
