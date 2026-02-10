
const mockCandidates = [
    { id: '1', nombreReal: 'Ana Garcia', genero: 'Mujer', edad: 18, municipio: 'Apodaca', statusAudit: 'complete', chat_summary: 'Busca hombres para su equipo' },
    { id: '2', nombreReal: 'Juan Perez', genero: 'Hombre', edad: 25, municipio: 'Monterrey', statusAudit: 'complete', chat_summary: 'Experto en logistica' },
    { id: '3', nombreReal: 'Sin Dato', genero: 'No proporcionado', edad: null, municipio: 'No proporcionado', statusAudit: 'pending', chat_summary: '' },
];

const normalize = (str) => String(str || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

const matchesCriteria = (candidateVal, criteria) => {
    if (criteria === undefined || criteria === null || criteria === '') return true;
    const cStr = normalize(candidateVal);
    const sStr = normalize(criteria.val || criteria);
    if (!cStr || ['no proporcionado', 'n/a', 'na', 'null', 'undefined'].includes(cStr)) return false;
    return cStr.includes(sStr);
};

function simulateSearchV8(query, aiResponse) {
    const queryLower = normalize(query);
    const genderTerms = ['hombre', 'hombres', 'caballero', 'caballeros', 'chico', 'chicos'];
    const femaleTerms = ['mujer', 'mujeres', 'dama', 'damas', 'chica', 'chicas'];

    if (!aiResponse.filters) aiResponse.filters = {};
    if (!aiResponse.keywords) aiResponse.keywords = [];

    // --- TITAN v8.0 SNIFFER ---
    if (!aiResponse.filters.genero) {
        if (genderTerms.some(t => queryLower.includes(t))) aiResponse.filters.genero = 'Hombre';
        else if (femaleTerms.some(t => queryLower.includes(t))) aiResponse.filters.genero = 'Mujer';
    }

    const blacklist = [...genderTerms, ...femaleTerms];
    aiResponse.keywords = aiResponse.keywords.filter(kw => !blacklist.includes(normalize(kw)));

    const activeFilterKeys = Object.keys(aiResponse.filters);

    const results = mockCandidates.reduce((acc, candidate) => {
        let score = 0;
        let mismatchFound = false;

        activeFilterKeys.forEach(key => {
            const criteria = aiResponse.filters[key];
            const val = candidate[key];
            const cStr = normalize(val);
            const isTargetMissing = criteria === "$missing";

            const isNumeric = typeof val === 'number' || (val && !isNaN(val));
            const isMissing = !isNumeric && (!cStr || ['proporcionado', 'n/a', 'na', 'null', 'undefined'].some(noise => cStr.includes(noise)) || cStr.length < 2);

            if (isMissing) {
                if (isTargetMissing) score += 5000;
                else mismatchFound = true;
            } else {
                if (isTargetMissing) mismatchFound = true;
                else {
                    if (matchesCriteria(val, criteria)) score += 10000;
                    else mismatchFound = true;
                }
            }
        });

        if (mismatchFound) return acc;

        aiResponse.keywords.forEach(kw => {
            const metadata = normalize(Object.values(candidate).join(' '));
            if (metadata.includes(normalize(kw))) score += 50;
        });

        if (score > 0) acc.push(candidate.nombreReal);
        return acc;
    }, []);

    return results;
}

console.log('--- TITAN v8.0 VERIFICATION ---');
console.log('Test 1: "Hombres" (AI failed filter)');
const res1 = simulateSearchV8("Hombres", { filters: {}, keywords: ["hombres"] });
console.log('Included:', res1);
// Expected: ['Juan Perez'] ONLY. Even if Ana mentions "hombres" in summary, she is filtered by the sniffer.

console.log('\nTest 2: "Mujeres" (AI failed filter)');
const res2 = simulateSearchV8("Mujeres", { filters: {}, keywords: ["mujeres"] });
console.log('Included:', res2);
// Expected: ['Ana Garcia']
