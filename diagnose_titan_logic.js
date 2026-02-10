
const mockCandidates = [
    { id: '1', nombreReal: 'Ana Garcia', genero: 'Mujer', edad: 18, municipio: 'Apodaca', statusAudit: 'complete' },
    { id: '2', nombreReal: 'Juan Perez', genero: 'Hombre', edad: 25, municipio: 'Monterrey', statusAudit: 'complete' },
    { id: '3', nombreReal: 'Sin Dato', genero: 'No proporcionado', edad: null, municipio: 'No proporcionado', statusAudit: 'pending' },
];

const normalize = (str) => String(str || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

const matchesCriteria = (candidateVal, criteria) => {
    if (criteria === undefined || criteria === null || criteria === '') return true;
    const numCandidate = Number(candidateVal);
    if (typeof criteria === 'number' || (!isNaN(criteria) && typeof criteria !== 'object')) {
        const numTarget = Number(criteria);
        if (isNaN(numCandidate)) return false;
        return numCandidate === numTarget;
    }
    const cStr = normalize(candidateVal);
    const sStr = normalize(criteria.val || criteria);
    if (!cStr || ['no proporcionado', 'n/a', 'na', 'null', 'undefined'].includes(cStr)) return false;
    return cStr.includes(sStr);
};

function runDiagnostic(aiResponse) {
    console.log('--- DIAGNOSTIC START ---');
    console.log('AI Response:', JSON.stringify(aiResponse, null, 2));

    const activeFilterKeys = Object.keys(aiResponse.filters || {});

    const results = mockCandidates.map(candidate => {
        let score = 0;
        let matchesCount = 0;
        let mismatchFound = false;

        activeFilterKeys.forEach(key => {
            const criteria = aiResponse.filters[key];
            const val = candidate[key];
            const cStr = normalize(val);
            const isTargetMissing = criteria === "$missing";

            const isNumeric = typeof val === 'number' || (val && !isNaN(val) && String(val).trim() !== '');
            const noiseList = ['proporcionado', 'n/a', 'na', 'null', 'undefined', 'general', 'sin nombre', 'sin apellido'];
            const isMissing = !isNumeric && (!cStr || noiseList.some(noise => cStr === noise || cStr.includes("no " + noise)) || cStr.length < 2);

            if (isMissing) {
                if (isTargetMissing) {
                    matchesCount++;
                    score += 2000;
                } else {
                    score += 1;
                }
            } else {
                if (isTargetMissing) {
                    mismatchFound = true;
                } else {
                    const hasMatch = matchesCriteria(val, criteria);
                    if (hasMatch) {
                        matchesCount++;
                        score += 5000;
                    } else {
                        mismatchFound = true;
                    }
                }
            }
        });

        if (mismatchFound) return { id: candidate.id, status: 'EXCLUDED' };

        if (aiResponse.keywords && aiResponse.keywords.length > 0) {
            const metadata = normalize(Object.values(candidate).join(' '));
            aiResponse.keywords.forEach(kw => {
                const normalizedKw = normalize(kw);
                if (metadata.includes(normalizedKw)) score += 50;
            });
        }

        const hasKeywords = aiResponse.keywords && aiResponse.keywords.length > 0;
        const hasFilters = activeFilterKeys.length > 0;
        if (!hasFilters && !hasKeywords) score = 10;

        return { id: candidate.id, name: candidate.nombreReal, score, status: score > 0 ? 'INCLUDED' : 'ZERO_SCORE' };
    });

    console.log('Results:', JSON.stringify(results, null, 2));
}

console.log('Case 1: "Hombres" as FILTER');
runDiagnostic({ filters: { genero: "Hombre" }, keywords: [] });

console.log('\nCase 2: "Hombres" as KEYWORD');
runDiagnostic({ filters: {}, keywords: ["hombres"] });

console.log('\nCase 3: Empty Search');
runDiagnostic({ filters: {}, keywords: [] });
