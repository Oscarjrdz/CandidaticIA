const https = require('https');
https.get('https://candidatic.com/api/projects', res => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
        const json = JSON.parse(data);
        const p = json.projects.find(x => x.id === 'proj_1740616149303_s8zve65v');
        if(!p) return console.log('Proj 1 not found');
        const cita = p.steps.find(s => s.name.toLowerCase().includes('cita') && !s.name.toLowerCase().includes('citado'));
        console.log(JSON.stringify(cita.calendarOptions, null, 2));
    } catch(e) { console.error('Error parsing projects', e.message); }
  });
});
