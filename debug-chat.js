import { getMessages, getCandidates } from './api/utils/storage.js';

async function debugChat() {
    console.log('🔍 [Debug] Fetching candidates...');
    const { candidates } = await getCandidates(5);

    if (candidates.length === 0) {
        console.log('❌ No candidates found');
        process.exit(0);
    }

    for (const cand of candidates) {
        console.log(`\n-----------------------------------`);
        console.log(`👤 Candidate: ${cand.nombre} (${cand.whatsapp}) ID: ${cand.id}`);
        const messages = await getMessages(cand.id);
        console.log(`📩 Messages found: ${messages.length}`);

        // Show last 3 messages
        messages.slice(-3).forEach((msg, i) => {
            console.log(`   [${i}] TYPE: ${msg.type} FROM: ${msg.from} STATUS: ${msg.status}`);
            console.log(`       CONTENT: ${msg.content?.substring(0, 30)}...`);
            if (msg.mediaUrl) {
                const isBase64 = msg.mediaUrl.startsWith('data:') || msg.mediaUrl.length > 500;
                console.log(`       MEDIA: ${isBase64 ? 'BASE64 (Large)' : msg.mediaUrl}`);
            }
            if (msg.ultraMsgId) console.log(`       ULTRA_ID: ${msg.ultraMsgId}`);
            if (msg.error) console.log(`       ERROR: ${msg.error}`);
        });
    }
    process.exit(0);
}

debugChat();
