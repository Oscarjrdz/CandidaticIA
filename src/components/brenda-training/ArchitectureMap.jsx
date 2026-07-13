import React from 'react';
import { MessageCircle, UserRound, Building2, X, Plus } from 'lucide-react';

// ════════════════════════════════════════════════════════════════════════════
// ArchitectureMap — el diagrama VISUAL del modelo Skills Candidatic.
// Hace tangible la arquitectura de 3 capas que definió Oscar:
//
//     Brenda (canal WhatsApp, ya existe)   ← verde
//              conduce a ↓
//     Agentes (reclutadores: estilo)       ← azul     }  se
//              ×                                        }  componen
//     Skills (clientes: hechos cerrados)   ← ámbar    }  en vivo
//
// No guarda nada: es puramente explicativo + refleja lo que ya hay creado.
// Recibe los agentes y skills reales para que el mapa "respire" con los datos.
// ════════════════════════════════════════════════════════════════════════════

// Chip reutilizable para representar un agente o una skill en el mapa.
const NodeChip = ({ icon, label, sub, color }) => (
    <div
        className="flex items-center gap-2 rounded-xl border px-3 py-2 bg-white dark:bg-gray-800 shadow-sm min-w-[120px]"
        style={{ borderColor: `${color}55` }}
    >
        <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${color}1a` }}>
            {React.createElement(icon, { className: 'w-4 h-4', style: { color } })}
        </div>
        <div className="min-w-0">
            <div className="text-xs font-semibold text-gray-800 dark:text-gray-100 truncate">{label}</div>
            {sub && <div className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{sub}</div>}
        </div>
    </div>
);

const EmptyChip = ({ label }) => (
    <div className="flex items-center gap-1.5 rounded-xl border border-dashed border-gray-300 dark:border-gray-600 px-3 py-2 text-gray-400 dark:text-gray-500 text-xs">
        <Plus className="w-3.5 h-3.5" /> {label}
    </div>
);

const AGENT_COLOR = '#2563eb';   // azul
const SKILL_COLOR = '#d97706';   // ámbar
const BRENDA_COLOR = '#16a34a';  // verde (WhatsApp)

const ArchitectureMap = ({ agents = [], skills = [] }) => {
    return (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
            <div className="mb-4">
                <h3 className="text-sm font-bold text-gray-900 dark:text-white">La casa: Skills Candidatic</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    Una conversación viva = <strong>Brenda</strong> (canal) + un <strong>Agente</strong> (estilo del reclutador) + una <strong>Skill</strong> (hechos del cliente).
                </p>
            </div>

            {/* ── Capa 1: Brenda = el canal de WhatsApp/Meta (ya existe) ── */}
            <div className="flex flex-col items-center">
                <div
                    className="flex items-center gap-3 rounded-2xl border-2 px-5 py-3 shadow-sm"
                    style={{ borderColor: `${BRENDA_COLOR}66`, backgroundColor: `${BRENDA_COLOR}0f` }}
                >
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${BRENDA_COLOR}22` }}>
                        <MessageCircle className="w-5 h-5" style={{ color: BRENDA_COLOR }} />
                    </div>
                    <div>
                        <div className="text-sm font-bold text-gray-900 dark:text-white">Brenda</div>
                        <div className="text-[11px] text-gray-500 dark:text-gray-400">Cuenta de WhatsApp / Meta · el candidato siempre la ve · ya existe</div>
                    </div>
                </div>

                {/* conector */}
                <div className="w-px h-6" style={{ backgroundColor: `${BRENDA_COLOR}66` }} />
                <div className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">por su canal sale…</div>
            </div>

            {/* ── Capa 2 × Capa 3: Agentes (estilo) × Skills (hechos) ── */}
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 items-stretch">
                {/* Agentes */}
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
                    <div className="flex items-center gap-2 mb-2">
                        <UserRound className="w-4 h-4" style={{ color: AGENT_COLOR }} />
                        <span className="text-xs font-bold" style={{ color: AGENT_COLOR }}>Agentes · reclutadores (estilo)</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {agents.length === 0
                            ? <EmptyChip label="Crea tu primer agente (ej. Oscar Agent)" />
                            : agents.map(a => <NodeChip key={a.id} icon={UserRound} label={a.name} sub={a.recruiterName} color={a.color || AGENT_COLOR} />)}
                    </div>
                </div>

                {/* símbolo de composición */}
                <div className="flex items-center justify-center">
                    <div className="w-9 h-9 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                        <X className="w-5 h-5 text-gray-400 dark:text-gray-300" />
                    </div>
                </div>

                {/* Skills */}
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
                    <div className="flex items-center gap-2 mb-2">
                        <Building2 className="w-4 h-4" style={{ color: SKILL_COLOR }} />
                        <span className="text-xs font-bold" style={{ color: SKILL_COLOR }}>Skills · clientes (hechos cerrados)</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {skills.length === 0
                            ? <EmptyChip label="Crea tu primera skill (ej. Skill Katcon)" />
                            : skills.map(s => <NodeChip key={s.id} icon={Building2} label={s.name} sub={s.clientName} color={s.color || SKILL_COLOR} />)}
                    </div>
                </div>
            </div>

            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-4 leading-relaxed">
                Escala en dos ejes: entra <strong>Paty Agent</strong> (otro reclutador) y se compone con cualquier cliente; entra <strong>Skill Metalsa</strong> (otro cliente) y funciona con cualquier agente. El matching es de rendimiento — quién convierte mejor en qué vacante.
            </p>
        </div>
    );
};

export default ArchitectureMap;
