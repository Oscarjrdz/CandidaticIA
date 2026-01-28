import { getMessages, getCandidates } from './api/utils/storage.js';

async function debugChat() {
    const { candidates } = await getCandidates(5);

    if (candidates.length === 0) {
        process.exit(0);
    }

    for (const cand of candidates) {
        const messages = await getMessages(cand.id);

        // Show last 3 messages
        messages.slice(-3).forEach((msg, i) => {
            if (msg.mediaUrl) {
                const isBase64 = msg.mediaUrl.startsWith('data:') || msg.mediaUrl.length > 500;
            }
        });
    }
    process.exit(0);
}

debugChat();
