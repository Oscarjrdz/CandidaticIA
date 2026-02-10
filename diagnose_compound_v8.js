
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

function runDiagnosticV8(query, aiResponse) {
    console.log('--- TEST: ' + query + ' ---');
    console.log('AI Translated Filters:', JSON.stringify(aiResponse.filters));
    console.log('AI Translated Keywords:', JSON.stringify(aiResponse.keywords));

    const queryLower = normalize(query);
    const genderTerms = ['hombre', 'hombres', 'caballero', 'caballeros', 'chico', 'chicos'];
    const femaleTerms = ['mujer', 'mujeres', 'dama', 'damas', 'chica', 'chicas'];

    if (!aiResponse.filters) aiResponse.filters = {};
    if (!aiResponse.keywords) aiResponse.keywords = [];

    // Titan v8.0 Sniffer
    if (!aiResponse.filters.genero) {
        if (genderTerms.some(t => queryLower.includes(t))) aiResponse.filters.genero = 'Hombre';
        else if (femaleTerms.some(t => queryLower.includes(t))) aiResponse.filters.genero = 'Mujer';
    }

    const activeFilterKeys = Object.keys(aiResponse.filters);

    const results = mockCandidates.reduce((acc, candidate) => {
        let score = 0;
        let mismatchFound = false;

        activeFilterKeys.forEach(key => {
            const criteria = aiResponse.filters[key];
            const val = candidate[key];
            const cStr = normalize(val);
            const isMissing = !cStr || ['proporcionado', 'n/a', 'na', 'null', 'undefined'].some(noise => cStr.includes(noise)) || cStr.length < 2;

            if (isMissing) {
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

        if (score > 0) acc.push({ name: candidate.nombreReal, score });
        return acc;
    }, []);

    console.log('Final Result:', results.map(r => r.name));
}

console.log('Scenario A: AI correctly identifies Monterrey');
runDiagnosticV8("hombres de monterrey", {
    filters: { genero: "Hombre", municipio: "Monterrey" },
    keywords: []
});

console.log('\nScenario B: AI fails Monterrey (puts in keywords)');
runDiagnosticV8("hombres de monterrey", {
    filters: { genero: "Hombre" },
    keywords: ["monterrey"]
});

console.log('\nScenario C: AI fails everything (puts in keywords)');
runDiagnosticV8("hombres de monterrey", {
    filters: {},
    keywords: ["hombres", "monterrey"]
});
