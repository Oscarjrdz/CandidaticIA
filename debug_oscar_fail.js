import { getCandidates, getMessages } from './api/utils/storage.js';

async function fetchLatestContext() {
    const { candidates } = await getCandidates(20, 0);
    // Find the candidate named 'oscar rodriguez' or similar recently active
    const oscar = candidates.find(c => c.nombreReal?.toLowerCase().includes('oscar') || c.nombre?.toLowerCase().includes('oscar'));

    if (!oscar) {
        console.log("Candidate not found.");
        return;
    }
    console.log(`Analyzing candidate: ${oscar.nombreReal || oscar.nombre} (${oscar.whatsapp})`);
    console.log(`Current Step: ${oscar.stepId}`);
    console.log(`Current Project Index: ${oscar.currentVacancyIndex}`);

    let messages = [];
    try {
        messages = await getMessages(oscar.id);
    } catch (e) {
        console.error("Redis Error", e.message);
        // Fallback or just ignore for now to read what we can get from candidate object.
    }
    console.log("\n--- LAST 10 MESSAGES ---");
    const tail = messages.slice(-10);
    tail.forEach(m => {
        console.log(`[${m.from}] ${m.timestamp}`);
        console.log(`Content: ${m.content}`);
        if (m.ai_result) {
            console.log(`AI Thought: ${m.ai_result.thought_process}`);
            console.log(`AI Res: ${m.ai_result.response_text}`);
        }
        console.log('---');
    });
}

fetchLatestContext().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
