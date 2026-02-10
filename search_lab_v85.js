
const mockCandidates = [
    { id: '1', nombreReal: 'Ana Garcia', genero: 'Mujer', municipio: 'Monterrey' },
    { id: '2', nombreReal: 'Juan Perez', genero: 'Hombre', municipio: 'Monterrey' },
    { id: '3', nombreReal: 'Luis Torres', genero: 'Hombre', municipio: 'Apodaca' },
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

    // --- TITAN v8.5 SNIFFER ---
    if (!aiResponse.filters.genero) {
        if (genderTerms.some(t => queryLower.includes(t))) aiResponse.filters.genero = 'Hombre';
        else if (femaleTerms.some(t => queryLower.includes(t))) aiResponse.filters.genero = 'Mujer';
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

        if (score > 0) acc.push(candidate.nombreReal);
        return acc;
    }, []);

    return results;
}

console.log('--- TITAN v8.5 VERIFICATION ---');
console.log('Test 1: "Hombres de Monterrey" (AI identifies filters correctly)');
const res1 = simulateSearchV85("Hombres de Monterrey", {
    filters: { genero: "Hombre", municipio: "Monterrey" },
    keywords: []
});
console.log('Included:', res1);
// Expected: ['Juan Perez']

console.log('\nTest 2: "Hombres de Monterrey" (AI fails location mapping)');
const res2 = simulateSearchV85("Hombres de Monterrey", {
    filters: { genero: "Hombre" },
    keywords: ["monterrey"]
});
console.log('Included:', res2);
// Expected: ['Juan Perez'] - The sniffer must force "municipio: monterrey" and exclude "Luis Torres" (Apodaca).

console.log('\nTest 3: "Hombres de Monterrey" (AI fails everything)');
const res3 = simulateSearchV85("Hombres de Monterrey", {
    filters: {},
    keywords: ["hombres", "monterrey"]
});
console.log('Included:', res3);
// Expected: ['Juan Perez'] - Sniffer forces both Gender and Municipality.
