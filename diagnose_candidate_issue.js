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

async function diagnoseCandidate() {
    const { getCandidateByPhone, auditProfile, getRedisClient } = await import('./api/utils/storage.js');
    const phone = '5218110363953';

    console.log(`🕵️‍♂️ Diagnosing Candidate: ${phone}...`);
    const c = await getCandidateByPhone(phone);

    if (!c) {
        console.error('❌ Candidate NOT found');
        process.exit(1);
    }

    console.log('\n--- CANDIDATE DATA ---');
    console.log(JSON.stringify(c, null, 2));

    const redis = getRedisClient();
    const customFieldsJson = await redis.get('custom_fields');
    const customFields = customFieldsJson ? JSON.parse(customFieldsJson) : [];

    const audit = auditProfile(c, customFields);
    console.log('\n--- AUDIT RESULTS ---');
    console.log(JSON.stringify(audit, null, 2));

    process.exit(0);
}

diagnoseCandidate();
