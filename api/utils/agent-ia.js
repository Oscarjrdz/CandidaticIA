/**
 * Agent IA — infraestructura base del agente propio de Oscar (Claude nativo).
 *
 * Reutiliza la integración del SDK oficial de Anthropic (@anthropic-ai/sdk,
 * claude-opus-4-8, adaptive thinking, tool use). A diferencia del sistema anterior
 * de skills SKILL.md (eliminado), este agente se define con DOS documentos vivos que
 * viven en Redis (fuente de verdad del proyecto) y son editables desde la UI y por el
 * propio agente vía tool use:
 *
 *   - AGENTS.md  → la definición/comportamiento del agente (system prompt).
 *   - MEMORY.md  → aprendizajes y mejoras que el agente acumula; el agente PROPONE
 *                  entradas y el humano las aprueba antes de que entren a MEMORY.md.
 *
 * En Vercel el filesystem es de solo lectura en producción, así que estos documentos
 * NO pueden vivir como archivos de git editables en runtime — por eso Redis.
 *
 * REQUIERE la variable de entorno ANTHROPIC_API_KEY. Sin ella, getAnthropicClient()
 * devuelve null y los endpoints responden un aviso claro (no se rompen).
 */
import Anthropic from '@anthropic-ai/sdk';
import { getUsers, validateAdminSession, getRedisClient } from './storage.js';

// Modelo por defecto: el más capaz de Anthropic. Para alto volumen se podría bajar a
// claude-sonnet-5 (más económico) — decisión de costo del negocio.
export const AGENT_MODEL = 'claude-opus-4-8';

// ─── Llaves de Redis ─────────────────────────────────────────────────────────
const KEY_AGENTS_MD = 'agent-ia:agents_md';
const KEY_MEMORY_MD = 'agent-ia:memory_md';
const KEY_MEMORY_PENDING = 'agent-ia:memory_pending'; // JSON: [{id, text, createdAt}]

// ─── Auth: solo SuperAdmin (mismo patrón que el resto de la plataforma) ──────
export async function requireSuperAdmin(req, res) {
    const userId = await validateAdminSession(req);
    if (!userId) {
        res.status(401).json({ success: false, error: 'No autorizado' });
        return null;
    }
    const users = await getUsers();
    const user = users.find((u) => u.id === userId);
    if (!user || user.role !== 'SuperAdmin') {
        res.status(403).json({ success: false, error: 'Solo SuperAdmin puede usar Agent IA' });
        return null;
    }
    return user;
}

// ─── Cliente Anthropic ───────────────────────────────────────────────────────
export function getAnthropicClient() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;
    return new Anthropic({ apiKey });
}

export function hasAnthropicKey() {
    return Boolean(process.env.ANTHROPIC_API_KEY);
}

// ─── Documento AGENTS.md (definición del agente) ─────────────────────────────
// Semilla mínima para "definir desde la base": el usuario la reescribe a su gusto,
// o el propio agente la ajusta con la herramienta editar_agents_md.
export const DEFAULT_AGENTS_MD = `# Agente

Eres el agente de Candidatic. Este documento (AGENTS.md) es tu definición: quién eres,
qué haces y cómo te comportas. Está vacío a propósito — se irá construyendo desde la base.

## Comportamiento

- Sé claro, directo y honesto. Si no sabes algo, dilo.
- Puedes EDITAR este mismo documento con la herramienta \`editar_agents_md\` cuando el
  usuario te pida cambiar tu definición o comportamiento.
- Cuando aprendas algo que valga la pena recordar entre conversaciones, PROPONLO con la
  herramienta \`proponer_memoria\`. No lo des por guardado: el usuario lo aprueba.

## Memoria

Tu memoria acumulada (MEMORY.md) se te entrega junto a este documento en cada
conversación. Úsala como contexto de lo aprendido.
`;

export async function getAgentsMd() {
    const redis = getRedisClient();
    if (!redis) return DEFAULT_AGENTS_MD;
    try {
        const raw = await redis.get(KEY_AGENTS_MD);
        return raw != null ? raw : DEFAULT_AGENTS_MD;
    } catch {
        return DEFAULT_AGENTS_MD;
    }
}

