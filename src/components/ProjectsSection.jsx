import React, { useState, useEffect, useCallback } from 'react';
import { FolderKanban, Plus, Search, Filter, Trash2, ArrowLeft, Sparkles, User, UserPlus, X, Check, Loader2, ChevronRight, MapPin, Briefcase, Calendar } from 'lucide-react';
import { getProjects, createProject, deleteProject, getProjectDetail, addCandidateToProject, addMultipleToProject, removeCandidateFromProject } from '../services/projectsService';
import { aiQuery } from '../services/candidatesService';

const ProjectsSection = ({ showToast }) => {
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedProject, setSelectedProject] = useState(null);
    const [projectCandidates, setProjectCandidates] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newProjectName, setNewProjectName] = useState('');
    const [creating, setCreating] = useState(false);

    // AI Search in Project Detail
    const [aiSearchQuery, setAiSearchQuery] = useState('');
    const [aiResults, setAiResults] = useState(null);
    const [aiLoading, setAiLoading] = useState(false);
    const [improving, setImproving] = useState(false);

    const loadProjects = useCallback(async () => {
        setLoading(true);
        const res = await getProjects();
        if (res.success) setProjects(res.projects || []);
        setLoading(false);
    }, []);

    useEffect(() => {
        loadProjects();
    }, [loadProjects]);

    const handleCreateProject = async (e) => {
        if (e) e.preventDefault();
        if (!newProjectName.trim()) return;
        setCreating(true);
        const res = await createProject(newProjectName);
        if (res.success) {
            showToast('Proyecto creado', 'success');
            setNewProjectName('');
            setShowCreateModal(false);
            loadProjects();
        } else {
            showToast(res.error || 'Error al crear', 'error');
        }
        setCreating(false);
    };

    const handleDeleteProject = async (id, e) => {
        if (e) e.stopPropagation();
        if (!window.confirm('¿Eliminar este proyecto y sus referencias?')) return;
        const res = await deleteProject(id);
        if (res.success) {
            showToast('Proyecto eliminado', 'success');
            loadProjects();
            if (selectedProject?.id === id) setSelectedProject(null);
        }
    };

    const handleSelectProject = async (project) => {
        setLoading(true);
        const res = await getProjectDetail(project.id);
        if (res.success) {
            setSelectedProject(res.project);
            setProjectCandidates(res.candidates || []);
            setAiResults(null);
            setAiSearchQuery('');
        } else {
            showToast('Error al cargar detalle', 'error');
        }
        setLoading(false);
    };

    const handleAiSearch = async (e) => {
        if (e) e.preventDefault();
        if (!aiSearchQuery.trim()) return;
        setAiLoading(true);
        try {
            const res = await aiQuery(aiSearchQuery);
            if (res.success) {
                setAiResults(res.candidates);
            } else {
                showToast(res.error || 'Error en búsqueda IA', 'error');
            }
        } catch (err) {
            showToast('Error de red', 'error');
        }
        setAiLoading(false);
    };

    const handleImprovePrompt = async () => {
        if (!aiSearchQuery.trim()) return;
        setImproving(true);
        try {
            const res = await fetch('/api/ai/improve-search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: aiSearchQuery })
            });
            const data = await res.json();
            if (data.success) {
                setAiSearchQuery(data.improvedSearch);
                showToast('Prompt optimizado ✨', 'success');
            }
        } catch (e) {
            showToast('Error al optimizar', 'error');
        }
        setImproving(false);
    };

    const handleAddCandidate = async (candidate) => {
        const res = await addCandidateToProject(selectedProject.id, candidate.id);
        if (res.success) {
            showToast('Candidato añadido', 'success');
            // Update local lists
            setProjectCandidates(prev => [...prev, candidate]);
            setAiResults(prev => prev.filter(c => c.id !== candidate.id));
        }
    };

    const handleRemoveCandidate = async (candidateId) => {
        const res = await removeCandidateFromProject(selectedProject.id, candidateId);
        if (res.success) {
            showToast('Candidato removido', 'info');
            setProjectCandidates(prev => prev.filter(c => c.id !== candidateId));
        }
    };

    const handleAddAllResults = async () => {
        if (!aiResults || aiResults.length === 0) return;
        const ids = aiResults.map(c => c.id);
        const res = await addMultipleToProject(selectedProject.id, ids);
        if (res.success) {
            showToast(`${ids.length} candidatos añadidos`, 'success');
            setProjectCandidates(prev => [...prev, ...aiResults]);
            setAiResults(null);
        }
    };

    // --- RENDER HELPERS ---

    const CandidateCard = ({ candidate, type = 'result', onAction }) => (
        <div className="bg-white dark:bg-gray-800/50 p-4 rounded-2xl border border-gray-100 dark:border-gray-700/50 shadow-sm hover:shadow-md transition-all group">
            <div className="flex items-start justify-between mb-3">
                <div className="flex items-center space-x-3">
                    <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center overflow-hidden">
                        {candidate.profilePic ? (
                            <img src={candidate.profilePic} alt="" className="w-full h-full object-cover" />
                        ) : (
                            <User className="w-6 h-6 text-blue-500" />
                        )}
                    </div>
                    <div>
                        <h4 className="font-bold text-gray-900 dark:text-white truncate max-w-[150px]">{candidate.nombre || candidate.whatsapp}</h4>
                        <p className="text-[10px] text-gray-500 font-mono">{candidate.whatsapp}</p>
                    </div>
                </div>
                <button
                    onClick={() => onAction(candidate)}
                    className={`p-2 rounded-lg transition-colors ${type === 'result'
                        ? 'bg-blue-600 text-white hover:bg-blue-700'
                        : 'bg-red-50 text-red-500 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/40'
                        }`}
                >
                    {type === 'result' ? <Plus className="w-4 h-4" /> : <X className="w-4 h-4" />}
                </button>
            </div>

            <div className="space-y-2">
                {candidate.municipio && (
                    <div className="flex items-center text-[11px] text-gray-600 dark:text-gray-400">
                        <MapPin className="w-3 h-3 mr-1.5 opacity-60" />
                        <span>{candidate.municipio}</span>
                    </div>
                )}
                {candidate.escolaridad && (
                    <div className="flex items-center text-[11px] text-gray-600 dark:text-gray-400">
                        <Briefcase className="w-3 h-3 mr-1.5 opacity-60" />
                        <span>{candidate.escolaridad}</span>
                    </div>
                )}
            </div>

            {type === 'result' && candidate.match_score && (
                <div className="mt-3 pt-3 border-t border-gray-50 dark:border-gray-700/50 flex justify-between items-center">
                    <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase">Coincidencia</span>
                    <span className="px-2 py-0.5 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-full text-[10px] font-black">
                        {candidate.match_score}%
                    </span>
                </div>
            )}
        </div>
    );

    if (loading && !selectedProject) {
        return (
            <div className="h-96 flex items-center justify-center">
                <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
            </div>
        );
    }

    // --- VISTA DETALLE ---
    if (selectedProject) {
        return (
            <div className="space-y-6 animate-in slide-in-from-right-4 duration-500">
                {/* Header Proyecto */}
                <div className="flex items-center justify-between">
                    <button
                        onClick={() => setSelectedProject(null)}
                        className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors text-gray-500"
                    >
                        <ArrowLeft className="w-6 h-6" />
                    </button>
                    <div className="flex-1 ml-4">
                        <h2 className="text-2xl font-black text-gray-900 dark:text-white uppercase tracking-tight">{selectedProject.name}</h2>
                        <div className="flex items-center text-xs text-gray-500 space-x-3 mt-1">
                            <span className="flex items-center"><Calendar className="w-3 h-3 mr-1" /> {new Date(selectedProject.createdAt).toLocaleDateString()}</span>
                            <span className="flex items-center font-bold text-blue-600"><User className="w-3 h-3 mr-1" /> {projectCandidates.length} Candidatos</span>
                        </div>
                    </div>
                    <button
                        onClick={(e) => handleDeleteProject(selectedProject.id, e)}
                        className="p-3 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-2xl transition-all"
                    >
                        <Trash2 className="w-5 h-5" />
                    </button>
                </div>

                {/* AI Search Bar */}
                <div className="bg-gradient-to-br from-blue-600 to-purple-700 p-8 rounded-[2.5rem] shadow-2xl shadow-blue-500/20 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-10 opacity-10 transform rotate-12 group-hover:rotate-45 transition-transform duration-1000">
                        <Sparkles className="w-40 h-40 text-white" />
                    </div>

                    <div className="relative z-10 space-y-4">
                        <div className="flex items-center space-x-3 text-white">
                            <Sparkles className="w-8 h-8" />
                            <h3 className="text-2xl font-black tracking-tight">Buscador Inteligente IA</h3>
                        </div>
                        <form onSubmit={handleAiSearch} className="flex space-x-4">
                            <div className="flex-1 relative">
                                <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                                <input
                                    type="text"
                                    placeholder="Ej: 'Buscamos hombres de 40 años que vivan en García...'"
                                    value={aiSearchQuery}
                                    onChange={(e) => setAiSearchQuery(e.target.value)}
                                    className="w-full pl-16 pr-24 py-4 bg-white/10 dark:bg-black/20 hover:bg-white/20 backdrop-blur-md border border-white/20 rounded-2xl text-white placeholder-white/50 outline-none focus:ring-4 focus:ring-white/10 transition-all font-bold text-lg shadow-inner"
                                />
                                <button
                                    type="button"
                                    onClick={handleImprovePrompt}
                                    disabled={improving || !aiSearchQuery.trim()}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 p-2.5 bg-white/10 hover:bg-white/20 rounded-xl transition-all text-white/80 hover:text-white disabled:opacity-30"
                                    title="Mejorar con IA"
                                >
                                    {improving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
                                </button>
                            </div>
                            <button
                                type="submit"
                                disabled={aiLoading || !aiSearchQuery.trim()}
                                className="bg-white text-blue-600 px-8 py-4 rounded-2xl font-black text-lg hover:scale-105 active:scale-95 transition-all shadow-xl disabled:opacity-50 disabled:scale-100 flex items-center space-x-3"
                            >
                                {aiLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Search className="w-6 h-6" />}
                                <span>{aiLoading ? 'ANALIZANDO...' : 'BUSCAR'}</span>
                            </button>
                        </form>
                    </div>
                </div>

                {/* Resultados / Candidatos */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Resultados IA */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between px-2">
                            <h4 className="text-sm font-black text-gray-400 uppercase tracking-widest flex items-center">
                                <Sparkles className="w-4 h-4 mr-2 text-blue-500" />
                                Resultados IA {aiResults && `(${aiResults.length})`}
                            </h4>
                            {aiResults && aiResults.length > 0 && (
                                <button
                                    onClick={handleAddAllResults}
                                    className="text-xs font-bold text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 px-3 py-1.5 rounded-full transition-colors"
                                >
                                    Agregar Todo
                                </button>
                            )}
                        </div>

                        {!aiResults && !aiLoading && (
                            <div className="h-64 flex flex-col items-center justify-center border-2 border-dashed border-gray-200 dark:border-gray-800 rounded-[2rem] opacity-40">
                                <Search className="w-10 h-10 mb-2" />
                                <p className="text-sm font-medium">Usa la IA para encontrar el match perfecto</p>
                            </div>
                        )}

                        {aiLoading && (
                            <div className="space-y-4">
                                {[1, 2, 3].map(i => (
                                    <div key={i} className="h-32 bg-gray-100 dark:bg-gray-800 rounded-2xl animate-pulse"></div>
                                ))}
                            </div>
                        )}

                        {aiResults && (
                            <div className="grid grid-cols-1 gap-4 overflow-y-auto max-h-[500px] pr-2 custom-scrollbar">
                                {aiResults.length === 0 ? (
                                    <p className="text-center py-10 text-gray-500 font-medium italic">No se encontraron candidatos para esta búsqueda.</p>
                                ) : (
                                    aiResults.map(c => (
                                        <CandidateCard key={c.id} candidate={c} type="result" onAction={handleAddCandidate} />
                                    ))
                                )}
                            </div>
                        )}
                    </div>

                    {/* Candidatos en Proyecto */}
                    <div className="space-y-4">
                        <div className="flex items-center px-2">
                            <h4 className="text-sm font-black text-gray-400 uppercase tracking-widest flex items-center">
                                <UserPlus className="w-4 h-4 mr-2 text-green-500" />
                                Candidatos en Proyecto ({projectCandidates.length})
                            </h4>
                        </div>

                        <div className="grid grid-cols-1 gap-4 overflow-y-auto max-h-[500px] pr-2 custom-scrollbar">
                            {projectCandidates.length === 0 ? (
                                <div className="h-64 flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-900/30 border border-gray-200 dark:border-gray-800 rounded-[2rem] opacity-60">
                                    <User className="w-10 h-10 mb-2" />
                                    <p className="text-sm font-medium">Aún no hay candidatos guardados</p>
                                </div>
                            ) : (
                                projectCandidates.map(c => (
                                    <CandidateCard key={c.id} candidate={c} type="selected" onAction={() => handleRemoveCandidate(c.id)} />
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // --- VISTA LISTA (DEFAULT) ---
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
                            <h3 className="text-2xl font-bold text-gray-900 dark:text-white">{projects.length}</h3>
                        </div>
                    </div>
                </div>
            </div>

            {/* Actions Bar */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-gray-800 p-4 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
                <div className="flex items-center space-x-2 flex-1 max-w-md bg-gray-50 dark:bg-gray-900/50 px-4 py-2 rounded-xl group focus-within:ring-2 ring-blue-500/20">
                    <Search className="w-5 h-5 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
                    <input
                        type="text"
                        placeholder="Buscar proyectos..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="bg-transparent border-none focus:ring-0 text-sm w-full outline-none text-gray-900 dark:text-white"
                    />
                </div>
                <button
                    onClick={() => setShowCreateModal(true)}
                    className="flex items-center space-x-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold shadow-lg shadow-blue-600/20 transition-all hover:scale-105 active:scale-95"
                >
                    <Plus className="w-4 h-4" />
                    <span>NUEVO PROYECTO</span>
                </button>
            </div>

            {/* Project List */}
            {projects.length === 0 ? (
                <div className="bg-white dark:bg-gray-800 rounded-3xl p-12 text-center border-2 border-dashed border-gray-200 dark:border-gray-700">
                    <div className="w-20 h-20 bg-blue-50 dark:bg-blue-900/20 rounded-full flex items-center justify-center mx-auto mb-6">
                        <FolderKanban className="w-10 h-10 text-blue-600 dark:text-blue-400" />
                    </div>
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">No hay proyectos aún</h3>
                    <p className="text-gray-500 dark:text-gray-400 max-w-xs mx-auto mb-8">
                        Comienza creando tu primer proyecto para organizar tus candidatos y vacantes de forma eficiente.
                    </p>
                    <button
                        onClick={() => setShowCreateModal(true)}
                        className="inline-flex items-center space-x-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold shadow-xl shadow-blue-600/20 transition-all hover:scale-105 active:scale-95"
                    >
                        <Plus className="w-5 h-5" />
                        <span>Crear Mi Primer Proyecto</span>
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {projects.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase())).map(project => (
                        <div
                            key={project.id}
                            onClick={() => handleSelectProject(project)}
                            className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer group"
                        >
                            <div className="flex justify-between items-start mb-4">
                                <div className="p-3 bg-gray-50 dark:bg-gray-900 group-hover:bg-blue-50 dark:group-hover:bg-blue-900/30 rounded-xl transition-colors">
                                    <FolderKanban className="w-6 h-6 text-gray-400 group-hover:text-blue-500" />
                                </div>
                                <button
                                    onClick={(e) => handleDeleteProject(project.id, e)}
                                    className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                            <h4 className="text-lg font-bold text-gray-900 dark:text-white mb-1 group-hover:text-blue-600 transition-colors uppercase truncate">{project.name}</h4>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4 font-medium italic">Creado el {new Date(project.createdAt).toLocaleDateString()}</p>
                            <div className="flex items-center justify-between pt-4 border-t border-gray-50 dark:border-gray-700/50">
                                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Ver Detalles</span>
                                <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-blue-500 transform group-hover:translate-x-1 transition-all" />
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Create Project Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-gray-900 w-full max-w-md rounded-3xl shadow-2xl overflow-hidden animate-spring-in">
                        <div className="p-8">
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="text-xl font-black text-gray-900 dark:text-white uppercase tracking-tight">Nuevo Proyecto</h3>
                                <button onClick={() => setShowCreateModal(false)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                            <form onSubmit={handleCreateProject} className="space-y-6">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">Nombre del Proyecto</label>
                                    <input
                                        type="text"
                                        autoFocus
                                        placeholder="Ej: Reclutamiento Monterrey Q1"
                                        value={newProjectName}
                                        onChange={(e) => setNewProjectName(e.target.value)}
                                        className="w-full px-5 py-4 bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all font-bold text-lg"
                                    />
                                </div>
                                <button
                                    type="submit"
                                    disabled={creating || !newProjectName.trim()}
                                    className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-2xl font-black text-lg shadow-xl shadow-blue-500/20 active:scale-95 transition-all disabled:opacity-50"
                                >
                                    {creating ? <Loader2 className="w-6 h-6 animate-spin mx-auto" /> : 'CREAR PROYECTO'}
                                </button>
                            </form>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ProjectsSection;
