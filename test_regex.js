const text = "¡Perfecto! 🎉 Queda agendada tu entrevista para el martes 3 de marzo a las 8:00 AM. En breve te contactamos para confirmar los detalles finales. ¡Muchas gracias! 🌸";

const isCitaConfirmation = text.toLowerCase().includes('queda agendada') ||
    text.toLowerCase().includes('entrevista agendada');

const dateRegex = /para el\s+([a-zA-Z0-9\s]+)\s+a\s+las/i;
const timeRegex = /a\s+las\s+([0-9:]+\s*(?:AM|PM|am|pm|hrs))/i;

const dateMatch = text.match(dateRegex);
const timeMatch = text.match(timeRegex);

console.log("isCitaConfirmation:", isCitaConfirmation);
console.log("Date:", dateMatch ? dateMatch[1] : null);
console.log("Time:", timeMatch ? timeMatch[1] : null);
