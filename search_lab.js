import fs from 'fs';
import path from 'path';

// --- MOCK DATA ---
const mockCandidates = [
    { id: '1', nombreReal: 'Ana Garcia', genero: 'Mujer', edad: 18, municipio: 'Apodaca', statusAudit: 'complete', categoria: 'Ventas' },
    { id: '2', nombreReal: 'Juan Perez', genero: 'Hombre', edad: 25, municipio: 'Monterrey', statusAudit: 'complete', categoria: 'Almacen' },
    { id: '3', nombreReal: 'Maria Lopez', genero: 'Mujer', edad: 30, municipio: 'Apodaca', statusAudit: 'pending', categoria: 'Ventas' },
    { id: '4', nombreReal: 'Pedro Sanchez', genero: 'Hombre', edad: 40, municipio: 'Guadalupe', statusAudit: 'complete', categoria: 'Almacen' },
    { id: '5', nombreReal: 'No Proporcionado', genero: 'No proporcionado', edad: null, municipio: 'No proporcionado', statusAudit: 'pending', categoria: 'No proporcionado' },
    { id: '6', nombreReal: 'Carla Ruiz', genero: 'Mujer', edad: 18, municipio: 'Santa Catarina', statusAudit: 'complete', categoria: 'Ventas' },
    { id: '7', nombreReal: 'Luis Torres', genero: 'Hombre', edad: 18, municipio: 'Apodaca', statusAudit: 'pending', categoria: 'Admin' },
    { id: '8', nombreReal: 'Sofia Diaz', genero: 'Mujer', edad: 22, municipio: 'Monterrey', statusAudit: 'complete', categoria: 'Ventas' },
    { id: '9', nombreReal: 'Diego Ruiz', genero: 'Hombre', edad: 35, municipio: 'Apodaca', statusAudit: 'complete', categoria: 'Prod' },
    { id: '10', nombreReal: 'Elena Gil', genero: 'Mujer', edad: 45, municipio: 'Guadalupe', statusAudit: 'pending', categoria: 'Ventas' },
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
    if (criteria.min !== undefined || criteria.max !== undefined) {
        if (isNaN(numCandidate)) return false;
        if (criteria.min !== undefined && numCandidate < criteria.min) return false;
        if (criteria.max !== undefined && numCandidate > criteria.max) return false;
        return true;
    }
    if (criteria.op && criteria.val !== undefined) {
        const target = Number(criteria.val);
        if (isNaN(numCandidate) || isNaN(target)) return false;
        switch (criteria.op) {
            case '>': return numCandidate > target;
            case '<': return numCandidate < target;
            case '>=': return numCandidate >= target;
            case '<=': return numCandidate <= target;
            case '=': return numCandidate === target;
            default: return false;
        }
    }
    const cStr = normalize(candidateVal);
    const sStr = normalize(criteria.val || criteria);
    if (!cStr || ['no proporcionado', 'n/a', 'na', 'null', 'undefined'].includes(cStr)) return false;
    return cStr.includes(sStr);
};

function simulateSearch(aiResponse, candidates) {
    const activeFilterKeys = Object.keys(aiResponse.filters || {});
    const filtered = candidates.reduce((acc, candidate) => {
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
                        score += 5000;
                    } else {
                        mismatchFound = true;
                    }
                }
            }
        });

        if (mismatchFound) return acc;

        const hasKeywords = aiResponse.keywords && aiResponse.keywords.length > 0;
        const hasFilters = activeFilterKeys.length > 0;

        if (!hasFilters && !hasKeywords) score = 10;

        if (score > 0) {
            acc.push({ ...candidate, _relevance: Math.round(score) });
        }
        return acc;
    }, []);

    return filtered.sort((a, b) => b._relevance - a._relevance);
}

// --- 20 TEST CASES ---
const testCases = [
    { name: "Mujeres confirma", filters: { genero: "Mujer" }, expectedCount: 6 },
    { name: "Hombres confirma", filters: { genero: "Hombre" }, expectedCount: 5 },
    { name: "Edad 18 exacto", filters: { edad: 18 }, expectedCount: 4 },
    { name: "Mujeres de 18", filters: { genero: "Mujer", edad: 18 }, expectedCount: 3 },
    { name: "Completos (Audit)", filters: { statusAudit: "complete" }, expectedCount: 6 },
    { name: "Falta Nombre Real", filters: { nombreReal: "$missing" }, expectedCount: 1 },
    { name: "Cerca de Apodaca", filters: { municipio: "Apodaca" }, expectedCount: 5 },
    { name: "Ventas (Categoria)", filters: { categoria: "Ventas" }, expectedCount: 6 },
    { name: "Hombres Monterrey", filters: { genero: "Hombre", municipio: "Monterrey" }, expectedCount: 2 },
    { name: "Mujeres Monterrey", filters: { genero: "Mujer", municipio: "Monterrey" }, expectedCount: 2 },
    { name: "Edad < 30", filters: { edad: { op: "<", val: 30 } }, expectedCount: 6 },
    { name: "Edad > 40", filters: { edad: { op: ">", val: 40 } }, expectedCount: 2 },
    { name: "Hombres de 18", filters: { genero: "Hombre", edad: 18 }, expectedCount: 2 },
    { name: "Almacen vs Ventas", filters: { categoria: "Almacen" }, expectedCount: 3 },
    { name: "Santa Catarina", filters: { municipio: "Santa Catarina" }, expectedCount: 2 },
    { name: "Guadalupe", filters: { municipio: "Guadalupe" }, expectedCount: 3 },
    { name: "Pendientes", filters: { statusAudit: "pending" }, expectedCount: 4 },
    { name: "Admin (Cat)", filters: { categoria: "Admin" }, expectedCount: 2 },
    { name: "Rango 20-40", filters: { edad: { min: 20, max: 40 } }, expectedCount: 6 },
    { name: "Sin Categoria", filters: { categoria: "$missing" }, expectedCount: 1 },
];

console.log('🧪 Running Titan 20-Test Lab v6.1 (Final)...');
let failed = 0;

testCases.forEach((t, i) => {
    const results = simulateSearch({ filters: t.filters }, mockCandidates);
    const pass = results.length === t.expectedCount;
    process.stdout.write(`${pass ? '✅' : '❌'} [${i + 1}/20] ${t.name.padEnd(20)} `);
    if (!pass) {
        failed++;
        console.log(`-> Found: ${results.length} (Exp: ${t.expectedCount}) ❌`);
        // if (i === 10) console.log('DEBUG Test 11:', results.map(r => `${r.nombreReal} (Age: ${r.edad}, Rel: ${r._relevance})`));
    } else {
        console.log('-> OK');
    }
});

console.log(`\n🏁 Final Results: ${testCases.length - failed}/20 passed.`);
process.exit(failed > 0 ? 1 : 0);
