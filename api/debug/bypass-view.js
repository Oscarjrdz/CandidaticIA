import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    const redis = getRedisClient();
    const TRACE_KEY = 'debug:bypass:traces';

    if (req.method === 'DELETE') {
        await redis.del(TRACE_KEY);
        return res.status(200).json({ success: true });
    }

    // Fetch traces
    const rawTraces = await redis.lrange(TRACE_KEY, 0, -1);
    const traces = rawTraces.map(t => {
        try { return JSON.parse(t); } catch (e) { return null; }
    }).filter(t => t);

    // HTML Template
    const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>🕵️‍♂️ Bypass X-Ray</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <script>
            tailwind.config = {
                darkMode: 'class',
                theme: { extend: { colors: { gray: { 900: '#111827', 800: '#1f2937', 700: '#374151' } } } }
            }
        </script>
        <style>
            @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Inter:wght@400;600;800&display=swap');
            body { font-family: 'Inter', sans-serif; }
            .mono { font-family: 'JetBrains Mono', monospace; }
        </style>
    </head>
    <body class="bg-gray-900 text-gray-100 min-h-screen p-6">
        <div class="max-w-6xl mx-auto">
            <header class="flex justify-between items-center mb-8 border-b border-gray-700 pb-4">
                <div>
                    <h1 class="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-500">
                        BYPASS X-RAY 🔍
                    </h1>
                    <p class="text-gray-400 text-sm mt-1">Instrumentación en tiempo real del motor de reglas</p>
                </div>
                <div class="flex gap-3">
                    <button onclick="window.location.reload()" class="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm font-bold border border-gray-700 transition">
                        🔄 Refrescar
                    </button>
                    <button onclick="clearLogs()" class="px-4 py-2 bg-red-900/30 hover:bg-red-900/50 text-red-400 border border-red-900/50 rounded-lg text-sm font-bold transition">
                        🗑️ Limpiar
                    </button>
                </div>
            </header>

            <div id="logs-container" class="space-y-6">
                ${traces.length === 0 ? `
                    <div class="text-center py-20 text-gray-500">
                        <p class="text-xl">💤 Sin actividad reciente</p>
                        <p class="text-sm mt-2">Interactúa con el bot para generar trazas.</p>
                    </div>
                ` : traces.map((trace, idx) => `
                    <div class="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden shadow-xl">
                        <div class="bg-gray-800/50 p-4 border-b border-gray-700 flex justify-between items-center">
                            <div class="flex items-center gap-3">
                                <span class="bg-blue-900/30 text-blue-400 px-2 py-1 rounded text-xs font-mono border border-blue-900/50">
                                    ${trace.timestamp}
                                </span>
                                <span class="font-bold text-lg">${trace.candidateData?.nombreReal || 'Desconocido'}</span>
                                <span class="text-gray-500 text-sm mono">(${trace.candidateId})</span>
                            </div>
                            <div class="flex items-center gap-2">
                                <span class="text-xs uppercase tracking-wider font-bold ${trace.finalResult === 'MATCH' ? 'text-green-400' : 'text-gray-500'}">
                                    ${trace.finalResult === 'MATCH' ? '✅ ROUTED' : '❌ NO MATCH'}
                                </span>
                            </div>
                        </div>
                        
                        <div class="p-0">
                            <div class="grid grid-cols-12 divide-x divide-gray-700">
                                <!-- Candidate DNA -->
                                <div class="col-span-12 md:col-span-4 p-4 bg-gray-800/30">
                                    <h3 class="text-xs font-black text-gray-500 uppercase tracking-widest mb-3">Candidato ADN</h3>
                                    <div class="space-y-2 text-sm mono text-gray-300">
                                        <div class="flex justify-between border-b border-gray-700/50 pb-1">
                                            <span class="text-gray-500">Edad:</span>
                                            <span class="text-yellow-400">${trace.candidateData?.edad || 'N/A'}</span>
                                        </div>
                                        <div class="flex justify-between border-b border-gray-700/50 pb-1">
                                            <span class="text-gray-500">Municipio:</span>
                                            <span class="text-purple-400">${trace.candidateData?.municipio || 'N/A'}</span>
                                        </div>
                                        <div class="flex justify-between border-b border-gray-700/50 pb-1">
                                            <span class="text-gray-500">Categoría:</span>
                                            <span class="text-pink-400">${trace.candidateData?.categoria || 'N/A'}</span>
                                        </div>
                                        <div class="flex justify-between border-b border-gray-700/50 pb-1">
                                            <span class="text-gray-500">Escolaridad:</span>
                                            <span class="text-blue-400">${trace.candidateData?.escolaridad || 'N/A'}</span>
                                        </div>
                                         <div class="flex justify-between border-b border-gray-700/50 pb-1">
                                            <span class="text-gray-500">Género:</span>
                                            <span class="text-indigo-400">${trace.candidateData?.genero || 'N/A'}</span>
                                        </div>
                                    </div>
                                </div>

                                <!-- Rules EvaluationEngine -->
                                <div class="col-span-12 md:col-span-8 p-4">
                                     <h3 class="text-xs font-black text-gray-500 uppercase tracking-widest mb-3">Evaluación de Reglas (${trace.rules?.length || 0})</h3>
                                     <div class="space-y-3">
                                        ${trace.rules?.map(r => `
                                            <div class="border ${r.isMatch ? 'border-green-500/50 bg-green-900/10' : 'border-gray-700 bg-gray-800/50'} rounded-lg p-3 transition-colors">
                                                <div class="flex justify-between items-start mb-2">
                                                    <span class="font-bold text-sm ${r.isMatch ? 'text-green-300' : 'text-gray-400'}">
                                                        ${r.ruleName}
                                                    </span>
                                                    ${r.isMatch
            ? '<span class="px-2 py-0.5 bg-green-500 text-black text-[10px] font-black rounded uppercase">MATCH</span>'
            : '<span class="text-gray-600 text-[10px] font-mono">SKIP</span>'
        }
                                                </div>
                                                
                                                <div class="grid grid-cols-2 md:grid-cols-5 gap-2 text-[10px] mono">
                                                    <!-- Age -->
                                                    <div class="flex flex-col">
                                                        <span class="text-gray-500">Edad [${r.criteria.minAge}-${r.criteria.maxAge}]</span>
                                                        <span class="${r.checks.age ? 'text-green-400' : 'text-red-400'}">
                                                            ${r.checks.age ? 'PASÓ' : 'FALLÓ'}
                                                        </span>
                                                    </div>
                                                    <!-- Mun -->
                                                    <div class="flex flex-col">
                                                        <span class="text-gray-500">Municipio</span>
                                                        <span class="${r.checks.municipio ? 'text-green-400' : 'text-red-400'} truncate" title="${r.criteria.municipios}">
                                                            ${r.checks.municipio ? 'PASÓ' : 'FALLÓ'}
                                                        </span>
                                                    </div>
                                                     <!-- Cat -->
                                                    <div class="flex flex-col">
                                                        <span class="text-gray-500">Categoría</span>
                                                        <span class="${r.checks.categoria ? 'text-green-400' : 'text-red-400'} truncate" title="${r.criteria.categories}">
                                                            ${r.checks.categoria ? 'PASÓ' : 'FALLÓ'}
                                                        </span>
                                                    </div>
                                                    <!-- Esc -->
                                                    <div class="flex flex-col">
                                                        <span class="text-gray-500">Escolaridad</span>
                                                        <span class="${r.checks.escolaridad ? 'text-green-400' : 'text-red-400'} truncate" title="${r.criteria.escolaridades}">
                                                            ${r.checks.escolaridad ? 'PASÓ' : 'FALLÓ'}
                                                        </span>
                                                    </div>
                                                     <!-- Gen -->
                                                    <div class="flex flex-col">
                                                        <span class="text-gray-500">Género</span>
                                                        <span class="${r.checks.genero ? 'text-green-400' : 'text-red-400'} truncate" title="${r.criteria.gender}">
                                                            ${r.checks.genero ? 'PASÓ' : 'FALLÓ'}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        `).join('')}
                                     </div>
                                </div>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>

        <script>
            async function clearLogs() {
                if(!confirm('¿Borrar historial?')) return;
                await fetch('/api/debug/bypass-view', { method: 'DELETE' });
                window.location.reload();
            }
            
            // Auto refresh every 5s if tab is visible
            setInterval(() => {
                if(!document.hidden) window.location.reload();
            }, 5000);
        </script>
    </body>
    </html>
    `;

    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(html);
}
