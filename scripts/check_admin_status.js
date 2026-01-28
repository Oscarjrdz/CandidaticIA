
import { getRedisClient, getUsers, KEYS } from '../api/utils/storage.js';

async function checkAdmin() {
    console.log('--- Checking Admin Status ---');
    const client = getRedisClient();

    // 1. Check Users List
    const users = await getUsers();
    const adminPhone = '8116038195';

    const adminUser = users.find(u => u.whatsapp.includes(adminPhone));

    if (adminUser) {
        console.log('✅ Admin FOUND in Users list:');
        console.log(JSON.stringify(adminUser, null, 2));

        if (adminUser.status === 'Pending') {
            console.error('🚨 SMOKING GUN FOUND: Admin is PENDING. Webhook ignores pending users!');
        } else {
            console.log('ℹ️ Admin status is:', adminUser.status);
        }
    } else {
        console.log('⚠️ Admin NOT found in Users list.');
    }

    // 2. Check Candidate Index
    console.log('\n--- Checking Candidate Index ---');
    if (client) {
        const candidateId = await client.hget(KEYS.PHONE_INDEX, adminPhone);
        console.log(`Candidate ID for ${adminPhone}:`, candidateId);

        if (candidateId) {
            const data = await client.get(`${KEYS.CANDIDATE_PREFIX}${candidateId}`);
            console.log('Candidate Data:', data);
        }
    }

    process.exit(0);
}

checkAdmin();
