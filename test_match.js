import * as OrchestratorLocal from './api/utils/orchestrator.js';

const rules = [
    {
        "projectId": "1",
        "name": "Ayudante Rule",
        "categories": ["ayudante", "ayudante general"],
        "municipios": ["escobedo"],
        "escolaridades": ["secundaria"]
    }
];

const candidate = {
    "edad": "36",
    "genero": "Hombre",
    "categoria": "Ayudante",
    "municipio": "galicia 142 escobedo nl",
    "escolaridad": "Secu"
};

const normalizeStr = (s) => (s || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
console.log("Candidate values normalized:");
console.log("Category:", normalizeStr(candidate.categoria));
console.log("Municipio:", normalizeStr(candidate.municipio));
console.log("Escolaridad:", normalizeStr(candidate.escolaridad));

let matched = false;
for (const rule of rules) {
    // 3. Category Check
    const cCat = (candidate.categoria || '').toLowerCase().trim();
    if (rule.categories && rule.categories.length > 0) {
        const isMatch = rule.categories.some(rc => rc.toLowerCase() === cCat);
        if (!isMatch) { console.log('Failed Category', cCat); continue; }
    }

    // 4. Municipio Check
    const cMun = normalizeStr(candidate.municipio);
    if (rule.municipios && rule.municipios.length > 0) {
        const isMatch = rule.municipios.some(rm => normalizeStr(rm) === cMun);
        if (!isMatch) { console.log('Failed Municipio', cMun, 'against', rule.municipios); continue; }
    }

    // 5. Escolaridad Check
    const cEsc = normalizeStr(candidate.escolaridad);
    if (rule.escolaridades && rule.escolaridades.length > 0) {
        const isMatch = rule.escolaridades.some(re => normalizeStr(re) === cEsc);
        if (!isMatch) { console.log('Failed Escolaridad', cEsc, 'against', rule.escolaridades); continue; }
    }

    matched = true;
    console.log("MATCHED!");
}
if (!matched) console.log("NO MATCH");
