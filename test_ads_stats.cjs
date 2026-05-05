const fetch = require('node-fetch'); // wait, fetch is global in Node 18+

async function fetchStats() {
    // we can hit the local dev server if it's running
    try {
        const res = await fetch('http://localhost:5173/api/ads-stats');
        const data = await res.json();
        console.log(data);
    } catch(e) {
        console.log("Dev server not running at 5173, trying 3000");
        try {
            const res = await fetch('http://localhost:3000/api/ads-stats');
            const data = await res.json();
            console.log(data);
        } catch(e2) {
            console.log("Could not reach local server.");
        }
    }
}
fetchStats();
