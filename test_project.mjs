import { getProjects } from './api/utils/storage.js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function run() {
  const projects = await getProjects();
  const aisin = projects.find(p => p.name && p.name.includes('AISIN'));
  if (aisin) {
    console.log("PROJECT:", aisin.name);
    for (const s of aisin.steps || []) {
      if (s.name.toLowerCase().includes('cita')) {
         console.log("STEP:", s.name);
         console.log("PROMPT:\n", s.aiConfig?.prompt || s.ai_prompt);
      }
    }
  } else {
     console.log("Aisin project not found");
  }
  process.exit(0);
}
run();
