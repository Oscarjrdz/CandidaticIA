const regex = /(¿Te gustaría agendar.*?entrevista.*?\?|¿Te queda bien\??)/i;
const texts = [
    "¡Listo Oscar! Te propongo entrevista el LUNES. ¿Te queda bien? 😊",
    "¿Te gustaría agendar una entrevista? Avísame",
    "Me parece excelente tu perfil. Cuéntame más."
];

for (const t of texts) {
    const match = t.match(regex);
    console.log(`\nTesting: "${t}"`);
    if (match && match.index > 0) {
        console.log("part1:", t.substring(0, match.index).trim());
        console.log("part2:", t.substring(match.index).trim());
    } else {
        console.log("Fallthrough:", t.trim());
    }
}
