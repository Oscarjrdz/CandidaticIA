
import React, { useState, useEffect } from 'react';
import {
    FolderPlus, Search, UserPlus, Trash2, ChevronRight, Users,
    Calendar, MapPin, MessageSquare, ExternalLink, FolderKanban,
    Sparkles, History, User, Clock, Zap, MessageCircle, Pencil, Briefcase
} from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import Input from './ui/Input';
import MagicSearch from './MagicSearch';
import ChatWindow from './ChatWindow';

const ProjectsSection = ({ showToast }) => {
    const [projects, setProjects] = useState([]);
    const [activeProject, setActiveProject] = useState(null);
    const [projectCandidates, setProjectCandidates] = useState([]);
    const [projectSearches, setProjectSearches] = useState([]);
    const [loading, setLoading] = useState(false);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newProjectName, setNewProjectName] = useState('');
    const [newProjectDesc, setNewProjectDesc] = useState('');

    // User Assignment
    const [users, setUsers] = useState([]);
    const [assignedUsers, setAssignedUsers] = useState([]);
    const [vacancies, setVacancies] = useState([]);
    const [editingProject, setEditingProject] = useState(null);
    const [selectedVacancyId, setSelectedVacancyId] = useState('');

    // AI Search integration
    const [showAISearch, setShowAISearch] = useState(false);
    const [searchPreview, setSearchPreview] = useState([]);
    const [activeQuery, setActiveQuery] = useState('');
    const [isBatchLinking, setIsBatchLinking] = useState(false);

    // Chat Integration
    const [selectedCandidate, setSelectedCandidate] = useState(null);
    const [isChatOpen, setIsChatOpen] = useState(false);

    useEffect(() => {
        fetchProjects();
        fetchUsers();
        fetchVacancies();
    }, []);

    useEffect(() => {
        if (activeProject) {
            fetchProjectCandidates(activeProject.id);
            fetchProjectSearches(activeProject.id);
            setSearchPreview([]);
            setActiveQuery('');
        }
    }, [activeProject]);

    const fetchProjects = async () => {
        try {
            const res = await fetch('/api/projects');
            const data = await res.json();
            if (data.success) setProjects(data.projects);
        } catch (e) { console.error('Error fetching projects:', e); }
    };

    const fetchUsers = async () => {
        try {
            const res = await fetch('/api/users');
            const data = await res.json();
            if (data.success) setUsers(data.users);
        } catch (e) { console.error('Error fetching users:', e); }
    };

    const fetchVacancies = async () => {
        try {
            const res = await fetch('/api/vacancies');
            const data = await res.json();
            if (data.success) setVacancies(data.data);
        } catch (e) { console.error('Error fetching vacancies:', e); }
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

    const fetchProjectSearches = async (id) => {
        try {
            const res = await fetch(`/api/projects?id=${id}&view=searches`);
            const data = await res.json();
            if (data.success) setProjectSearches(data.searches);
        } catch (e) { console.error('Error fetching searches:', e); }
    };

    const handleCreateProject = async () => {
        if (!newProjectName.trim()) return;
        try {
            const res = await fetch('/api/projects' + (editingProject ? `?id=${editingProject.id}` : ''), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: newProjectName,
                    description: newProjectDesc,
                    assignedUsers,
                    vacancyId: selectedVacancyId || null
                })
            });
            const data = await res.json();
            if (data.success) {
                if (editingProject) {
                    setProjects(projects.map(p => p.id === data.project.id ? data.project : p));
                    if (activeProject?.id === data.project.id) setActiveProject(data.project);
                    showToast('Proyecto actualizado', 'success');
                } else {
                    setProjects([data.project, ...projects]);
                    showToast('Proyecto creado', 'success');
                }
                setShowCreateModal(false);
                resetForm();
            }
        } catch (e) {
            console.error('Error saving project:', e);
            showToast('Error al guardar proyecto', 'error');
        }
    };

    const resetForm = () => {
        setNewProjectName('');
        setNewProjectDesc('');
        setAssignedUsers([]);
        setSelectedVacancyId('');
        setEditingProject(null);
    };

    const handleEditClick = (project, e) => {
        e.stopPropagation();
        setEditingProject(project);
        setNewProjectName(project.name || '');
        setNewProjectDesc(project.description || '');
        setAssignedUsers(project.assignedUsers || []);
        setSelectedVacancyId(project.vacancyId || '');
        setShowCreateModal(true);
    };

    const handleDeleteProject = async (id, e) => {
        e.stopPropagation();
        if (!confirm('¿Seguro que quieres eliminar este proyecto?')) return;
        try {
            await fetch(`/api/projects?id=${id}`, { method: 'DELETE' });
            setProjects(projects.filter(p => p.id !== id));
            if (activeProject?.id === id) setActiveProject(null);
            if (showToast) showToast('Proyecto eliminado', 'info');
        } catch (e) { console.error('Error deleting project:', e); }
    };

    const handleUnlinkCandidate = async (candId) => {
        if (!activeProject) return;
        try {
            await fetch(`/api/projects?id=${activeProject.id}&candidateId=${candId}`, { method: 'DELETE' });
            setProjectCandidates(projectCandidates.filter(c => c.id !== candId));
            if (showToast) showToast('Candidato removido del proyecto', 'info');
        } catch (e) { console.error('Error unlinking candidate:', e); }
    };

    const handleAIResults = async (candidates, aiResponse, query) => {
        setSearchPreview(candidates);
        setActiveQuery(query);
        setShowAISearch(false);

        // Track this search in the backend
        if (activeProject) {
            try {
                await fetch('/api/projects', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'saveSearch',
                        projectId: activeProject.id,
                        query: query,
                        resultsCount: candidates.length
                    })
                });
                fetchProjectSearches(activeProject.id);
            } catch (e) { console.error('Error saving search history:', e); }
        }
    };

    const handleBatchLink = async () => {
        if (!activeProject || searchPreview.length === 0) return;
        setIsBatchLinking(true);
        let count = 0;
        try {
            // Sequential to avoid race conditions in metadata HASH
            for (const cand of searchPreview) {
                const res = await fetch('/api/projects', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'link',
                        projectId: activeProject.id,
                        candidateId: cand.id,
                        origin: activeQuery
                    })
                });
                const data = await res.json();
                if (data.success) count++;
            }
            if (showToast) showToast(`${count} candidatos vinculados al proyecto`, 'success');
            setSearchPreview([]);
            setActiveQuery('');
            fetchProjectCandidates(activeProject.id);
        } catch (e) {
            console.error('Error batch linking:', e);
            if (showToast) showToast('Error al vincular candidatos', 'error');
        } finally {
            setIsBatchLinking(false);
        }
    };

    const toggleUserAssignment = (userId) => {
        setAssignedUsers(prev =>
            prev.includes(userId)
                ? prev.filter(id => id !== userId)
                : [...prev, userId]
        );
    };

    const handleOpenChat = (candidate) => {
        setSelectedCandidate(candidate);
        setIsChatOpen(true);
    };

    const calculateAge = (bornDate) => {
        if (!bornDate) return null;
        try {
            const birthDate = new Date(bornDate);
            if (isNaN(birthDate.getTime())) return null;
            const today = new Date();
            let age = today.getFullYear() - birthDate.getFullYear();
            const m = today.getMonth() - birthDate.getMonth();
            if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
                age--;
            }
            return age;
        } catch (e) { return null; }
    };

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-900/50 p-6 space-y-6">
            <MagicSearch
                isOpenProp={showAISearch}
                onClose={() => setShowAISearch(false)}
                onResults={handleAIResults}
                showToast={showToast}
                customTitle="Buscador Inteligente"
                customPlaceholder="¿A quién buscamos para este búnker?"
            />

            {selectedCandidate && (
                <ChatWindow
                    isOpen={isChatOpen}
                    onClose={() => setIsChatOpen(false)}
                    candidate={selectedCandidate}
                />
            )}

            {/* Header */}
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2 tracking-tighter">
                        <FolderKanban className="w-8 h-8 text-blue-500" />
                        Proyectos
                    </h2>
                    <p className="text-slate-500 dark:text-slate-400 text-sm">Gestiona y organiza talento en silos estratégicos</p>
                </div>
                <Button onClick={() => { resetForm(); setShowCreateModal(true); }} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white border-none shadow-lg shadow-blue-500/20">
                    <FolderPlus className="w-5 h-5" />
                    Nuevo Proyecto
                </Button>
            </div>

            <div className="grid grid-cols-12 gap-6 flex-1 max-h-[calc(100vh-180px)]">
                {/* Projects List sidebar */}
                <div className="col-span-12 lg:col-span-2 space-y-4 overflow-y-auto pr-2 custom-scrollbar">
                    {projects.length === 0 ? (
                        <div className="text-center p-8 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl bg-white dark:bg-slate-800/50">
                            <p className="text-slate-400">No hay proyectos activos</p>
                        </div>
                    ) : (
                        projects.map(project => (
                            <div
                                key={project.id}
                                onClick={() => setActiveProject(project)}
                                className={`group p-4 rounded-2xl cursor-pointer border transition-all duration-300 ${activeProject?.id === project.id
                                    ? 'bg-blue-600 border-blue-500 text-white shadow-xl shadow-blue-500/20 scale-[1.02]'
                                    : 'bg-white border-slate-100 dark:bg-slate-800 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-lg'
                                    }`}
                            >
                                <div className="flex justify-between items-start">
                                    <div className="flex-1 min-w-0">
                                        <h3 className={`font-bold truncate ${activeProject?.id === project.id ? 'text-white' : 'text-slate-700 dark:text-slate-200'}`}>
                                            {project.name}
                                        </h3>
                                        <p className={`text-xs mt-1 line-clamp-1 ${activeProject?.id === project.id ? 'text-blue-100' : 'text-slate-500 dark:text-slate-400'}`}>
                                            {project.description || 'Sin descripción'}
                                        </p>
                                    </div>
                                    <div className="flex gap-1">
                                        <button
                                            onClick={(e) => handleEditClick(project, e)}
                                            className={`p-1.5 rounded-lg transition-colors ${activeProject?.id === project.id
                                                ? 'text-blue-100 hover:bg-white/20'
                                                : 'text-slate-400 hover:text-blue-500 hover:bg-blue-50 opacity-0 group-hover:opacity-100'
                                                }`}
                                            title="Editar proyecto"
                                        >
                                            <Pencil className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={(e) => handleDeleteProject(project.id, e)}
                                            className={`p-1.5 rounded-lg transition-colors ${activeProject?.id === project.id
                                                ? 'text-blue-100 hover:bg-white/20'
                                                : 'text-slate-400 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100'
                                                }`}
                                            title="Eliminar proyecto"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                                <div className="mt-3 flex items-center justify-between">
                                    <div className="flex -space-x-2">
                                        {(project.assignedUsers || []).slice(0, 3).map((uId, idx) => (
                                            <div key={idx} className="w-5 h-5 rounded-full border border-white bg-blue-400 dark:bg-blue-500 flex items-center justify-center text-[8px] font-bold text-white shadow-sm">
                                                {users.find(u => u.id === uId)?.name?.charAt(0) || 'U'}
                                            </div>
                                        ))}
                                    </div>
                                    {project.vacancyId && (
                                        <div className={`px-2 py-0.5 rounded-lg text-[8px] font-black uppercase tracking-widest flex items-center gap-1 ${activeProject?.id === project.id ? 'bg-white/20 text-white' : 'bg-blue-50 dark:bg-blue-900/30 text-blue-600'}`}>
                                            <Briefcase className="w-2.5 h-2.5" />
                                            {vacancies.find(v => v.id === project.vacancyId)?.name || 'Vacante'}
                                        </div>
                                    )}
                                    <span className={`text-[10px] font-medium ${activeProject?.id === project.id ? 'text-blue-100' : 'text-slate-400'}`}>
                                        {new Date(project.createdAt).toLocaleDateString()}
                                    </span>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* Dashboard / Detail Area */}
                <div className="col-span-12 lg:col-span-10 h-full">
                    {activeProject ? (
                        <div className="space-y-6 h-full flex flex-col">
                            {/* Project Header */}
                            <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 border border-slate-100 dark:border-slate-700 shadow-xl shadow-slate-200/10 flex flex-col gap-4 animate-in fade-in slide-in-from-top-4">
                                <div className="flex justify-between items-center">
                                    <div className="flex items-center gap-4">
                                        <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-2xl flex items-center justify-center">
                                            <FolderKanban className="w-6 h-6 text-blue-600" />
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <h2 className="text-xl font-bold dark:text-white tracking-tighter">{activeProject.name}</h2>
                                                <span className="text-[10px] bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded-full font-black uppercase tracking-wider">Activo</span>
                                            </div>
                                            <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">{activeProject.description || 'Gestión estratégica de talento'}</p>
                                        </div>
                                    </div>
                                    <div className="flex gap-3">
                                        <Button
                                            onClick={() => setShowAISearch(true)}
                                            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white border-none shadow-lg shadow-blue-500/20"
                                        >
                                            <Sparkles className="w-4 h-4" />
                                            Búsqueda IA
                                        </Button>
                                    </div>
                                </div>

                                {/* Historical Searches Tags */}
                                {projectSearches.length > 0 && (
                                    <div className="flex items-center gap-3 pt-4 border-t border-slate-50 dark:border-slate-700/50">
                                        <History className="w-4 h-4 text-slate-400" />
                                        <div className="flex-1 flex gap-2 overflow-x-auto pb-1 custom-scrollbar scrollbar-hide">
                                            {projectSearches.map((s, idx) => (
                                                <button
                                                    key={idx}
                                                    onClick={() => setShowAISearch(true)} // Or maybe re-run search? For now just history
                                                    className="whitespace-nowrap px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 text-[10px] font-bold text-slate-500 dark:text-slate-400 hover:border-blue-500 transition-colors flex items-center gap-2"
                                                >
                                                    <span className="text-blue-500">#{s.resultsCount}</span>
                                                    {s.query}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* AI Search Review Area */}
                            {searchPreview.length > 0 && (
                                <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-800/50 p-8 rounded-[40px] animate-in slide-in-from-right-4 duration-500 shadow-xl shadow-blue-500/5">
                                    <div className="flex justify-between items-start mb-6">
                                        <div>
                                            <h3 className="text-xl font-black text-blue-900 dark:text-blue-100 tracking-tighter flex items-center gap-2 uppercase">
                                                <Sparkles className="w-6 h-6 text-blue-500" />
                                                Resultados: {activeQuery}
                                            </h3>
                                            <p className="text-sm text-blue-600 dark:text-blue-400 font-bold uppercase tracking-widest mt-1 opacity-70">
                                                {searchPreview.length} candidatos potenciales detectados
                                            </p>
                                        </div>
                                        <div className="flex gap-2">
                                            <Button
                                                onClick={() => { setSearchPreview([]); setActiveQuery(''); }}
                                                className="bg-white/80 dark:bg-slate-800/80 text-slate-500 hover:text-red-500 border-blue-100 dark:border-blue-900/50 backdrop-blur-sm rounded-2xl"
                                            >
                                                Descartar
                                            </Button>
                                            <Button
                                                loading={isBatchLinking}
                                                onClick={handleBatchLink}
                                                className="bg-blue-600 hover:bg-blue-700 text-white border-none shadow-xl shadow-blue-500/40 rounded-2xl font-black"
                                            >
                                                Vincular Todo
                                            </Button>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 max-h-[350px] overflow-y-auto pr-2 custom-scrollbar">
                                        {searchPreview.map(candidate => (
                                            <div key={candidate.id} className="bg-white dark:bg-slate-900/80 p-4 rounded-[28px] flex items-center gap-4 border border-blue-200/50 dark:border-blue-900/50 shadow-sm relative overflow-hidden group hover:border-blue-400 transition-all">
                                                <div className="w-10 h-10 rounded-2xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 font-black text-sm">
                                                    {candidate.nombreReal?.charAt(0) || 'C'}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-xs font-black text-slate-900 dark:text-white truncate uppercase tracking-tighter">{candidate.nombreReal || candidate.nombre}</p>
                                                    <p className="text-[10px] text-blue-500 font-black uppercase tracking-widest mt-0.5">{candidate.municipio || 'N/A'}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Talent Grid (High Density cards) */}
                            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar pb-10">
                                {loading ? (
                                    <div className="flex flex-col items-center justify-center p-20 space-y-4">
                                        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
                                        <p className="text-slate-400 font-medium italic animate-pulse">Consultando búnker...</p>
                                    </div>
                                ) : projectCandidates.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center p-24 text-slate-400 bg-white/50 dark:bg-slate-800/20 rounded-[48px] border-2 border-dashed border-slate-200 dark:border-slate-800 animate-in zoom-in-95">
                                        <div className="w-20 h-20 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mb-6">
                                            <Search className="w-10 h-10 opacity-20" />
                                        </div>
                                        <h3 className="text-lg font-black text-slate-400 dark:text-slate-600 uppercase tracking-tighter">Búnker sin Candidatos</h3>
                                        <p className="text-sm max-w-[280px] text-center mb-8 font-medium opacity-60">Inicia una Búsqueda Inteligente para traer el mejor talento a este proyecto.</p>
                                        <Button onClick={() => setShowAISearch(true)} className="bg-blue-600 text-white border-none rounded-2xl font-black px-8">Empezar Búsqueda IA</Button>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3">
                                        {projectCandidates.map(candidate => (
                                            <div key={candidate.id} className="group relative bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/50 rounded-[20px] p-2.5 hover:shadow-2xl hover:shadow-blue-500/10 transition-all duration-300 hover:-translate-y-0.5 overflow-hidden flex flex-col justify-between min-h-[110px]">
                                                <div className="flex items-center gap-2.5">
                                                    {(candidate.profilePic || candidate.foto) ? (
                                                        <img
                                                            src={candidate.profilePic || candidate.foto}
                                                            className="w-10 h-10 rounded-[12px] object-cover shadow-sm group-hover:scale-105 transition-transform ring-2 ring-slate-100 dark:ring-slate-700/50"
                                                            alt="Avatar"
                                                        />
                                                    ) : (
                                                        <div className="w-10 h-10 rounded-[12px] bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-slate-700 dark:to-slate-800 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-sm shadow-inner group-hover:scale-110 transition-transform border border-blue-100/50 dark:border-slate-600/50">
                                                            {candidate.nombreReal?.charAt(0) || candidate.nombre?.charAt(0) || 'C'}
                                                        </div>
                                                    )}
                                                    <div className="flex-1 min-w-0">
                                                        <h4 className="font-black text-slate-800 dark:text-white text-[11px] truncate uppercase tracking-tighter leading-none mb-1">
                                                            {candidate.nombreReal || candidate.nombre || 'Sin nombre'}
                                                        </h4>
                                                        <div className="flex items-center gap-1.5 overflow-hidden">
                                                            <div className="flex items-center gap-1 text-[8px] text-slate-500 font-bold uppercase tracking-widest opacity-70 truncate">
                                                                <MapPin className="w-2.5 h-2.5 text-blue-500/70" />
                                                                {candidate.municipio || 'N/A'}
                                                            </div>
                                                            {(candidate.edad || candidate.fechaNacimiento) && (
                                                                <div className="flex items-center gap-1 text-[8px] text-slate-400 font-bold uppercase tracking-widest opacity-60 flex-shrink-0">
                                                                    <div className="w-1 h-1 rounded-full bg-slate-300"></div>
                                                                    {candidate.edad ? `${candidate.edad} años` : (calculateAge(candidate.fechaNacimiento) ? `${calculateAge(candidate.fechaNacimiento)} años` : 'N/A')}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="mt-auto pt-2 border-t border-slate-50 dark:border-slate-700/30 flex justify-between items-center h-9">
                                                    <div className="flex items-center gap-2 flex-1 min-w-0">
                                                        <button
                                                            onClick={() => handleOpenChat(candidate)}
                                                            className="flex-shrink-0 w-8 h-8 flex items-center justify-center bg-[#25D366] hover:bg-[#128C7E] text-white rounded-[10px] transition-all shadow-[0_4px_10px_rgba(37,211,102,0.2)] hover:scale-105 active:scale-95"
                                                        >
                                                            <MessageCircle className="w-3.5 h-3.5" />
                                                        </button>

                                                        {candidate.projectMetadata?.origin && (
                                                            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-50/50 dark:bg-slate-900/40 border border-slate-200/50 dark:border-slate-700/50 flex-1 min-w-0 overflow-hidden">
                                                                <Zap className="w-2.5 h-2.5 text-yellow-500 flex-shrink-0 animate-pulse" />
                                                                <span className="text-[7.5px] font-black text-slate-400 uppercase tracking-tighter truncate italic leading-none">
                                                                    {candidate.projectMetadata.origin}
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>

                                                    <button
                                                        onClick={() => handleUnlinkCandidate(candidate.id)}
                                                        className="ml-2 w-8 h-8 flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/10 rounded-[10px] transition-all"
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-slate-400 bg-white/40 dark:bg-slate-800/20 rounded-[64px] border-2 border-dashed border-slate-200 dark:border-slate-800 animate-pulse">
                            <div className="w-24 h-24 bg-blue-50 dark:bg-blue-900/20 rounded-full flex items-center justify-center mb-8">
                                <FolderKanban className="w-12 h-12 text-blue-400 opacity-40" />
                            </div>
                            <h2 className="text-2xl font-black text-slate-400 dark:text-slate-600 tracking-tighter uppercase">Silo de Proyectos</h2>
                            <p className="max-w-xs text-center mt-3 text-sm font-bold opacity-40 uppercase tracking-widest">Selecciona o crea un proyecto estratégico.</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Create Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-md p-4 animate-in fade-in duration-300">
                    <Card className="max-w-md w-full p-10 space-y-8 shadow-[0_30px_70px_rgba(0,0,0,0.4)] border-none rounded-[50px] dark:bg-slate-900 overflow-hidden relative">
                        <div className="absolute -top-20 -right-20 w-40 h-40 bg-blue-500/10 rounded-full blur-3xl"></div>

                        <div>
                            <h2 className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter uppercase">{editingProject ? 'Editar Proyecto' : 'Nuevo Proyecto'}</h2>
                            <p className="text-slate-500 dark:text-slate-400 font-bold mt-1 uppercase text-[10px] tracking-[0.2em] opacity-80 pl-1">Organización y Seguimiento</p>
                        </div>

                        <div className="space-y-6 relative">
                            <div>
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1 mb-2 block">Nombre del Silo</label>
                                <Input
                                    placeholder="EJ: ALMACÉN - NORTE"
                                    value={newProjectName}
                                    onChange={(e) => setNewProjectName(e.target.value)}
                                    className="dark:bg-slate-800 h-16 text-xl font-black rounded-3xl border-slate-200 focus:ring-blue-500 tracking-tighter uppercase"
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1 mb-2 block">Objetivo</label>
                                <textarea
                                    className="w-full p-5 rounded-3xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none min-h-[100px] transition-all uppercase placeholder:normal-case"
                                    placeholder="Brief del proyecto..."
                                    value={newProjectDesc}
                                    onChange={(e) => setNewProjectDesc(e.target.value)}
                                />
                            </div>

                            {/* Vacancy Linking */}
                            <div>
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1 mb-2 block">Vincular Vacante (Opcional)</label>
                                <div className="relative">
                                    <Briefcase className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                    <select
                                        className="w-full pl-12 pr-4 h-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-bold rounded-3xl focus:ring-2 focus:ring-blue-500 outline-none appearance-none uppercase text-slate-700 dark:text-white"
                                        value={selectedVacancyId}
                                        onChange={(e) => setSelectedVacancyId(e.target.value)}
                                    >
                                        <option value="">-- Sin Vincular --</option>
                                        {vacancies.map(v => (
                                            <option key={v.id} value={v.id}>{v.name} ({v.company})</option>
                                        ))}
                                    </select>
                                    <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                                        <ChevronRight className="w-5 h-5 rotate-90" />
                                    </div>
                                </div>
                            </div>

                            {/* User Assignment */}
                            <div>
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1 mb-3 block">Asignar Equipo</label>
                                <div className="flex flex-wrap gap-2 max-h-[120px] overflow-y-auto p-1 custom-scrollbar">
                                    {users.map(u => (
                                        <button
                                            key={u.id}
                                            onClick={() => toggleUserAssignment(u.id)}
                                            className={`px-4 py-2 rounded-2xl text-[9px] font-black uppercase tracking-widest transition-all border ${assignedUsers.includes(u.id)
                                                ? 'bg-blue-600 border-blue-500 text-white shadow-xl shadow-blue-500/20'
                                                : 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700 text-slate-400 hover:border-blue-300'
                                                }`}
                                        >
                                            {u.name}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-4 pt-4 relative">
                            <button className="flex-1 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:text-white font-black uppercase tracking-widest text-[10px]" onClick={() => setShowCreateModal(false)}>Volver</button>
                            <Button
                                className="flex-1 h-14 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-black shadow-xl shadow-blue-600/30 transform active:scale-95 transition-all text-sm uppercase tracking-tighter"
                                onClick={handleCreateProject}
                            >
                                {editingProject ? 'Guardar Cambios' : 'Iniciar Proyecto'}
                            </Button>
                        </div>
                    </Card>
                </div>
            )}
        </div>
    );
};

export default ProjectsSection;
