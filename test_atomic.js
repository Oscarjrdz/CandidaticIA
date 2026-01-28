
import { saveWebhookTransaction, getCandidateById, getMessages, getEventStats, getEvents } from './api/utils/storage.js';

async function testTransaction() {
    console.log('--- Testing Atomic Webhook Transaction ---');

    // 1. Create a dummy candidate ID
    const candidateId = 'test_cand_123';
    const initialCandidate = {
        id: candidateId,
        nombre: 'Test Zuck',
        whatsapp: '1234567890',
        primerContacto: new Date().toISOString()
    };

    // 2. Define updates and message
    const message = { from: 'user', content: 'Hello Atomic World', timestamp: new Date().toISOString() };
    const candidateUpdates = {
        ...initialCandidate,
        ultimoMensaje: new Date().toISOString(),
        unread: true
    };
    const eventData = { event: 'message_received', data: { id: 'msg_999' } };

    console.log('🚀 Executing Transaction...');
    try {
        await saveWebhookTransaction({
            candidateId,
            message,
            candidateUpdates,
            eventData,
            statsType: 'incoming'
        });

        console.log('✅ Transaction executed. Verifying state...');

        // Verify Candidate
        const cand = await getCandidateById(candidateId);
        console.log('Candidate Unread:', cand?.unread);

        // Verify Message
        const msgs = await getMessages(candidateId);
        console.log('Last Message Content:', msgs[msgs.length - 1]?.content);

        // Verify Stats
        const stats = await getEventStats();
        console.log('Incoming Stats:', stats.incoming);

        // Verify Events
        const events = await getEvents(5);
        const lastEvent = events[0];
        console.log('Last Event ID:', lastEvent?.data?.id);

        if (cand?.unread && msgs[msgs.length - 1]?.content === 'Hello Atomic World' && lastEvent?.data?.id === 'msg_999') {
            console.log('\n🏆 ALL CHECKS PASSED. ATOMIC TRANSACTION IS STABLE.');
            process.exit(0);
        } else {
            console.error('\n❌ SOME CHECKS FAILED.');
            process.exit(1);
        }
    } catch (e) {
        console.error('❌ FATAL TEST ERROR:', e);
        process.exit(1);
    }
}

testTransaction();
