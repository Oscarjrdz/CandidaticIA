import dotenv from 'dotenv';
dotenv.config({ path: '.env.vercel.local' });
import { getCandidateByPhone } from './api/utils/storage.js';

async function run() {
    console.log("Fetching candidate 5218116038195...");
    const cand = await getCandidateByPhone("5218116038195");
    if (!cand) {
        console.log("Candidate NOT FOUND in Redis by phone.");
    } else {
        console.log("Candidate FOUND:", cand.id, cand.nombreReal, "Proyecto:", cand.projectId);
    }
    process.exit(0);
}

run();
