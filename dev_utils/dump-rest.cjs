const axios = require('axios');

async function fetchProject() {
    try {
        const res = await axios.get('https://candidatic-ia.vercel.app/api/candidates');

        const candidates = res.data.candidates;
        const oscar = candidates.find(c => c.whatsapp && c.whatsapp.includes('8120313481'));
        if (!oscar) {
            console.log("Candidate not found.");
            return;
        }
        const projectId = oscar.projectId || (oscar.projectMetadata && oscar.projectMetadata.projectId);
        console.log("Found Project ID:", projectId);

        if (!projectId) return;

        const projRes = await axios.get(`https://candidatic-ia.vercel.app/api/projects?id=${projectId}`);

        const project = projRes.data.project;
        const citaStep = project.steps.find(s => s.name.toLowerCase().includes('cita') && !s.name.toLowerCase().includes('citado'));
        console.log("=========================================");
        console.log("CITA STEP CALENDAR OPTIONS FROM DB:");
        console.log("=========================================");
        console.log(JSON.stringify(citaStep.calendarOptions, null, 2));

    } catch (err) {
        console.error(err.message);
    }
}

fetchProject();
