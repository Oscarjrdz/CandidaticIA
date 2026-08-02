import React from 'react';
import { Puzzle } from 'lucide-react';

// ════════════════════════════════════════════════════════════════════════════
// SkillsPanel — módulo de Skills. Placeholder por ahora: primero se define la
// base (AGENTS.md + MEMORY.md). Se construirá después.
// ════════════════════════════════════════════════════════════════════════════

const SkillsPanel = () => (
    <div className="flex flex-col bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        <div className="shrink-0 px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2 bg-amber-50/50 dark:bg-amber-900/10">
            <Puzzle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span className="text-sm font-bold text-gray-900 dark:text-white">Skills</span>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400">próximamente</span>
        </div>
        <div className="px-4 py-6 text-center">
            <p className="text-[13px] text-gray-500 dark:text-gray-400 leading-relaxed">
                Aquí vivirán las skills del agente. Por ahora vacío a propósito — primero definimos la base con AGENTS.md y MEMORY.md.
            </p>
        </div>
    </div>
);

export default SkillsPanel;
