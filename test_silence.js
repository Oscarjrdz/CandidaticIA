import { AIGuard } from './api/utils/ai-guard.js';

const aiResult = {
   response_text: "El pago se realiza de manera semanal los días viernes.",
   has_exit_tag: false,
   has_move_tag: false
};

const validated = AIGuard.validate(
   aiResult,
   ['Hora de Cita'], // missing field
   "Cuando se paga", // user input
   "Oscar",
   [], // no categories
   false // isNew
);

console.log("VALIDATED RESULT:", validated);
