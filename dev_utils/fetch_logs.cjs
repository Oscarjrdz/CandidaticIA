const axios = require('axios');
const VERCEL_TOKEN = process.env.VERCEL_TOKEN;

async function fetchLogs() {
    if (!VERCEL_TOKEN) {
        console.log('No vercel token in process.env');
        return;
    }

    try {
        // We need to find the deployment ID first
        const depRes = await axios.get('https://api.vercel.com/v6/deployments?app=candidatic-ia&limit=1', {
            headers: { Authorization: `Bearer ${VERCEL_TOKEN}` }
        });

        if (!depRes.data || !depRes.data.deployments || depRes.data.deployments.length === 0) {
            console.log('No deployments found.');
            return;
        }

        const deploymentId = depRes.data.deployments[0].uid;
        console.log(`Using deployment ID: ${deploymentId}`);

        // Now fetch logs
        const logRes = await axios.get(`https://api.vercel.com/v2/now/deployments/${deploymentId}/events`, {
            headers: { Authorization: `Bearer ${VERCEL_TOKEN}` }
        });

        const logs = logRes.data.filter(l => l.text).map(l => l.text);
        const chainedLogs = logs.filter(l => l.includes('[CHAINED AI DEBUG]'));

        console.log("\n--- CHAINED AI LOGS ---\n");
        chainedLogs.forEach(l => console.log(l));

    } catch (err) {
        if (err.response) {
            console.error(err.response.data);
        } else {
            console.error(err.message);
        }
    }
}

fetchLogs();
