const axios = require('axios');

async function fetchProject() {
    try {
        const res = await axios.post('https://candidatic-ia.vercel.app/api/graphql', {
            query: `
        query {
          getProject(id: "proj_1740616149303_s8zve65v") {
            id
            name
            steps {
              id
              name
              calendarOptions
            }
          }
        }
      `
        });

        const project = res.data.data.getProject;
        const citaStep = project.steps.find(s => s.name.toLowerCase().includes('cita') && !s.name.toLowerCase().includes('citado'));
        console.log("CITA STEP CALENDAR OPTIONS:");
        console.log(JSON.stringify(citaStep.calendarOptions, null, 2));

    } catch (err) {
        console.error(err.message);
    }
}

fetchProject();
