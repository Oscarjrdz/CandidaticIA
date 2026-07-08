import React from 'react';

/**
 * Burbuja simple compartida por ChatCandidatoPanel y ChatTrainingPanel.
 * `role === 'user'` siempre es quien esta escribiendo en ese momento (a la derecha,
 * azul) — el mismo criterio que ya usa FloatingCopilot.jsx.
 */
const TrainingBubble = ({ role, children }) => (
    <div className={`flex ${role === 'user' ? 'justify-end' : 'justify-start'}`}>
        <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed border whitespace-pre-wrap ${
            role === 'user'
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 border-gray-200 dark:border-gray-700'
        }`}>
            {children}
        </div>
    </div>
);

export default TrainingBubble;
