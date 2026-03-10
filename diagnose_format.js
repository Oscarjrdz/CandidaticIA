const _DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const _MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const _NUM_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];

function isEmoji(str) {
    if (!str) return false;
    return /\p{Emoji}/u.test(str);
}

function formatRecruiterMessage(text) {
    if (!text) return text;
    if (!text.includes('[MSG_SPLIT]')) {
        const lastQ = text.lastIndexOf('\xbf');
        if (lastQ > 50) {
            const beforeQ = text.substring(0, lastQ);
            const lastBang = beforeQ.lastIndexOf('!');
            const lastDot = beforeQ.lastIndexOf('.');
            const naturalEnd = Math.max(lastBang, lastDot);
            if (naturalEnd > 25) {
                let splitAt = naturalEnd + 1;
                while (splitAt < beforeQ.length && (isEmoji(beforeQ[splitAt]) || beforeQ[splitAt] === ' ')) {
                    splitAt++;
                }
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

const input = '¡Claro! 😊 Para darte información exacta sobre vacantes o entrevistas, primero necesito completar tu registro.\n\n¡Qué alegría! 🌟 Para que ya quedes en nuestro sistema, mira estas son las opciones que tengo para ti 💖:\n✅ Limpieza\n\n✅ Promotoría\n\n✅ Guardias\n¿Cuál eliges? 🤭✨';
console.log(formatRecruiterMessage(input));
process.exit(0);
