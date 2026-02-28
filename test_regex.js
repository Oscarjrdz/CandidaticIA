const text = "¡Listo Oscar rodriguez! ⏬ Te propongo entrevista el día **[LUNES 23 DE FEBRERO]** a las **[8:00 DE LA MAÑANA]**. ¿Te queda bien? ��";
const splitRegex = /(¿Te gustaría agendar.*?entrevista.*?\?|¿Te queda bien\??)/i;
const match = text.match(splitRegex);

if (match) {
    const splitIdx = match.index;
    const part1 = text.substring(0, splitIdx).trim();
    const part2 = text.substring(splitIdx).trim();
    console.log("part1:", part1);
    console.log("part2:", part2);
} else {
    console.log("No match");
}