export async function setAgentsMd(content) {
    const redis = getRedisClient();
    if (!redis) return false;
    await redis.set(KEY_AGENTS_MD, String(content ?? ''));
    return true;
}

// ─── Documento MEMORY.md (aprendizajes aprobados) ────────────────────────────
export async function getMemoryMd() {
    const redis = getRedisClient();
    if (!redis) return '';
    try {
        return (await redis.get(KEY_MEMORY_MD)) || '';
    } catch {
        return '';
    }
}

export async function setMemoryMd(content) {
    const redis = getRedisClient();
    if (!redis) return false;
    await redis.set(KEY_MEMORY_MD, String(content ?? ''));
    return true;
}

// ─── Propuestas de memoria (pendientes de aprobación humana) ─────────────────
export async function getPendingMemory() {
    const redis = getRedisClient();
    if (!redis) return [];
    try {
        const raw = await redis.get(KEY_MEMORY_PENDING);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
}

async function setPendingMemory(list) {
    const redis = getRedisClient();
    if (!redis) return false;
    await redis.set(KEY_MEMORY_PENDING, JSON.stringify(Array.isArray(list) ? list : []));
    return true;
}

// El agente PROPONE una entrada (no la guarda). Devuelve la propuesta creada.
export async function addMemoryProposal(text) {
    const clean = String(text || '').trim();
    if (!clean) return null;
    const list = await getPendingMemory();
    const proposal = {
        id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        text: clean,
        createdAt: new Date().toISOString()
    };
    list.push(proposal);
    await setPendingMemory(list);
    return proposal;
}

// El humano APRUEBA una propuesta → se anexa a MEMORY.md y se quita de pendientes.
export async function approveMemoryProposal(id) {
    const list = await getPendingMemory();
    const proposal = list.find((p) => p.id === id);
    if (!proposal) return { success: false, error: 'Propuesta no encontrada' };
    const current = await getMemoryMd();
    const stamp = new Date().toISOString().slice(0, 10);
    const entry = `- (${stamp}) ${proposal.text}`;
    const next = current.trim() ? `${current.trim()}\n${entry}\n` : `# Memoria\n\n${entry}\n`;
    await setMemoryMd(next);
    await setPendingMemory(list.filter((p) => p.id !== id));
    return { success: true, memoryMd: next };
}

// El humano RECHAZA una propuesta → solo se quita de pendientes.
export async function rejectMemoryProposal(id) {
    const list = await getPendingMemory();
    if (!list.some((p) => p.id === id)) return { success: false, error: 'Propuesta no encontrada' };
    await setPendingMemory(list.filter((p) => p.id !== id));
    return { success: true };
}

// ─── System prompt = AGENTS.md + MEMORY.md + contrato de herramientas ────────
export async function assembleSystemPrompt() {
    const [agentsMd, memoryMd] = await Promise.all([getAgentsMd(), getMemoryMd()]);
    const parts = [agentsMd.trim() || DEFAULT_AGENTS_MD];
    parts.push(
        '\n\n# MEMORIA (MEMORY.md)\n' +
        'Este es el contenido EXACTO y ACTUAL de tu MEMORY.md. PUEDES LEERLO: si el usuario ' +
        'te pide un resumen de tu memoria, "el último punto", "qué recuerdas" o algo similar, ' +
        'respóndele con base en lo que ves aquí abajo (el último punto es la última línea de la lista).\n\n' +
        (memoryMd.trim() ? memoryMd.trim() : '(Aún no hay memoria acumulada.)')
    );
    parts.push(
        '\n\n# HERRAMIENTAS\n' +
        '- `editar_agents_md`: reescribe tu documento de definición (AGENTS.md). Úsala SOLO cuando el usuario te pida cambiar quién eres o cómo te comportas. Envía el documento COMPLETO ya modificado, no un fragmento.\n' +
        '- `proponer_memoria`: propón un aprendizaje para guardar en MEMORY.md entre conversaciones. Antes de llamarla, PREGÚNTALE al usuario en tu respuesta si quiere que lo guardes (ej. "¿Quieres que lo recuerde?"). Al proponerla, en el chat aparece una tarjeta con botones Guardar/Descartar: el usuario decide ahí mismo. NO afirmes que ya quedó guardado — queda pendiente hasta que el usuario lo apruebe.'
    );
    return parts.join('');
}
