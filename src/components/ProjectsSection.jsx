
import React, { useState, useEffect } from 'react';
import {
    FolderPlus, Search, UserPlus, Trash2, ChevronRight, Users,
    GraduationCap, MapPin, MessageSquare, ExternalLink, FolderKanban,
    Sparkles, History, User, Clock, Zap, MessageCircle, Pencil, Briefcase, Plus, Calendar
} from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import Input from './ui/Input';
import MagicSearch from './MagicSearch';
import ChatWindow from './ChatWindow';

// Drag & Drop Imports
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragOverlay
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    horizontalListSortingStrategy,
    useSortable,
    rectSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// --- Sortable Components ---

const SortableProjectItem = ({ id, project, isActive, onClick, onDelete, onEdit, users }) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: id, data: { type: 'project', project } });

    const style = {
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.3 : 1,
        zIndex: isDragging ? 50 : 1
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...attributes}
            onClick={onClick}
            className={`group p-4 rounded-2xl cursor-pointer border transition-all duration-300 ${isActive
                ? 'bg-blue-600 border-blue-500 text-white shadow-xl shadow-blue-500/20 scale-[1.02]'
                : 'bg-white border-slate-100 dark:bg-slate-800 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-lg'
                }`}
        >
            <div className="flex justify-between items-start">
                <div className="flex-1 min-w-0" {...listeners}>
                    <h3 className={`font-bold truncate ${isActive ? 'text-white' : 'text-slate-700 dark:text-slate-200'}`}>
                        {project.name}
                    </h3>
                    <p className={`text-xs mt-1 line-clamp-1 ${isActive ? 'text-blue-100' : 'text-slate-500 dark:text-slate-400'}`}>
                        {project.description || 'Sin descripción'}
                    </p>
                </div>
                <div className="flex gap-1">
                    <button
                        onClick={onEdit}
                        className={`p-1.5 rounded-lg transition-colors ${isActive
                            ? 'text-blue-100 hover:bg-white/20'
                            : 'text-slate-400 hover:text-blue-500 hover:bg-blue-50 opacity-0 group-hover:opacity-100'
                            }`}
                        title="Editar proyecto"
                    >
                        <Pencil className="w-4 h-4" />
                    </button>
                    <button
                        onClick={onDelete}
                        className={`p-1.5 rounded-lg transition-colors ${isActive
                            ? 'text-blue-100 hover:bg-white/20'
                            : 'text-slate-400 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100'
                            }`}
                        title="Eliminar proyecto"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            </div>
            <div className="mt-3 flex items-center justify-between" {...listeners}>
                <div className="flex -space-x-2">
                    {(project.assignedUsers || []).slice(0, 3).map((uId, idx) => (
                        <div key={idx} className="w-5 h-5 rounded-full border border-white bg-blue-400 dark:bg-blue-500 flex items-center justify-center text-[8px] font-bold text-white shadow-sm">
                            {users.find(u => u.id === uId)?.name?.charAt(0) || 'U'}
                        </div>
                    ))}
                </div>
                <span className={`text-[10px] font-medium ${isActive ? 'text-blue-100' : 'text-slate-400'}`}>
                    {project.createdAt ? new Date(project.createdAt).toLocaleDateString() : 'Sin fecha'}
                </span>
            </div>
        </div>
    );
};

const KanbanColumn = ({ id, step, children, count }) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: id, data: { type: 'column', step } });

    const style = {
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className="flex-shrink-0 w-80 flex flex-col h-full bg-slate-50/50 dark:bg-slate-900/30 rounded-[40px] border border-slate-200/50 dark:border-slate-800/50 overflow-hidden"
        >
            <div
                className="p-5 flex items-center justify-between border-b border-slate-100 dark:border-slate-800/50 bg-white/40 dark:bg-slate-800/20 backdrop-blur-sm"
                {...attributes}
                {...listeners}
            >
                <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]"></div>
                    <h3 className="font-black text-slate-800 dark:text-white uppercase tracking-tighter text-sm">
                        {step.name}
                    </h3>
                    <span className="px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 text-[10px] font-bold text-slate-500 dark:text-slate-400">
                        {count}
                    </span>
                </div>
                <button
                    onClick={(e) => { e.stopPropagation(); onEdit(step.id); }}
                    className="p-1.5 text-slate-300 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                >
                    <Pencil className="w-3.5 h-3.5" />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                {children}
            </div>
        </div>
    );
};

