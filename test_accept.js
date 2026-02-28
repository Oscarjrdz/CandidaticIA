import dotenv from 'dotenv';
dotenv.config({ path: '.env.vercel.local' });
import { getProjectById, getCandidateById } from './api/utils/storage.js';

async function run() {
    const pId = "proj_1771225156891_10ez5k"; // Aisin
    const project = await getProjectById(pId);
    console.log("Sticker configs in Aisin project:", project.steps.map(s => ({name: s.name, req: s.requirements})));
    process.exit(0);
}
run();
