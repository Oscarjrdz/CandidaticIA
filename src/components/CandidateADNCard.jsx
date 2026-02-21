import React, { useState } from 'react';
import { User, Calendar, MapPin, GraduationCap, Briefcase, ChevronDown, ChevronUp, Sparkles, Binary } from 'lucide-react';
import { calculateAge, formatValue } from '../utils/formatters';

const CandidateADNCard = ({ candidate }) => {
    const [expanded, setExpanded] = useState(false);

    if (!candidate) return null;

    // Helper to render profile items with icons
    const ProfileItem = ({ icon: Icon, label, value, colorClass = "text-blue-500" }) => (
        <div className="flex items-center space-x-2 bg-gray-50 dark:bg-gray-700/50 p-2 rounded-lg border border-gray-100 dark:border-gray-700/50">
            <div className={`p-1.5 rounded-md bg-white dark:bg-gray-800 shadow-sm ${colorClass}`}>
                <Icon className="w-3.5 h-3.5" />
            </div>
            <div className="flex flex-col">
                <span className="text-[8px] font-black uppercase tracking-widest text-gray-400 leading-none mb-0.5">{label}</span>
                <span className="text-[11px] font-bold text-gray-900 dark:text-white truncate max-w-[120px]">
                    {formatValue(value)}
                </span>
            </div>
        </div>
    );

    return (
        <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
            {/* Header / Compact View */}
            <div
                className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-750 transition-all border-b border-transparent group"
                onClick={() => setExpanded(!expanded)}
            >
                <div className="flex items-center space-x-3">
                    <div className="relative">
                        <div className="w-10 h-10 rounded-[12px] bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg transform group-hover:scale-105 transition-transform">
                            <Binary className="w-5 h-5 text-white animate-pulse" />
                        </div>
                        <div className="absolute -bottom-1 -right-1 bg-emerald-500 w-3.5 h-3.5 rounded-full border-2 border-white dark:border-gray-800 shadow-sm"></div>
                    </div>
                    <div>
                        <div className="flex items-center space-x-1.5">
                            <h3 className="font-black text-[13px] text-gray-900 dark:text-white uppercase tracking-tight">
                                ADN del Candidato
                            </h3>
                            <Sparkles className="w-3 h-3 text-amber-400 fill-amber-400" />
                        </div>
                        <p className="text-[10px] text-gray-500 dark:text-gray-400 font-medium">
                            Resumen técnico del perfil • <span className="text-blue-500 font-bold">Resumen CV</span>
                        </p>
                    </div>
                </div>
                <div className="flex items-center space-x-2">
                    <div className="hidden sm:flex flex-col items-end mr-2">
                        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-tighter">Categoría</span>
                        <span className="text-[10px] font-black text-blue-600 dark:text-blue-400 uppercase">{candidate.categoria || 'N/A'}</span>
                    </div>
                    <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-gray-500">
                        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </div>
                </div>
            </div>

            {/* Grid Expansion (Details) */}
            {expanded && (
                <div className="p-4 bg-gray-50/30 dark:bg-gray-900/40 animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        <ProfileItem
                            icon={User}
                            label="Nombre Real"
                            value={candidate.nombreReal || candidate.nombre}
                            colorClass="text-blue-600"
                        />
                        <ProfileItem
                            icon={Calendar}
                            label="Edad"
                            value={calculateAge(candidate.fechaNacimiento, candidate.edad)}
                            colorClass="text-purple-600"
                        />
                        <ProfileItem
                            icon={MapPin}
                            label="Municipio"
                            value={candidate.municipio}
                            colorClass="text-emerald-600"
                        />
                        <ProfileItem
                            icon={GraduationCap}
                            label="Escolaridad"
                            value={candidate.escolaridad}
                            colorClass="text-amber-600"
                        />
                        <ProfileItem
                            icon={Briefcase}
                            label="¿Empleo actual?"
                            value={String(candidate.tieneEmpleo || '').toLowerCase().trim().includes('si') ? 'Trabajando' : (candidate.tieneEmpleo === 'No' ? 'Desempleado' : '-')}
                            colorClass="text-rose-600"
                        />
                        <ProfileItem
                            icon={Binary}
                            label="Género"
                            value={candidate.genero}
                            colorClass="text-indigo-600"
                        />
                    </div>

                    {/* Status Badge */}
                    <div className="mt-4 flex items-center justify-between bg-white dark:bg-gray-800 p-2.5 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm">
                        <div className="flex items-center space-x-2">
                            <div className={`w-2 h-2 rounded-full ${candidate.projectId ? 'bg-emerald-500' : 'bg-gray-300'} animate-pulse`}></div>
                            <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase">
                                {candidate.projectId ? 'Asignado a Proyecto' : 'Sin Proyecto Activo'}
                            </span>
                        </div>
                        {candidate.projectId && (
                            <span className="text-[10px] font-black text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 rounded-md border border-blue-100 dark:border-blue-800/50">
                                {candidate.projectName || 'ACTIVO'}
                            </span>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default CandidateADNCard;