const SortableCandidateCard = ({ id, candidate, onChat, onUnlink }) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: id, data: { type: 'candidate', candidate } });

    const style = {
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.3 : 1,
        zIndex: isDragging ? 100 : 1
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...attributes}
            className="group relative bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/50 rounded-xl p-2 shadow-sm hover:shadow-xl hover:shadow-blue-500/10 transition-all duration-300 flex items-center gap-2.5"
        >
            <div className="relative flex-shrink-0" {...listeners}>
                {(candidate.profilePic || candidate.foto) ? (
                    <img
                        src={candidate.profilePic || candidate.foto}
                        className="w-8 h-8 rounded-lg object-cover shadow-sm ring-1 ring-slate-100 dark:ring-slate-700/30"
                        alt="Avatar"
                    />
                ) : (
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-slate-700 dark:to-slate-800 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-[10px] border border-blue-100/30">
                        {candidate.nombreReal?.charAt(0) || candidate.nombre?.charAt(0) || 'C'}
                    </div>
                )}
            </div>

            <div className="flex-1 min-w-0 pr-14" {...listeners}>
                <div className="flex items-center gap-2 mb-0.5">
                    <h4 className="font-extrabold text-slate-900 dark:text-white text-[11px] truncate uppercase tracking-tight">
                        {candidate.nombreReal || candidate.nombre || 'Sin nombre'}
                    </h4>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[7px] text-slate-500 font-bold uppercase tracking-widest opacity-80">
                    <div className="flex items-center gap-0.5 whitespace-nowrap">
                        <MapPin className="w-1.5 h-1.5 text-blue-500" />
                        {candidate.municipio || 'N/A'}
                    </div>
                    {candidate.edad && (
                        <div className="flex items-center gap-0.5 whitespace-nowrap">
                            <Calendar className="w-1.5 h-1.5 text-blue-500" />
                            {candidate.edad} años
                        </div>
                    )}
                    {candidate.escolaridad && (
                        <div className="flex items-center gap-0.5 whitespace-nowrap">
                            <GraduationCap className="w-1.5 h-1.5 text-blue-500" />
                            {candidate.escolaridad}
                        </div>
                    )}
                </div>
            </div>

            <div className="absolute right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                    onClick={(e) => { e.stopPropagation(); onChat(candidate); }}
                    className="w-5 h-5 flex items-center justify-center bg-[#25D366] text-white rounded-md shadow-sm hover:scale-110 transition-all"
                    title="WhatsApp"
                >
                    <MessageCircle className="w-2.5 h-2.5" />
                </button>
                <button
                    onClick={(e) => { e.stopPropagation(); onUnlink(candidate.id); }}
                    className="w-5 h-5 flex items-center justify-center bg-slate-50 dark:bg-slate-700 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-all"
                    title="Remover"
                >
                    <Trash2 className="w-2.5 h-2.5" />
                </button>
            </div>
        </div>
    );
};

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

    const [selectedCandidate, setSelectedCandidate] = useState(null);
    const [isChatOpen, setIsChatOpen] = useState(false);

    // DnD Sensors & State
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );
    const [activeId, setActiveId] = useState(null);
    const [activeItem, setActiveItem] = useState(null);

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
            if (data.success) {
                console.log('[Projects] Loaded projects:', data.projects.length);
                setProjects(data.projects);
            }
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

    // --- Drag & Drop Handlers ---

    const handleDragStart = (event) => {
        const { active } = event;
        setActiveId(active.id);
        setActiveItem(active.data.current);
    };

    const handleDragEnd = async (event) => {
        const { active, over } = event;
        setActiveId(null);
        setActiveItem(null);

        if (!over) return;

        // 1. Reorder Projects in Sidebar
        if (active.data.current.type === 'project' && over.data.current?.type === 'project') {
            if (active.id !== over.id) {
                const oldIndex = projects.findIndex(p => p.id === active.id);
                const newIndex = projects.findIndex(p => p.id === over.id);
                const newOrder = arrayMove(projects, oldIndex, newIndex);
                setProjects(newOrder);

                // Persist order
                await fetch('/api/projects', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'reorderProjects',
                        projectIds: newOrder.map(p => p.id)
                    })
                });
            }
            return;
        }

        // 2. Reorder Steps (Columns)
        if (active.data.current.type === 'column' && over.data.current?.type === 'column') {
            if (active.id !== over.id) {
                const oldIndex = activeProject.steps.findIndex(s => s.id === active.id);
                const newIndex = activeProject.steps.findIndex(s => s.id === over.id);
                const newSteps = arrayMove(activeProject.steps, oldIndex, newIndex);

                const updatedProject = { ...activeProject, steps: newSteps };
                setActiveProject(updatedProject);
                setProjects(prev => prev.map(p => p.id === activeProject.id ? updatedProject : p));

                await fetch('/api/projects', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'updateSteps',
                        projectId: activeProject.id,
                        steps: newSteps
                    })
                });
            }
            return;
        }

        // 2. Move Candidate between Steps
        if (active.data.current.type === 'candidate') {
            const candidate = active.data.current.candidate;
            const project = activeProject;

            // If dropped over a column
            if (over.data.current?.type === 'column') {
                const targetStepId = over.id;
                const currentStepId = candidate.projectMetadata?.stepId || 'step_new';
                if (currentStepId !== targetStepId) {
                    await moveCandidateToStep(candidate.id, targetStepId);
                }
            }
            // If dropped over another candidate in same or different column
            else if (over.data.current?.type === 'candidate') {
                const targetStepId = over.data.current.candidate.projectMetadata?.stepId || 'step_new';
                const currentStepId = candidate.projectMetadata?.stepId || 'step_new';
                if (currentStepId !== targetStepId) {
                    await moveCandidateToStep(candidate.id, targetStepId);
                }
            }
        }
    };

    const moveCandidateToStep = async (candidateId, stepId) => {
        // Optimistic update
        setProjectCandidates(prev => prev.map(c =>
            c.id === candidateId
                ? { ...c, projectMetadata: { ...c.projectMetadata, stepId } }
                : c
        ));

        try {
            const res = await fetch('/api/projects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'moveCandidate',
                    projectId: activeProject.id,
                    candidateId,
                    stepId
                })
            });
            if (!res.ok) showToast('Error al mover candidato', 'error');
        } catch (e) {
            showToast('Error de conexión', 'error');
            // Revert on error if needed
        }
    };

    const handleUpdateStepName = async (stepId) => {
        const step = activeProject.steps.find(s => s.id === stepId);
        if (!step) return;

        const newName = prompt('Nuevo nombre del paso:', step.name);
        if (!newName || newName === step.name) return;

        const updatedSteps = activeProject.steps.map(s =>
            s.id === stepId ? { ...s, name: newName } : s
        );

        // Update UI state immediately
        const updatedProject = { ...activeProject, steps: updatedSteps };
        setProjects(prev => prev.map(p => p.id === activeProject.id ? updatedProject : p));
        setActiveProject(updatedProject);

        try {
            const res = await fetch('/api/projects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'updateSteps',
                    projectId: activeProject.id,
                    steps: updatedSteps
                })
            });
            const data = await res.json();
            if (data.success) {
                if (showToast) showToast('Paso actualizado', 'success');
            } else {
                throw new Error(data.error);
            }
        } catch (e) {
            console.error('Error updating steps:', e);
            if (showToast) showToast('Error al guardar cambio', 'error');
        }
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
            let targetStepId = 'step_new';
            const iaSearchStep = (activeProject.steps || []).find(s => s.name.toLowerCase() === 'búsqueda ia');

            if (!iaSearchStep) {
                // Create it automatically
                const newStep = { id: `step_ia_${Date.now()}`, name: 'Búsqueda IA' };
                const updatedSteps = [...(activeProject.steps || []), newStep];

                const res = await fetch('/api/projects', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'updateSteps',
                        projectId: activeProject.id,
                        steps: updatedSteps
                    })
                });
                const data = await res.json();
                if (data.success) {
                    targetStepId = newStep.id;
                    // Update local state to avoid re-fetching the whole project if possible, 
                    // but since activeProject is used below, let's update it.
                    const updatedProj = { ...activeProject, steps: updatedSteps };
                    setActiveProject(updatedProj);
                    setProjects(projects.map(p => p.id === activeProject.id ? updatedProj : p));
                }
            } else {
                targetStepId = iaSearchStep.id;
            }

            // Sequential to avoid race conditions in metadata HASH
            for (const cand of searchPreview) {
                const res = await fetch('/api/projects', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'link',
                        projectId: activeProject.id,
                        candidateId: cand.id,
                        origin: activeQuery,
                        stepId: targetStepId
                    })
                });
                const data = await res.json();
                if (data.success) count++;
            }
            if (showToast) showToast(`${count} candidatos vinculados a Búsqueda IA`, 'success');
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
        <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
        >
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
                            Silo de Proyectos
                        </h2>
                        <p className="text-slate-500 dark:text-slate-400 text-sm">Gestiona y organiza talento en etapas estratégicas</p>
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
                            <SortableContext items={projects.map(p => p.id)} strategy={verticalListSortingStrategy}>
                                {projects.map(project => (
                                    <SortableProjectItem
                                        key={project.id}
                                        id={project.id}
                                        project={project}
                                        isActive={activeProject?.id === project.id}
                                        onClick={() => setActiveProject(project)}
                                        onDelete={(e) => handleDeleteProject(project.id, e)}
                                        onEdit={(e) => handleEditClick(project, e)}
                                        users={users}
                                    />
                                ))}
                            </SortableContext>
                        )}
                    </div>

                    {/* Main Area (Kanban tablero) */}
                    <div className="col-span-12 lg:col-span-10 flex flex-col min-h-0 bg-white/40 dark:bg-slate-800/20 rounded-[64px] border border-slate-200 dark:border-slate-800 overflow-hidden shadow-2xl shadow-blue-500/5">
                        {activeProject ? (
                            <div className="flex-1 flex flex-col min-h-0 p-8 space-y-6">
                                {/* Project bar */}
                                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white/50 dark:bg-slate-900/40 p-6 rounded-[32px] border border-slate-100 dark:border-slate-800 shadow-sm">
                                    <div className="flex items-center gap-4">
                                        <div className="p-3 bg-blue-600 rounded-2xl shadow-lg shadow-blue-500/20">
                                            <FolderKanban className="w-6 h-6 text-white" />
                                        </div>
                                        <div>
                                            <h3 className="text-xl font-black text-slate-800 dark:text-white uppercase tracking-tighter">{activeProject.name}</h3>
                                            <div className="flex items-center gap-3 mt-1">
                                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                                                    <Users className="w-3 h-3" />
                                                    {projectCandidates.length} Candidatos
                                                </span>
                                                {activeProject.vacancyId && (
                                                    <span className="px-2 py-0.5 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-[10px] font-black uppercase tracking-widest flex items-center gap-1">
                                                        <Briefcase className="w-2.5 h-2.5" />
                                                        {vacancies.find(v => v.id === activeProject.vacancyId)?.name || 'Vacante'}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <Button
                                            icon={Sparkles}
                                            onClick={() => setShowAISearch(true)}
                                            className="bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest px-6 shadow-xl shadow-blue-600/20"
                                        >
                                            IA Search
                                        </Button>
                                    </div>
                                </div>

                                {/* Kanban Board */}
                                <div className="flex-1 flex gap-6 overflow-x-auto pb-6 custom-scrollbar scrollbar-hide">
                                    <SortableContext items={(activeProject.steps || []).map(s => s.id)} strategy={horizontalListSortingStrategy}>
                                        {(activeProject.steps || []).map((step, index) => {
                                            const stepCands = projectCandidates.filter(c => {
                                                const cStepId = c.projectMetadata?.stepId || 'step_new';
                                                // First column catches its own candidates OR anyone with an invalid stepId
                                                if (index === 0) {
                                                    return cStepId === step.id || !activeProject.steps.some(s => s.id === cStepId);
                                                }
                                                return cStepId === step.id;
                                            });

                                            return (
                                                <KanbanColumn
                                                    key={step.id}
                                                    id={step.id}
                                                    step={step}
                                                    count={stepCands.length}
                                                    onEdit={handleUpdateStepName}
                                                >
                                                    <SortableContext
                                                        items={stepCands.map(c => c.id)}
                                                        strategy={verticalListSortingStrategy}
                                                    >
                                                        {stepCands.length === 0 ? (
                                                            <div className="flex flex-col items-center justify-center p-10 text-slate-300 border-2 border-dashed border-slate-100 dark:border-slate-800/50 rounded-3xl">
                                                                <UserPlus className="w-8 h-8 opacity-20 mb-2" />
                                                                <p className="text-[10px] uppercase font-bold tracking-widest opacity-40">Vacío</p>
                                                            </div>
                                                        ) : (
                                                            stepCands.map(candidate => (
                                                                <SortableCandidateCard
                                                                    key={candidate.id}
                                                                    id={candidate.id}
                                                                    candidate={candidate}
                                                                    onChat={handleOpenChat}
                                                                    onUnlink={handleUnlinkCandidate}
                                                                />
                                                            ))
                                                        )}
                                                    </SortableContext>
                                                </KanbanColumn>
                                            );
                                        })}
                                    </SortableContext>

                                    {/* Add Step Button */}
                                    <button className="flex-shrink-0 w-80 h-full rounded-[40px] border-2 border-dashed border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center gap-4 text-slate-400 hover:text-blue-500 hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-all group">
                                        <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center group-hover:scale-110 transition-transform">
                                            <Plus className="w-8 h-8" />
                                        </div>
                                        <span className="font-black uppercase tracking-tighter text-sm">Nuevo Paso</span>
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center text-slate-400 animate-pulse">
                                <div className="w-24 h-24 bg-blue-50 dark:bg-blue-900/20 rounded-full flex items-center justify-center mb-8">
                                    <FolderKanban className="w-12 h-12 text-blue-400 opacity-40" />
                                </div>
                                <h2 className="text-2xl font-black text-slate-400 dark:text-slate-600 tracking-tighter uppercase">Asistente de Silos</h2>
                                <p className="max-w-xs text-center mt-3 text-sm font-bold opacity-40 uppercase tracking-widest">Selecciona o crea un proyecto estratégico para ver el búnker de talento.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <DragOverlay>
                {activeId && activeItem ? (
                    activeItem.type === 'project' ? (
                        <div className="p-4 rounded-2xl bg-blue-600 border border-blue-500 text-white shadow-2xl opacity-90 scale-105 min-w-[200px]">
                            <h3 className="font-bold truncate">{activeItem.project.name}</h3>
                        </div>
                    ) : activeItem.type === 'candidate' ? (
                        <div className="p-3 rounded-[24px] bg-white dark:bg-slate-800 border border-blue-400 shadow-2xl opacity-90 scale-105 min-w-[200px]">
                            <h4 className="font-black text-slate-800 dark:text-white text-[11px] truncate uppercase tracking-tighter">
                                {activeItem.candidate?.nombreReal || activeItem.candidate?.nombre}
                            </h4>
                        </div>
                    ) : null
                ) : null}
            </DragOverlay>

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
        </DndContext>
    );
};

export default ProjectsSection;
