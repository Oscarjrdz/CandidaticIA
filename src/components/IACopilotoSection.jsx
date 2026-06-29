import React from 'react';
import { Bot, Lightbulb, ShieldCheck, Sparkles } from 'lucide-react';

const IACopilotoSection = () => {
    return (
        <div className="w-full max-w-6xl mx-auto space-y-6">
            <section className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-6 py-5">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                                <Sparkles className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                            </div>
                            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Brenda IA</h2>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-300 max-w-2xl">
                            Espacio reservado para prompts, skills y configuraciones internas.
                            La conversacion vive en el chat flotante para que puedas pedir ayuda desde cualquier modulo.
                        </p>
                    </div>
                    <span className="hidden sm:inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800">
                        Solo SuperAdmin
                    </span>
                </div>
            </section>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-5">
                    <Bot className="w-5 h-5 text-blue-600 dark:text-blue-400 mb-3" />
                    <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Chat global</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                        Brenda IA responde desde cualquier pantalla de Candidatic.
                    </p>
                </div>
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-5">
                    <Lightbulb className="w-5 h-5 text-amber-500 mb-3" />
                    <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Prompts y skills</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                        Aqui podremos guardar instrucciones, playbooks y habilidades para siguientes fases.
                    </p>
                </div>
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-5">
                    <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400 mb-3" />
                    <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Costo controlado</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                        Historial corto, entrada limitada y respuestas compactas para cuidar tokens y ancho de banda.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default IACopilotoSection;
