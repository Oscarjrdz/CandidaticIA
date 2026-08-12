import { waitUntil } from '@vercel/functions';

// ════════════════════════════════════════════════════════════════════════════
// TRABAJO EN SEGUNDO PLANO QUE NO SE PIERDE AL RESPONDER
//
// En Vercel, una función serverless se CONGELA en cuanto responde el HTTP. Cualquier
// promesa lanzada fire-and-forget (sin await) justo antes de responder queda a medias
// y se descarta — bug real confirmado en producción (ago 2026): el motor de Flujos se
// disparaba así y hasta el 15% de los candidatos que pasaban a un nodo de envío no
// recibían nada, sin siquiera un log de error (el envío nunca llegó a ejecutarse).
//
// waitUntil() es el mecanismo oficial de Vercel para esto: responde de inmediato PERO
// mantiene viva la instancia hasta que la promesa termina (hasta maxDuration). Fuera de
// un contexto de request de Vercel (local, simulador, tests) waitUntil lanza — ahí no
// hay instancia que congelar, así que el fallback es dejar correr la promesa tal cual.
// ════════════════════════════════════════════════════════════════════════════
export function runInBackground(promise) {
    const p = Promise.resolve(promise).catch((e) => {
        console.error('[BACKGROUND] tarea en segundo plano falló:', e?.message);
    });
    try {
        waitUntil(p);
    } catch {
        // Sin contexto de request de Vercel (local/dev/simulador): la promesa sigue
        // corriendo en el event loop normal — no hay congelamiento que evitar.
    }
    return p;
}
