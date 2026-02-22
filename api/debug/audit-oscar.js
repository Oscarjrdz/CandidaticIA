
import Redis from 'ioredis';
const redis = new Redis(process.env.REDIS_URL);

async function checkOscar() {
    const candidateId = '5218116161616'; // Assuming this is Oscar's ID based on previous logs or common pattern
    // Alternatively, let's find the candidate by phone
    const phone = '5218116161616';
    const id = await redis.hget('candidatic:phone_index', phone) || id;

    console.log(`Checking candidate ID: ${id}`);
    const data = await redis.get(`candidatic:candidate:${id}`);
    if (!data) {
        console.log("Candidate not found.");
        process.exit(0);
    }

    const cand = JSON.parse(data);
    console.log("Candidate Data:", JSON.stringify(cand, null, 2));

    // Check audit
    const required = ['nombreReal', 'genero', 'municipio', 'edad', 'categoria', 'escolaridad'];
    const missing = required.filter(f => !cand[f] || cand[f] === 'null' || cand[f] === 'N/A');
    console.log("Missing fields for Paso 1:", missing);

    // Check project assignment
    console.log("Project ID:", cand.projectId);
    console.log("Step ID:", cand.stepId);

    process.exit(0);
}

checkOscar();
