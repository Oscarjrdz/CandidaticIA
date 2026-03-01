import { connectToDatabase } from './api/utils/storage.js';

async function fetchMongo() {
    const { db } = await connectToDatabase();
    const candidate = await db.collection('candidates').findOne({
        $or: [
            { nombreReal: { $regex: 'oscar', $options: 'i' } },
            { nombre: { $regex: 'oscar', $options: 'i' } }
        ]
    }, { sort: { _id: -1 } });

    if (!candidate) {
        console.log("No Oscar found in DB.");
        return;
    }

    console.log(`Analyzing candidate via Mongo: ${candidate.nombreReal || candidate.nombre} (${candidate.whatsapp})`);
    console.log(`Current Step: ${candidate.stepId}`);

    const messages = await db.collection('messages')
        .find({ candidateId: candidate.id || candidate.whatsapp })
        .sort({ timestamp: -1 })
        .limit(10)
        .toArray();

    console.log("\n--- LAST 10 MESSAGES ---");
    messages.reverse().forEach(m => {
        console.log(`[${m.from}] ${m.timestamp}`);
        console.log(`Content: ${m.content}`);
        if (m.ai_result) {
            console.log(`AI Thought: ${m.ai_result.thought_process}`);
            console.log(`AI Res: ${m.ai_result.response_text}`);
        }
        console.log('---');
    });
}
fetchMongo().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
