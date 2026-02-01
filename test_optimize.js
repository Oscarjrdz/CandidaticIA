
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

async function test() {
    try {
        console.log("Testing /api/ai/optimize-prompt...");
        const res = await fetch('http://localhost:5001/api/ai/optimize-prompt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: 'saludale' })
        });
        const data = await res.json();
        console.log("Response:", JSON.stringify(data, null, 2));
    } catch (e) {
        console.error("Error:", e.message);
    }
}

test();
