function isEmoji(str) { return /\p{Emoji}/u.test(str); }
let responseTextVal = "Se paga de manera semanal, todos los viernes. 💰✨ ¿Te gustaría agendar una cita de entrevista? 😊";
let messagesToSend = [];
const splitRegex = /(¿Te gustaría que (?:te )?agende.*?(?:entrevista|cita).*?\?|¿Te gustaría agendar.*?entrevista.*?\?|¿Te queda bien\??|¿Te puedo agendar|¿Deseas que programe|¿Te interesa que asegure|¿Te confirmo tu cita|¿Quieres que reserve|¿Procedo a agendar|¿Te aparto una cita|¿Avanzamos con|¿Autorizas que agende)/i;
const match = responseTextVal.match(splitRegex);

if (match) {
    const beforeCta = responseTextVal.substring(0, match.index);
    const lastBang = beforeCta.lastIndexOf('!');
    const lastDot = beforeCta.lastIndexOf('.');
    const naturalEnd = Math.max(lastBang, lastDot);
    let splitAt = naturalEnd > 25 ? naturalEnd + 1 : match.index;
    if (naturalEnd > 25) {
        while (splitAt < beforeCta.length && (isEmoji(beforeCta[splitAt]) || beforeCta[splitAt] === ' ')) splitAt++;
    }
    const part1 = responseTextVal.substring(0, splitAt).trim();
    const part2 = responseTextVal.substring(splitAt).trim();
    if (part1) messagesToSend.push(part1);
    messagesToSend.push(part2);
} else {
    messagesToSend.push(responseTextVal);
}
console.log(messagesToSend);
