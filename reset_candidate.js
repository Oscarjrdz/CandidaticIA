
import dotenv from 'dotenv';
import Redis from 'ioredis';

dotenv.config();

const redis = new Redis(process.env.REDIS_URL);
const PHONE = '5218116038195';

async function reset() {
    try {
        console.log(`Searching for candidate with phone: ${PHONE}...`);
        const candidateId = await redis.hget('candidatic:phone_index', PHONE);

        if (candidateId) {
            console.log(`Found Candidate ID: ${candidateId}`);

            // Delete Candidate Record
            await redis.del(`candidatic:candidate:${candidateId}`);
            console.log(`✅ Deleted Candidate Record: candidatic:candidate:${candidateId}`);

            // Delete from Phone Index
            await redis.hdel('candidatic:phone_index', PHONE);
            console.log(`✅ Deleted Phone Index: ${PHONE}`);

            // Optional: Delete message history if you want a TRULY clean slate
            // await redis.del(`candidatic:messages:${candidateId}`);
            // console.log(`✅ Deleted Message History`);

        } else {
            console.log(`❌ No candidate found for phone ${PHONE}`);
        }

    } catch (error) {
        console.error('Error during reset:', error);
    } finally {
        redis.disconnect();
    }
}

reset();
