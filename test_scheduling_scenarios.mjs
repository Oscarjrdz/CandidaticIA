/**
 * TEST INTERNO — Escenarios de agenda críticos
 * Simula el radar de días en agent.js directamente sin llamar al servidor.
 */

// ── Helpers de agent.js ────────────────────────────────────────
const _DN4 = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
const _MN4 = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const _NE4 = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣'];

function _parseDayName(text) {
    const t = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (/\blunes\b/.test(t)) return 1;
    if (/\bmartes\b/.test(t)) return 2;
    if (/\bmiercoles\b/.test(t)) return 3;
    if (/\bjueves\b/.test(t)) return 4;
    if (/\bviernes\b/.test(t)) return 5;
    if (/\bsabado\b/.test(t)) return 6;
    if (/\bdomingo\b/.test(t)) return 0;
    return null;
}

// ── Simulated calendar — only Lunes 6 Abril ──────────────────
const _uDays = ['2026-04-06']; // Solo Lunes disponible
const _fn4 = 'Oscar';

function simulateRadar(candidateMessage) {
    const _rawInput = candidateMessage;
    const _rawInputLines = [_rawInput];
    let skipRecruiterInference = false;
    let responseTextVal = null;
    let aiResult = null;
    let _resolvedDayIdx = null;

    // Day-name detection (from agent.js)
    let _matchedLine = _rawInput;
    let _dayOfWeek = null;
    for (const _line of _rawInputLines) {
        const _dow = _parseDayName(_line);
        if (_dow !== null) { _dayOfWeek = _dow; _matchedLine = _line; break; }
    }

    if (_dayOfWeek !== null) {
        const _matchingIdxs = _uDays.map((ds, i) => {
            const d = new Date(parseInt(ds.substr(0,4)), parseInt(ds.substr(5,2))-1, parseInt(ds.substr(8,2)));
            return d.getDay() === _dayOfWeek ? i : -1;
        }).filter(i => i !== -1);

        if (_matchingIdxs.length === 1) {
            _resolvedDayIdx = _matchingIdxs[0];
        } else if (_matchingIdxs.length === 0) {
            // NEW BLOCK — varied no-avail response
            skipRecruiterInference = true;
            const _cName_DA = _fn4 || '';
            const _nameTag = _cName_DA ? ` ${_cName_DA}` : '';
            const _subLines2 = _uDays.map((ds, i) => {
                const d = new Date(parseInt(ds.substr(0,4)), parseInt(ds.substr(5,2))-1, parseInt(ds.substr(8,2)));
                return `${_NE4[i] || `${i+1}.`} ${_DN4[d.getDay()]} ${d.getDate()} de ${_MN4[d.getMonth()]} 📅`;
            }).join('\n');
            const _reqDayName2 = _DN4[_dayOfWeek];
            const _ctaDA = _uDays.length === 1 ? '¿Te queda bien este día? 😊' : '¿Alguno de estos días te funciona? 😊';
            const _noAvailVars = [
                `Ay${_nameTag}, el ${_reqDayName2} no tenemos entrevistas disponibles 😔 Te comparto los días en los que sí tenemos espacio:\n\n${_subLines2}\n\n[MSG_SPLIT]${_ctaDA}`,
                `Para el ${_reqDayName2} no cuento con citas${_cName_DA ? `, ${_cName_DA}` : ''} 🙏 Pero aquí van mis días disponibles:\n\n${_subLines2}\n\n[MSG_SPLIT]${_ctaDA}`,
                `Uy${_nameTag}, el ${_reqDayName2} no tengo nada disponible 😅 Mis opciones son:\n\n${_subLines2}\n\n[MSG_SPLIT]${_ctaDA}`,
                `Ese ${_reqDayName2} no lo tengo habilitado${_cName_DA ? `, ${_cName_DA}` : ''} 🙈 Los días en que sí hay espacio:\n\n${_subLines2}\n\n[MSG_SPLIT]${_ctaDA}`,
                `El ${_reqDayName2} no está disponible en mi agenda${_nameTag} 📋 Lo que tengo es:\n\n${_subLines2}\n\n[MSG_SPLIT]${_ctaDA}`,
                `Para el ${_reqDayName2} no hay lugar por el momento${_nameTag} 😕 Lo que sí tengo:\n\n${_subLines2}\n\n[MSG_SPLIT]${_ctaDA}`,
                `El ${_reqDayName2} no tengo citas${_nameTag}, pero mira lo que sí tengo:\n\n${_subLines2}\n\n[MSG_SPLIT]${_ctaDA}`,
                `Ese ${_reqDayName2} no aparece en mi calendario${_nameTag} 📅 Mis fechas disponibles:\n\n${_subLines2}\n\n[MSG_SPLIT]${_ctaDA}`,
                `El ${_reqDayName2} no lo tengo disponible${_nameTag} 🙈 Aquí van mis opciones:\n\n${_subLines2}\n\n[MSG_SPLIT]${_ctaDA}`,
                `En este momento el ${_reqDayName2} no está en mi agenda${_nameTag} 🗓️ Te ofrezco:\n\n${_subLines2}\n\n[MSG_SPLIT]${_ctaDA}`
            ];
            responseTextVal = _noAvailVars[Math.floor(Math.random() * _noAvailVars.length)];
            aiResult = { thought_process: 'CITA:unavailable_day_name' };
        }
    }

    return { skipRecruiterInference, responseTextVal, aiResult, _resolvedDayIdx, _dayOfWeek };
}

