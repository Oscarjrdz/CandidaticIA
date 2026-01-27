import React from 'react';
import { FolderKanban, Plus, Search, Filter } from 'lucide-react';

const ProjectsSection = () => {
    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* Header / Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
                    <div className="flex items-center space-x-4">
                        <div className="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-xl">
                            <FolderKanban className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div>
                            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Proyectos</p>
                            <h3 className="text-2xl font-bold text-gray-900 dark:text-white">0</h3>
                        </div>
                    </div>
                </div>
            </div>

            {/* Actions Bar */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-gray-800 p-4 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
                <div className="flex items-center space-x-2 flex-1 max-w-md">
                    <Search className="w-5 h-5 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Buscar proyectos..."
                        className="bg-transparent border-none focus:ring-0 text-sm w-full"
                    />
                </div>
                <div className="flex items-center space-x-3">
                    <button className="flex items-center space-x-2 px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-gray-900 dark:text-white">
                        <Filter className="w-4 h-4" />
                        <span>Filtros</span>
                    </button>
                    <button className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium shadow-lg shadow-blue-600/20 transition-all hover:scale-105 active:scale-95">
                        <Plus className="w-4 h-4" />
                        <span>Nuevo Proyecto</span>
                    </button>
                </div>
            </div>

            {/* Empty State */}
            <div className="bg-white dark:bg-gray-800 rounded-3xl p-12 text-center border-2 border-dashed border-gray-200 dark:border-gray-700">
                <div className="w-20 h-20 bg-blue-50 dark:bg-blue-900/20 rounded-full flex items-center justify-center mx-auto mb-6">
                    <FolderKanban className="w-10 h-10 text-blue-600 dark:text-blue-400" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">No hay proyectos aún</h3>
                <p className="text-gray-500 dark:text-gray-400 max-w-xs mx-auto mb-8">
                    Comienza creando tu primer proyecto para organizar tus candidatos y vacantes de forma eficiente.
                </p>
                <button className="inline-flex items-center space-x-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold shadow-xl shadow-blue-600/20 transition-all hover:scale-105 active:scale-95">
                    <Plus className="w-5 h-5" />
                    <span>Crear Mi Primer Proyecto</span>
                </button>
            </div>
        </div>
    );
};

export default ProjectsSection;
