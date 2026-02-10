
const mockCandidates = [
    { id: '1', nombreReal: 'Ana Garcia', genero: 'Mujer', municipio: 'Guadalupe' },
    { id: '2', nombreReal: 'Juan Perez', genero: 'Hombre', municipio: 'Monterrey' },
    { id: '3', nombreReal: 'Luis Torres', genero: 'Hombre', municipio: 'Apodaca' },
    { id: '4', nombreReal: 'Maria Lopez', genero: 'Mujer', municipio: 'Guadalupe' },
    { id: '5', nombreReal: 'Pedro Ruiz', genero: 'Hombre', municipio: 'Guadalupe' },
];

const normalize = (str) => String(str || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

const matchesCriteria = (candidateVal, criteria) => {
    if (criteria === undefined || criteria === null || criteria === '') return true;
    const cStr = normalize(candidateVal);
    const sStr = normalize(criteria.val || criteria);
    if (!cStr || ['no proporcionado', 'n/a', 'na', 'null', 'undefined'].includes(cStr)) return false;
    return cStr.includes(sStr);
};

function simulateSearchV85(query, aiResponse) {
    const queryLower = normalize(query);
    const genderTerms = ['hombre', 'hombres', 'caballero', 'caballeros', 'chico', 'chicos'];
    const femaleTerms = ['mujer', 'mujeres', 'dama', 'damas', 'chica', 'chicas'];
    const muniTerms = ['monterrey', 'apodaca', 'guadalupe', 'san nicolas', 'escobedo', 'santa catarina', 'garcia', 'juarez', 'cadereyta', 'san pedro'];

    if (!aiResponse.filters) aiResponse.filters = {};
    if (!aiResponse.keywords) aiResponse.keywords = [];

    // --- TITAN v8.5 SNIFFER (Inclusive Fix) ---
    const hasMale = genderTerms.some(t => queryLower.includes(t));
    const hasFemale = femaleTerms.some(t => queryLower.includes(t));

    if (!aiResponse.filters.genero) {
        if (hasMale && hasFemale) {
            // Multi-gender intent: Inclusive search detected.
        } else if (hasMale) {
            aiResponse.filters.genero = 'Hombre';
        } else if (hasFemale) {
            aiResponse.filters.genero = 'Mujer';
        }
    }

    if (!aiResponse.filters.municipio) {
        const foundMuni = muniTerms.find(t => queryLower.includes(t));
        if (foundMuni) aiResponse.filters.municipio = foundMuni;
    }

    const blacklist = [...genderTerms, ...femaleTerms, ...muniTerms];
    aiResponse.keywords = aiResponse.keywords.filter(kw => !blacklist.includes(normalize(kw)));

    const activeFilterKeys = Object.keys(aiResponse.filters);

    const results = mockCandidates.reduce((acc, candidate) => {
        let score = 0;
        let mismatchFound = false;

        activeFilterKeys.forEach(key => {
            const criteria = aiResponse.filters[key];
            const val = candidate[key];
            const cStr = normalize(val);

            if (!cStr || ['proporcionado', 'n/a', 'na', 'null', 'undefined'].some(noise => cStr.includes(noise)) || cStr.length < 2) {
                mismatchFound = true;
            } else {
                if (matchesCriteria(val, criteria)) score += 10000;
                else mismatchFound = true;
            }
        });

        if (mismatchFound) return acc;

        aiResponse.keywords.forEach(kw => {
            const metadata = normalize(Object.values(candidate).join(' '));
            if (metadata.includes(normalize(kw))) score += 50;
        });

        if (score > 0 || activeFilterKeys.length === 0) acc.push(candidate.nombreReal);
        return acc;
    }, []);

    return results;
}

console.log('--- TITAN v8.5 INCLUSIVE VERIFICATION ---');

console.log('Test 1: "Hombres de Guadalupe"');
const res1 = simulateSearchV85("Hombres de Guadalupe", { filters: {}, keywords: [] });
console.log('Included:', res1);
// Expected: ['Pedro Ruiz']

console.log('\nTest 2: "Mujeres de Guadalupe"');
const res2 = simulateSearchV85("Mujeres de Guadalupe", { filters: {}, keywords: [] });
console.log('Included:', res2);
// Expected: ['Ana Garcia', 'Maria Lopez']

console.log('\nTest 3: "Hombres y mujeres de Guadalupe"');
const res3 = simulateSearchV85("hombres y mujeres de Guadalupe", { filters: {}, keywords: [] });
console.log('Included:', res3);
// Expected: ['Ana Garcia', 'Maria Lopez', 'Pedro Ruiz'] - Should be inclusive!

if (res3.length === 3) {
    console.log("\n✅ SUCCESS: Inclusive gender logic verified.");
} else {
    console.log("\n❌ FAILURE: Inclusive logic failed to catch all candidates.");
}