// ── TEST CASES ────────────────────────────────────────────────
const tests = [
    { msg: 'Prefiero el martes',         expect: 'NO_AVAIL', desc: 'Candidato prefiere martes (no disponible)' },
    { msg: 'Y para el viernes',          expect: 'NO_AVAIL', desc: 'Pregunta por viernes (no disponible)' },
    { msg: '¿y el miércoles?',           expect: 'NO_AVAIL', desc: 'Pregunta con acento por miércoles' },
    { msg: 'Mejor el jueves',            expect: 'NO_AVAIL', desc: 'Quiere el jueves (no disponible)' },
    { msg: 'El sábado me va mejor',      expect: 'NO_AVAIL', desc: 'Prefiere sábado (no disponible)' },
    { msg: 'El domingo',                 expect: 'NO_AVAIL', desc: 'Pide domingo (no disponible)' },
    { msg: 'El lunes',                   expect: 'RESOLVED', desc: 'Elige lunes (SÍ disponible) — debe ir al selección de hora' },
    { msg: 'Sí',                         expect: 'NO_DAY',   desc: 'Mensaje sin nombre de día — pasa a GPT' },
    { msg: 'A las 10 mejor',             expect: 'NO_DAY',   desc: 'Candidato quiere cambiar hora — pasa a GPT (regla de hora)' },
    { msg: 'Que no puedo ese dia lic',   expect: 'NO_DAY',   desc: 'Rechazo sin nombre de día — GPT aplica standby' },
];

console.log('\n🧪 PRUEBA INTERNA — Radar de días (CITA step)\n');
console.log(`📅 Calendario simulado: Solo ${_DN4[new Date(_uDays[0]+'T12:00:00').getDay()]} ${new Date(_uDays[0]+'T12:00:00').getDate()} de ${_MN4[new Date(_uDays[0]+'T12:00:00').getMonth()]}\n`);
console.log('─'.repeat(70));

let passed = 0;
let failed = 0;

for (const t of tests) {
    const result = simulateRadar(t.msg);
    let status = 'NO_DAY';
    if (result.skipRecruiterInference && result.responseTextVal) status = 'NO_AVAIL';
    else if (result._resolvedDayIdx !== null) status = 'RESOLVED';

    const ok = status === t.expect;
    if (ok) passed++; else failed++;

    const icon = ok ? '✅' : '❌';
    console.log(`${icon} "${t.msg}"`);
    console.log(`   Esperado: ${t.expect} | Obtenido: ${status}`);
    if (status === 'NO_AVAIL') {
        // Show the actual message (truncated)
        const bubbles = result.responseTextVal.split('[MSG_SPLIT]');
        console.log(`   Burbuja 1: ${bubbles[0].substring(0, 80)}...`);
        console.log(`   Burbuja 2: ${bubbles[1] || '(ninguna)'}`);
    }
    console.log('');
}

console.log('─'.repeat(70));
console.log(`\n🎯 Resultado: ${passed}/${tests.length} pruebas pasadas ${failed > 0 ? `(${failed} fallidas ❌)` : '✅ TODO OK'}\n`);

if (failed > 0) process.exit(1);
