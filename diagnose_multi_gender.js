
// Diagnostic for Multi-Value Gender logic
const normalize = (str) => String(str || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

function simulateSniffer(query) {
    const queryLower = normalize(query);
    const genderTerms = ['hombre', 'hombres', 'caballero', 'caballeros', 'chico', 'chicos'];
    const femaleTerms = ['mujer', 'mujeres', 'dama', 'damas', 'chica', 'chicas'];

    let filters = {};

    // Current biased logic
    if (genderTerms.some(t => queryLower.includes(t))) filters.genero = 'Hombre';
    else if (femaleTerms.some(t => queryLower.includes(t))) filters.genero = 'Mujer';

    return filters;
}

function fixedSniffer(query) {
    const queryLower = normalize(query);
    const genderTerms = ['hombre', 'hombres', 'caballero', 'caballeros', 'chico', 'chicos'];
    const femaleTerms = ['mujer', 'mujeres', 'dama', 'damas', 'chica', 'chicas'];

    let filters = {};

    const hasMale = genderTerms.some(t => queryLower.includes(t));
    const hasFemale = femaleTerms.some(t => queryLower.includes(t));

    if (hasMale && hasFemale) {
        // Multi-gender intent: We remove the strict filter to show both
        console.log("Multi-gender intent detected. Inclusive search enabled.");
    } else if (hasMale) {
        filters.genero = 'Hombre';
    } else if (hasFemale) {
        filters.genero = 'Mujer';
    }

    return filters;
}

const query = "hombres y mujeres de guadalupe";
console.log("Query:", query);
console.log("Current Sniffer Result:", simulateSniffer(query));
console.log("Fixed Sniffer Result:", fixedSniffer(query));
