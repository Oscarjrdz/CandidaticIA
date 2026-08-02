import React from 'react';
import { Puzzle, Tag, FileText, Check } from 'lucide-react';

// ════════════════════════════════════════════════════════════════════════════
// SkillsPanel — capacidades del agente. Cada skill le da acceso a datos o
// acciones reales de Candidatic vía tool use. La primera skill es SOLO LECTURA:
// consultar etiquetas y los nombres del banco de respuestas.
// ════════════════════════════════════════════════════════════════════════════

const SKILLS = [
    {
        icon: Tag,
        color: 'text-emerald-600 dark:text-emerald-400',
        name: 'Consultar etiquetas',
        desc: 'El agente puede ver los nombres de las etiquetas de Candidatic (ej. "Anuncio Yageo"). Solo lectura.'
    },
    {
        icon: FileText,
        color: 'text-blue-600 dark:text-blue-400',
        name: 'Consultar banco de respuestas',
        desc: 'El agente puede ver los nombres de las respuestas del banco. Solo lectura.'
    }
];

const SkillsPanel = () => (
    <div className="flex flex-col bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        <div className="shrink-0 px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2 bg-amber-50/50 dark:bg-amber-900/10">
            <Puzzle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span className="text-sm font-bold text-gray-900 dark:text-white">Skills</span>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400">{SKILLS.length} activa(s)</span>
        </div>
        <div className="divide-y divide-gray-100 dark:divide-gray-700/60">
            {SKILLS.map((s) => (
                <div key={s.name} className="px-4 py-3 flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center shrink-0">
                        <s.icon className={`w-4 h-4 ${s.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                            <span className="text-[13px] font-semibold text-gray-900 dark:text-white">{s.name}</span>
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400"><Check className="w-3 h-3" /> activa</span>
                        </div>
                        <p className="text-[12px] text-gray-500 dark:text-gray-400 leading-snug mt-0.5">{s.desc}</p>
                    </div>
                </div>
            ))}
        </div>
    </div>
);

export default SkillsPanel;
