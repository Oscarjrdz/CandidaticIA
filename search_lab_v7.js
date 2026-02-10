
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

function runDiagnosticv7(aiResponse) {
    console.log('AI Response:', JSON.stringify(aiResponse.filters));
    const activeFilterKeys = Object.keys(aiResponse.filters || {});

    const results = mockCandidates.reduce((acc, candidate) => {
        let score = 0;
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
                    score += 5000;
                } else {
                    // TITAN v7.0 STRICT: If a filter is present, missing data is a mismatch
                    mismatchFound = true;
                }
            } else {
                if (isTargetMissing) {
                    mismatchFound = true;
                } else {
                    const hasMatch = matchesCriteria(val, criteria);
                    if (hasMatch) {
                        score += 5000;
                    } else {
                        mismatchFound = true;
                    }
                }
            }
        });

        if (!mismatchFound) {
            acc.push({ id: candidate.id, name: candidate.nombreReal, score });
        }
        return acc;
    }, []);

    console.log('Included:', results.map(r => r.name));
}

console.log('--- TITAN v7.0 LABORATORY ---');
console.log('Search: "Hombres"');
runDiagnosticv7({ filters: { genero: "Hombre" } });

console.log('\nSearch: "Mujeres de 18"');
runDiagnosticv7({ filters: { genero: "Mujer", edad: 18 } });
