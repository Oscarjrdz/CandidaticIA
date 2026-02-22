import { getRedisClient, getCandidateIdByPhone } from './api/utils/storage.js';

async function run() {
    const redis = getRedisClient();
    if (!redis) {
        console.log('No redis client');
        process.exit(1);
    }

    try {
        const phone = '8116038195';
        const cId = await getCandidateIdByPhone(phone);
        console.log('Candidate ID:', cId);

        if (cId) {
            const logs = await redis.lrange(`debug:agent:logs:${cId}`, 0, 5);
            console.log('Logs count:', logs.length);
            logs.forEach((log, i) => {
                try {
                    const p = JSON.parse(log);
                    console.log(`Log ${i}: unanswered_question = ${p.aiResult?.unanswered_question}`);
                } catch (e) {
                    console.log(`Log ${i}: (non-json)`);
                }
            });
        }

        const vacs = await redis.get('candidatic_vacancies');
        console.log('Vacancies found:', !!vacs);
        if (vacs) {
            const parsed = JSON.parse(vacs);
            console.log('Vacancies count:', parsed.length);
            const target = 'd9451552-5be9-407e-a2bc-a57674352d6d';
            const v = parsed.find(x => x.id === target);
            console.log('Target vacancy found:', !!v, v ? v.name : '');
        }
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}

run();
