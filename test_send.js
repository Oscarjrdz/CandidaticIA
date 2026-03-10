const _DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const _MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const _NUM_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];

function isEmoji(str) {
    if (!str) return false;
    return /\p{Emoji}/u.test(str);
}

function formatRecruiterMessage(text) {
    if (!text) return text;
    // ⏰ HOURS MESSAGE: "Perfecto, para el YYYY-MM-DD tengo estas opciones..."
    // Using [\s\S] instead of . to match across newlines in our simulated text below
    if (/Perfecto.{0,60}\d{4}-\d{2}-\d{2}/is.test(text)) {
        text = text.replace(/(\d{4})-(\d{2})-(\d{2})/g, (_, y, m, d) => {
            const date = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
            const mn = _MONTH_NAMES[date.getMonth()];
            return `${_DAY_NAMES[date.getDay()]} ${parseInt(d)} de ${mn.charAt(0).toUpperCase() + mn.slice(1)}`;
        });
        let slotIdx = 0;
        text = text.replace(/🔹\s*Opci[oó]n\s*\d+:\s*/gi, () => `${_NUM_EMOJIS[slotIdx++] || `${slotIdx}.`} `);
        text = text.replace(/(\d{1,2}:\d{2}\s*(?:AM|PM))(?!\s*⏰)/gi, '$1 ⏰');
        // Split closing ¿Cuál prefieres? as separate bubble
        const _qIdx = text.lastIndexOf('\xbf');
        if (_qIdx > 0) {
            text = text.substring(0, _qIdx).trim() + '[MSG_SPLIT]' + text.substring(_qIdx).trim();
        }
    }
    // 🗓️ CONFIRMATION MESSAGE: "Ok [name], entonces agendamos..."
    if (/(?:Ok|Bien|Perfecto)[,\s]+\w+[,\s]+entonces agendamos|agendamos tu cita|confirmamos tu cita|apartamos tu cita|reserve tu lugar/i.test(text)) {
        // ... omitted
    }
    // 📩 GENERIC LAST-QUESTION SPLIT: 
    if (!text.includes('[MSG_SPLIT]')) {
        const lastQ = text.lastIndexOf('\xbf');
        if (lastQ > 50) {
            const beforeQ = text.substring(0, lastQ);
            const lastBang = beforeQ.lastIndexOf('!');
            const lastDot = beforeQ.lastIndexOf('.');
            const naturalEnd = Math.max(lastBang, lastDot);

            if (naturalEnd > 25) {
                let splitAt = naturalEnd + 1;
                while (splitAt < beforeQ.length && (isEmoji(beforeQ[splitAt]) || beforeQ[splitAt] === ' ')) splitAt++;
                const bodyPart = text.substring(0, splitAt).trim();
                const questionPart = text.substring(splitAt).trim();
                if (bodyPart.length > 20 && questionPart.length > 5) {
                    text = bodyPart + '[MSG_SPLIT]' + questionPart;
                }
            }
        }
    }
    return text;
}

let t = "El pago se realiza de manera semanal los días viernes.\n\nPerfecto, para el 2026-03-10 tengo estas opciones de horario para ti:\n\n🔹 Opción 1: 10:00 AM\n\n🔹 Opción 2: 11:00 AM\n\n¿Cuál prefieres?";
console.log("RESULTADO FORMAT:\n" + formatRecruiterMessage(t));
