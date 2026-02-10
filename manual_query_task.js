import fs from 'fs';
import path from 'path';

// Manual .env.local loader
const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
        const [key, ...valueParts] = line.split('=');
        if (key && valueParts.length > 0) {
            process.env[key.trim()] = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
        }
    });
}

const normalize = (str) => String(str || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

const calculateAge = (dob) => {
    if (!dob) return null;
    let birthDate = new Date(dob);
    if (isNaN(birthDate.getTime())) return null;
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
    return age;
};

async function runQuery() {
    const { getCandidates } = await import('./api/utils/storage.js');

    // Fetch a large pool
    console.log('🔍 Fetching candidates from database...');
    const { candidates } = await getCandidates(10000, 0, '', false);

    console.log(`📊 Processing ${candidates.length} candidates...`);

    const filtered = candidates.filter(c => {
        // 1. Municipality: Apodaca
        const mun = normalize(c.municipio);
        if (!mun.includes('apodaca')) return false;

        // 2. Age: 18 to 40
        const age = calculateAge(c.fechaNacimiento);
        if (age === null || age < 18 || age > 40) return false;

        // 3. Gender: Men and Women (Essentially anyone who has gender set or we assume both)
        // Since the prompt asks for "Hombres y Mujeres", we just ensure they aren't "Unknown" if we want strictness, 
        // but usually this means "everyone" within that demographic.

        return true;
    });

    console.log('\n--- RESULTADOS ---');
    console.log(`📍 Municipio: Apodaca`);
    console.log(`🎂 Edad: 18 a 40 años`);
    console.log(`👥 Total Encontrados: ${filtered.length}`);
    console.log('------------------\n');

    process.exit(0);
}

runQuery();
