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

async function searchCandidate() {
    const { getCandidates } = await import('./api/utils/storage.js');
    console.log('🕵️‍♂️ Scanning ALL candidates for phone: 8110363953');

    let found = false;
    let page = 0;
    const pageSize = 500;

    while (page < 20) { // Scan up to 10k
        const { candidates } = await getCandidates(pageSize, page * pageSize, '', false);
        if (!candidates || candidates.length === 0) break;

        const target = candidates.find(c => {
            const digits = String(c.whatsapp || '').replace(/\D/g, '');
            return digits.includes('8110363953') || digits.includes('18110363953');
        });

        if (target) {
            console.log('\n✅ FOUND IT!');
            console.log(JSON.stringify(target, null, 2));
            found = true;
            break;
        }
        page++;
    }

    if (!found) console.log('\n❌ Not found in 10k scan.');
    process.exit(0);
}

searchCandidate();
