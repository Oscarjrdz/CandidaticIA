import React from 'react';
import { Settings } from 'lucide-react';
import GPTSettings from './GPTSettings';
import UltraMsgSettings from './UltraMsgSettings';

/**
 * Sección de Settings (configuración)
 */
const SettingsSection = ({ instanceId, token, onCredentialsChange, showToast }) => {
    return (
        <div className="max-w-6xl mx-auto space-y-6">
            {/* Header: Command Bar Style */}
            <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 flex flex-col md:flex-row items-center justify-between gap-4 min-h-[82px]">
                <div className="flex items-center space-x-4">
                    <div className="w-10 h-10 rounded-2xl bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center transition-all">
                        <Settings className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white leading-tight uppercase tracking-tight">CONFIGURACIÓN</h2>
                        <div className="flex items-center gap-2 mt-0.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>
                            <p className="text-[10px] font-black tracking-widest uppercase text-blue-600 dark:text-blue-400">SISTEMA Y CREDENCIALES</p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <UltraMsgSettings showToast={showToast} />
                <GPTSettings showToast={showToast} />
            </div>
        </div>
    );
};

export default SettingsSection;
