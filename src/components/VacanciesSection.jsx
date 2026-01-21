import React from 'react';
import { Briefcase } from 'lucide-react';
import Card from './ui/Card';

/**
 * Sección de Gestión de Vacantes
 */
const VacanciesSection = ({ showToast }) => {
    return (
        <div className="space-y-6">
            <Card
                title="Gestión de Vacantes"
                icon={Briefcase}
            >
                <div className="text-center py-12">
                    <div className="mx-auto w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mb-4">
                        <Briefcase className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                    </div>
                    <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                        Próximamente: Vacantes
                    </h3>
                    <p className="text-gray-500 dark:text-gray-400 max-w-md mx-auto">
                        Aquí podrás administrar las vacantes disponibles, asignarlas a candidatos y gestionar los procesos de selección.
                    </p>
                </div>
            </Card>
        </div>
    );
};

export default VacanciesSection;
