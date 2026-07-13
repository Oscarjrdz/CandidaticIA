/**
 * Brenda Agent — infraestructura del AGENTE NATIVO de Anthropic (Claude).
 *
 * Reemplaza al sistema casero anterior (que corría sobre GPT-4o-mini con JSON en
 * Redis). Esto es NATIVO de Anthropic:
 *   - Los skills son carpetas SKILL.md en /skills (formato oficial de Agent Skills:
 *     frontmatter YAML con name + description, cuerpo en markdown). Fuente de verdad
 *     versionada en git. Ver github.com/anthropics/skills.
 *   - El agente corre sobre el SDK oficial @anthropic-ai/sdk con client.messages.create,
 *     modelo claude-opus-4-8, adaptive thinking, y TOOL USE real (loop manual).
 *
 * ARQUITECTURA de 3 capas (definida por Oscar):
 *   Brenda   = la cuenta de WhatsApp/Meta (canal, ya existe) — el envío real vive fuera.
 *   Agente   = el reclutador (estilo): skills recruiter-* → van al system prompt.
 *   Skill    = el cliente (hechos cerrados): skills client-* → el agente los consulta
 *              vía la herramienta `consultar_vacante` (progressive disclosure real).
 *
 * REQUIERE la variable de entorno ANTHROPIC_API_KEY para funcionar en vivo.
 * Sin ella, getAnthropicClient() devuelve null y el endpoint responde un aviso claro.
 */
/* global process */
import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { getUsers, validateAdminSession } from './storage.js';

// Modelo por defecto: el más capaz de Anthropic. Para alto volumen de WhatsApp se
// puede bajar a claude-sonnet-5 (mucho más económico) — es decisión de costo de Oscar.
export const AGENT_MODEL = 'claude-opus-4-8';

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
        res.status(403).json({ success: false, error: 'Solo SuperAdmin puede usar Brenda Agent' });
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

// ─── Skills SKILL.md ─────────────────────────────────────────────────────────
// La carpeta /skills en la raíz del repo. En Vercel se incluye vía includeFiles
// en vercel.json. process.cwd() apunta a la raíz del proyecto en el runtime.
const SKILLS_DIR = path.join(process.cwd(), 'skills');

// Parser mínimo de frontmatter YAML (name + description entre marcadores ---).
function parseSkillMd(raw) {
    const match = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(raw);
    if (!match) return { name: '', description: '', body: raw.trim() };
    const front = match[1];
    const body = match[2].trim();
    const getField = (key) => {
        const re = new RegExp(`^${key}:\\s*(.*)$`, 'm');
        const m = re.exec(front);
        return m ? m[1].trim() : '';
    };
    return { name: getField('name'), description: getField('description'), body };
}

/**
 * Lee un skill por su carpeta (ej. "recruiter-oscar"). Devuelve {name, description,
 * body, folder} o null si no existe. Robusto: si el filesystem no está disponible
 * (caso raro en Vercel), devuelve null en vez de tirar la función.
 */
export function loadSkill(folder) {
    try {
        const safe = String(folder || '').replace(/[^a-z0-9-]/gi, '');
        if (!safe) return null;
        const file = path.join(SKILLS_DIR, safe, 'SKILL.md');
        if (!fs.existsSync(file)) return null;
        const parsed = parseSkillMd(fs.readFileSync(file, 'utf8'));
        return { ...parsed, folder: safe };
    } catch {
        return null;
    }
}

/**
 * Lista todos los skills disponibles con su metadata (para la UI). Clasifica por
 * prefijo de carpeta: recruiter-* (agentes), client-* (clientes), otros (base).
 */
export function listSkills() {
    try {
        if (!fs.existsSync(SKILLS_DIR)) return [];
        return fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => {
                const skill = loadSkill(d.name);
                if (!skill) return null;
                let kind = 'base';
                if (d.name.startsWith('recruiter-')) kind = 'recruiter';
                else if (d.name.startsWith('client-')) kind = 'client';
                return { folder: skill.folder, name: skill.name, description: skill.description, kind };
            })
            .filter(Boolean);
    } catch {
        return [];
    }
}

/**
 * Ensambla el system prompt del agente = skill base "brenda-recruiter-base" +
 * el skill del reclutador seleccionado (estilo). Los HECHOS del cliente NO van
 * aquí — el agente los pide vía la herramienta `consultar_vacante` (progressive
 * disclosure: solo entran al contexto cuando se necesitan).
 */
export function assembleSystemPrompt(recruiterFolder) {
    const base = loadSkill('brenda-recruiter-base');
    const recruiter = recruiterFolder ? loadSkill(recruiterFolder) : null;

    const parts = [];
    if (base) parts.push(base.body);
    else parts.push('Eres "Brenda", reclutadora de Candidatic por WhatsApp. Tono humano, cálido, directo. No prometas nada que no esté confirmado.');

    if (recruiter) {
        parts.push(`\n\n# ESTILO DEL RECLUTADOR\n${recruiter.body}`);
    }

    parts.push('\n\n# HERRAMIENTA\nCuando necesites datos concretos de la vacante (sueldo, turno, ubicación, beneficios, reglas), usa la herramienta `consultar_vacante`. No inventes datos: si la herramienta no los tiene, dilo con naturalidad y ofrece confirmarlo.');

    return parts.join('');
}
