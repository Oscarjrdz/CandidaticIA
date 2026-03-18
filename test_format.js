import { formatRecruiterMessage } from './api/ai/agent.js';

async function test() {
    console.log("=== TEST 1: HOURS LIST ===");
    const rawHours = "Perfecto, para el Martes 31 de Marzo tengo estas opciones de horario para ti:\n\n🔹 Opción 1: 12:30 PM\n\n🔹 Opción 2: 05:00 PM\n\n🔹 Opción 3: 06:00 PM\n\n¿Cuál prefieres?";
    const formatted1 = formatRecruiterMessage(rawHours, {}, { isInicio: false });
    console.log(formatted1);
    console.log("------------------------");

    console.log("=== TEST 2: CONFIRMATION ===");
    const rawConfirm = "Ok Oscar, entonces agendamos tu entrevista para el Martes 31 de Marzo a las 06:00 PM.[MSG_SPLIT]¿Estamos de acuerdo? 🤝";
    const formatted2 = formatRecruiterMessage(rawConfirm, { nombreReal: 'Oscar' }, { isInicio: false });
    console.log(formatted2);
    console.log("------------------------");
    
    // Sometimes no name is passed or candidateData is empty
    console.log("=== TEST 3: NO NAME ===");
    const rawConfirm2 = "Ok, entonces agendamos tu entrevista para el Martes 31 de Marzo a las 06:00 PM.[MSG_SPLIT]¿Estamos de acuerdo? 🤝";
    const formatted3 = formatRecruiterMessage(rawConfirm2, {}, { isInicio: false });
    console.log(formatted3);
}

test();
