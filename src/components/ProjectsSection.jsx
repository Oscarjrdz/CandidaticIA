
import React, { useState, useEffect } from 'react';
import { FolderPlus, Search, UserPlus, Trash2, ChevronRight, Users, Calendar, MapPin, MessageSquare, ExternalLink } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import Input from './ui/Input';
import Toast from './ui/Toast';

const ProjectsSection = () => {
    const [projects, setProjects] = useState([]);
    const [activeProject, setActiveProject] = useState(null);
    const [projectCandidates, setProjectCandidates] = useState([]);
    const [loading, setLoading] = useState(false);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newProjectName, setNewProjectName] = useState('');
    const [newProjectDesc, setNewProjectDesc] = useState('');

    useEffect(() => {
        fetchProjects();
    }, []);

    useEffect(() => {
        if (activeProject) {
            fetchProjectCandidates(activeProject.id);
        }
    }, [activeProject]);

    const fetchProjects = async () => {
        try {
            const res = await fetch('/api/projects');
            const data = await res.json();
            if (data.success) setProjects(data.projects);
        } catch (e) { console.error('Error fetching projects:', e); }
    };

    const fetchProjectCandidates = async (id) => {
        setLoading(true);
        try {
            const res = await fetch(`/api/projects?id=${id}&view=candidates`);
            const data = await res.json();
            if (data.success) setProjectCandidates(data.candidates);
        } catch (e) { console.error('Error fetching candidates:', e); }
        finally { setLoading(false); }
    };

    const handleCreateProject = async () => {
        if (!newProjectName.trim()) return;
        try {
            const res = await fetch('/api/projects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newProjectName, description: newProjectDesc })
            });
            const data = await res.json();
            if (data.success) {
                setProjects([data.project, ...projects]);
                setShowCreateModal(false);
                setNewProjectName('');
                setNewProjectDesc('');
            }
        } catch (e) { console.error('Error creating project:', e); }
    };

    const handleDeleteProject = async (id, e) => {
        e.stopPropagation();
        if (!confirm('¿Seguro que quieres eliminar este proyecto?')) return;
        try {
            await fetch(`/api/projects?id=${id}`, { method: 'DELETE' });
            setProjects(projects.filter(p => p.id !== id));
            if (activeProject?.id === id) setActiveProject(null);
        } catch (e) { console.error('Error deleting project:', e); }
    };

    const handleUnlinkCandidate = async (candId) => {
        if (!activeProject) return;
        try {
            await fetch(`/api/projects?id=${activeProject.id}&candidateId=${candId}`, { method: 'DELETE' });
            setProjectCandidates(projectCandidates.filter(c => c.id !== candId));
        } catch (e) { console.error('Error unlinking candidate:', e); }
    };

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-900/50 p-6 space-y-6">
            {/* Header */}
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
                        <Users className="w-8 h-8 text-blue-500" />
                        Módulo de Proyectos
                    </h1>
                    <p className="text-slate-500 dark:text-slate-400">Gestiona búsquedas y candidatos por proyecto</p>
                </div>
                <Button onClick={() => setShowCreateModal(true)} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white border-none shadow-lg shadow-blue-500/20">
                    <FolderPlus className="w-5 h-5" />
                    Nuevo Proyecto
                </Button>
            </div>

            <div className="grid grid-cols-12 gap-6 flex-1">
                {/* Projects List sidebar */}
                <div className="col-span-12 lg:col-span-4 xl:col-span-3 space-y-4 overflow-y-auto max-h-[calc(100vh-250px)] pr-2 custom-scrollbar">
                    {projects.length === 0 ? (
                        <div className="text-center p-8 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                            <p className="text-slate-400">No hay proyectos activos</p>
                        </div>
                    ) : (
                        projects.map(project => (
                            <div
                                key={project.id}
                                onClick={() => setActiveProject(project)}
                                className={`group p-4 rounded-2xl cursor-pointer border transition-all duration-300 ${activeProject?.id === project.id
                                        ? 'bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800 shadow-md'
                                        : 'bg-white border-slate-200 dark:bg-slate-800 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-lg'
                                    }`}
                            >
                                <div className="flex justify-between items-start">
                                    <div className="flex-1">
                                        <h3 className={`font-semibold ${activeProject?.id === project.id ? 'text-blue-700 dark:text-blue-400' : 'text-slate-700 dark:text-slate-200'}`}>
                                            {project.name}
                                        </h3>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 mt-1">
                                            {project.description || 'Sin descripción'}
                                        </p>
                                    </div>
                                    <button onClick={(e) => handleDeleteProject(project.id, e)} className="p-2 text-slate-400 hover:text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors opacity-0 group-hover:opacity-100">
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                                <div className="flex items-center gap-3 mt-4 text-[10px] text-slate-400 font-medium tracking-wider uppercase">
                                    <span className="flex items-center gap-1">
                                        <Calendar className="w-3 h-3" />
                                        {new Date(project.createdAt).toLocaleDateString()}
                                    </span>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* Dashboard / Detail Area */}
                <div className="col-span-12 lg:col-span-8 xl:col-span-9">
                    {activeProject ? (
                        <div className="space-y-6 h-full flex flex-col">
                            {/* Project Header Stats */}
                            <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 border border-slate-200 dark:border-slate-700 shadow-xl shadow-slate-200/20 flex justify-between items-center">
                                <div>
                                    <h2 className="text-xl font-bold dark:text-white">{activeProject.name}</h2>
                                    <div className="flex items-center gap-4 mt-2">
                                        <span className="text-sm bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-3 py-1 rounded-full font-semibold">
                                            {projectCandidates.length} Candidatos
                                        </span>
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <Button className="flex items-center gap-2 bg-indigo-600 text-white border-none shadow-lg shadow-indigo-500/20">
                                        <Search className="w-4 h-4" />
                                        Búsqueda IA
                                    </Button>
                                    <Button className="flex items-center gap-2 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700">
                                        <UserPlus className="w-4 h-4 text-blue-500" />
                                        Agregar Manual
                                    </Button>
                                </div>
                            </div>

                            {/* Talent Grid (High Density cards) */}
                            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                                {loading ? (
                                    <div className="flex justify-center p-12">
                                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                                    </div>
                                ) : projectCandidates.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center p-20 text-slate-400 bg-white/50 dark:bg-slate-800/20 rounded-3xl border-2 border-dashed border-slate-200 dark:border-slate-700">
                                        <Search className="w-12 h-12 mb-4 opacity-20" />
                                        <p>No hay candidatos vinculados aún.</p>
                                        <p className="text-sm">Inicia una búsqueda inteligente para llenar el búnker.</p>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4 pb-12">
                                        {projectCandidates.map(candidate => (
                                            <div key={candidate.id} className="group relative bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl p-4 hover:shadow-2xl hover:shadow-blue-500/10 transition-all duration-300 hover:-translate-y-1">
                                                <div className="flex items-start gap-3">
                                                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-sm shadow-inner">
                                                        {candidate.nombreReal?.charAt(0) || candidate.nombre?.charAt(0) || 'C'}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <h4 className="font-bold text-slate-800 dark:text-white text-sm truncate uppercase tracking-tight">
                                                            {candidate.nombreReal || candidate.nombre || 'Sin nombre'}
                                                        </h4>
                                                        <div className="flex items-center gap-1 text-[10px] text-slate-500 font-medium">
                                                            <MapPin className="w-3 h-3 text-blue-400" />
                                                            {candidate.municipio || 'N/A'}
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="mt-3 flex flex-wrap gap-1">
                                                    <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700 text-[10px] font-bold text-slate-600 dark:text-slate-300">
                                                        {candidate.categoria || 'General'}
                                                    </span>
                                                    {candidate.escolaridad && (
                                                        <span className="px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-900/30 text-[10px] font-bold text-blue-600 dark:text-blue-400">
                                                            {candidate.escolaridad}
                                                        </span>
                                                    )}
                                                </div>

                                                <div className="mt-4 pt-3 border-t border-slate-50 dark:border-slate-700/50 flex justify-between items-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <div className="flex gap-1">
                                                        <button className="p-1.5 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg text-blue-500 transition-colors">
                                                            <MessageSquare className="w-4 h-4" />
                                                        </button>
                                                        <button className="p-1.5 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg text-slate-400 transition-colors">
                                                            <ExternalLink className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                    <button onClick={() => handleUnlinkCandidate(candidate.id)} className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg text-red-400 transition-colors">
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-slate-400 bg-white/50 dark:bg-slate-800/20 rounded-[40px] border-2 border-dashed border-slate-200 dark:border-slate-800">
                            <FolderPlus className="w-20 h-20 mb-6 opacity-10 animate-pulse" />
                            <h2 className="text-xl font-semibold opacity-30">Selecciona o crea un proyecto</h2>
                            <p className="max-w-xs text-center mt-2 text-sm opacity-20">Analiza tus candidatos desde un búnker estratégico con la potencia de la IA.</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Create Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
                    <Card className="max-w-md w-full p-8 space-y-6 shadow-2xl border-none">
                        <div>
                            <h3 className="text-xl font-bold dark:text-white">Nuevo Proyecto Estratégico</h3>
                            <p className="text-sm text-slate-500">Define el nombre de tu búsqueda inteligente</p>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1 mb-1 block">Nombre</label>
                                <Input
                                    placeholder="Ej: Reclutamiento Masivo Monterrey"
                                    value={newProjectName}
                                    onChange={(e) => setNewProjectName(e.target.value)}
                                    className="dark:bg-slate-800"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1 mb-1 block">Descripción (Opcional)</label>
                                <textarea
                                    className="w-full p-3 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm focus:ring-2 focus:ring-blue-500 outline-none min-h-[100px]"
                                    placeholder="Candidatos perfil ayudante para planta Escobedo..."
                                    value={newProjectDesc}
                                    onChange={(e) => setNewProjectDesc(e.target.value)}
                                />
                            </div>
                        </div>
                        <div className="flex gap-3 mt-8">
                            <Button className="flex-1 py-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 border-none dark:text-white" onClick={() => setShowCreateModal(false)}>Cancelar</Button>
                            <Button
                                className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white border-none shadow-lg shadow-blue-500/30"
                                onClick={handleCreateProject}
                            >
                                Crear Proyecto
                            </Button>
                        </div>
                    </Card>
                </div>
            )}
        </div>
    );
};

export default ProjectsSection;
