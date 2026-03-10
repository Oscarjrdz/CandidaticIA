const https = require('https');
https.get('https://candidatic-ia.vercel.app/api/projects', res => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        try {
            const json = JSON.parse(data);
            for (let p of json.projects) {
                const cita = (p.steps || []).find(s => s.name.toLowerCase().includes('cita') && !s.name.toLowerCase().includes('citado'));
                if (cita && cita.calendarOptions && cita.calendarOptions.length > 0) {
                    console.log("Found CITA CALENDAR in Project:", p.name, "(ID:", p.id, ")");
                    console.log(JSON.stringify(cita.calendarOptions, null, 2));
                    return;
                }
            }
            console.log("No projects have a Cita step with calendarOptions.");
        } catch (e) { console.error('Error parsing projects', e.message); }
    });
});
