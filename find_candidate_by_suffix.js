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

async function findCandidate() {
    const { getCandidates } = await import('./api/utils/storage.js');
    console.log('🕵️‍♂️ Searching for candidate with suffix ...63953');

    const { candidates } = await getCandidates(10000, 0, '', false);
    const target = candidates.find(c => {
        const phone = String(c.whatsapp || '').replace(/\D/g, '');
        return phone.endsWith('63953');
    });

    if (target) {
        console.log('\n✅ Candidate Found!');
        console.log(JSON.stringify(target, null, 2));
    } else {
        console.log('\n❌ Candidate NOT found in first 10k results.');
    }

    process.exit(0);
}

findCandidate();
