import handler from './api/ai/query.js';

const TEST_QUERIES = [
    "hombres de 25 años",
    "mujeres en apodaca",
    "gente con preparatoria",
    "arquitectos en monterrey",
    "pendientes de guadalupe",
    "mayores de 30 años"
];

async function runDiagnosis() {
    console.log("🔍 INICIANDO DIAGNÓSTICO DE MAGIC SEARCH...");

    for (const q of TEST_QUERIES) {
        console.log(`\n------------------------------------------------`);
        console.log(`🧪 PROBANDO QUERY: "${q}"`);

        const req = {
            method: 'POST',
            body: { query: q },
            query: { limit: 5 }
        };

        const res = {
            status: (code) => ({
                json: (data) => {
                    if (data.success) {
                        console.log(`✅ ÉXITO: Encontró ${data.count} candidatos.`);
                        console.log(`🤖 Filtros IA:`, JSON.stringify(data.ai.filters, null, 2));
                        console.log(`📝 Keywords:`, data.ai.keywords);
                        if (data.candidates.length > 0) {
                            console.log(`👤 Ejemplo 1: ${data.candidates[0].nombreReal || data.candidates[0].nombre} (${data.candidates[0].genero}, ${data.candidates[0].edad} años, ${data.candidates[0].municipio}) [Score: ${data.candidates[0]._relevance}]`);
                        }
                    } else {
                        console.log(`❌ ERROR:`, data.error);
                    }
                },
                end: () => { }
            })
        };

        try {
            await handler(req, res);
        } catch (e) {
            console.error(`💥 CRASH en handler:`, e.message);
        }
    }
}

runDiagnosis();
