
import React, { useState, useEffect } from 'react';
import {
    FolderPlus, Search, UserPlus, Trash2, ChevronRight, Users,
    GraduationCap, MapPin, MessageSquare, ExternalLink, FolderKanban,
    Sparkles, History, User, Clock, Zap, MessageCircle, Pencil, Briefcase, Plus, Calendar,
    Bot, Settings, Power, X, Loader2, Rocket // Added Rocket icon
} from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import Input from './ui/Input';
import MagicSearch from './MagicSearch';
import ChatWindow from './ChatWindow';
import { calculateAge } from '../utils/formatters';

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

const KanbanColumn = ({ id, step, children, count, onEdit, onLaunch }) => {
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
                className="p-3 flex items-center justify-between border-b border-slate-100 dark:border-slate-800/50 bg-white/40 dark:bg-slate-800/20 backdrop-blur-sm"
            >
                <div className="flex items-center gap-3" {...attributes} {...listeners}>
                    <div className={`w-2 h-2 rounded-full shadow-[0_0_10px_rgba(59,130,246,0.5)] ${step.aiConfig?.enabled ? 'bg-green-500 animate-pulse' : 'bg-blue-500'}`}></div>
                    <h3 className="font-black text-slate-800 dark:text-white uppercase tracking-tighter text-sm truncate max-w-[150px] cursor-grab active:cursor-grabbing">
                        {step.name}
                    </h3>
                    <span className="px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 text-[10px] font-bold text-slate-500 dark:text-slate-400">
                        {count}
                    </span>
                </div>


                <div className="flex items-center gap-1">
                    {/* AI Config Trigger */}
                    <button
                        onClick={(e) => {
                            e.preventDefault(); e.stopPropagation();
                            onEdit(step.id, 'ai');
                        }}
                        className={`p-1.5 rounded-lg transition-colors relative z-10 ${step.aiConfig?.enabled
                            ? 'text-purple-500 bg-purple-50 dark:bg-purple-900/20'
                            : 'text-slate-300 hover:text-purple-500 hover:bg-purple-50'}`}
                        title="Configurar IA"
                    >
                        <Bot className="w-3.5 h-3.5" />
                    </button>

                    {/* Quick Toggle */}
                    <button
                        onClick={(e) => {
                            e.preventDefault(); e.stopPropagation();
                            onEdit(step.id, 'toggle');
                        }}
                        className={`p-1.5 rounded-lg transition-colors relative z-10 ${step.aiConfig?.enabled
                            ? 'text-green-500 bg-green-50 dark:bg-green-900/20'
                            : 'text-slate-300 hover:text-green-500'}`}
                        title={step.aiConfig?.enabled ? 'Desactivar Auto' : 'Activar Auto'}
                    >
                        <Power className="w-3.5 h-3.5" />
                    </button>

                    {/* Launch Step (Manual) */}
                    <button
                        onClick={(e) => {
                            e.preventDefault(); e.stopPropagation();
                            onLaunch(step.id);
                        }}
                        className="p-1.5 rounded-lg transition-all text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-900/20 active:scale-90 relative z-10"
                        title="Lanzar Brenda en este paso"
                    >
                        <Rocket className="w-3.5 h-3.5" />
                    </button>

                    {/* End Quick Toggle */}
                    <button
                        onClick={(e) => {
                            e.preventDefault(); e.stopPropagation();
                            onEdit(step.id, 'name');
                        }}
                        className="p-1.5 text-slate-300 hover:text-slate-600 dark:hover:text-slate-200 transition-colors relative z-10"
                        title="Editar nombre"
                    >
                        <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                        onClick={(e) => {
                            e.preventDefault(); e.stopPropagation();
                            onEdit(step.id, 'delete');
                        }}
                        className="p-1.5 text-slate-300 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors relative z-10"
                        title="Eliminar paso"
                    >
                        <Trash2 className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar">
                {children}
            </div>
        </div >
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

const ProjectsSection = ({ showToast, onActiveChange }) => {
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
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');

    // AI Step Config
    const [openStepConfig, setOpenStepConfig] = useState(null); // { stepId: '...', projectId: '...' }
    const [stepPrompt, setStepPrompt] = useState('');
    const [stepWaitMsg, setStepWaitMsg] = useState('');
    const [isOptimizing, setIsOptimizing] = useState(false);

    // AI Search integration
    const [showAISearch, setShowAISearch] = useState(false);
    const [searchPreview, setSearchPreview] = useState([]);
    const [selectedSearchIds, setSelectedSearchIds] = useState([]); // Multi-select state
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
            setSelectedSearchIds([]); // Clear selected IDs when project changes
        }
        if (onActiveChange) {
            onActiveChange(!!activeProject);
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
                    vacancyId: selectedVacancyId || null,
                    startDate: startDate || new Date().toISOString().split('T')[0],
                    endDate: endDate || null
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

    const handleUpdateStepName = async (stepId, mode = 'name') => {
        const step = activeProject.steps.find(s => s.id === stepId);
        if (!step) return;

        if (mode === 'toggle') {
            // Quick Toggle
            const newEnabled = !step.aiConfig?.enabled;
            const updatedAI = { ...(step.aiConfig || {}), enabled: newEnabled };
            updateStepAI(stepId, updatedAI);
            return;
        }

        if (mode === 'ai') {
            // Open Config Modal
            setOpenStepConfig({ stepId, projectId: activeProject.id });
            setStepPrompt(step.aiConfig?.prompt || '');
            setStepWaitMsg(step.aiConfig?.waitMessage || '');
            return;
        }


        if (mode === 'delete') {
            await handleDeleteStep(stepId);
            return;
        }

        // Mode Name
        const newName = prompt('Nuevo nombre del paso:', step.name);
        if (!newName || newName === step.name) return;

        const updatedSteps = activeProject.steps.map(s =>
            s.id === stepId ? { ...s, name: newName } : s
        );
        saveStepsUpdate(updatedSteps, 'Paso renombrado');
    };

    const handleDeleteStep = async (stepId) => {
        const stepIndex = activeProject.steps.findIndex(s => s.id === stepId);
        if (stepIndex === -1) return;

        // Find candidates in this step
        const candidatesInStep = projectCandidates.filter(c =>
            (c.projectMetadata?.stepId === stepId) ||
            (stepIndex === 0 && (!c.projectMetadata?.stepId || c.projectMetadata?.stepId === 'step_new'))
        );

        if (candidatesInStep.length > 0) {
            if (activeProject.steps.length <= 1) {
                showToast('No puedes eliminar el único paso con candidatos', 'error');
                return;
            }

            if (stepIndex === 0) {
                showToast('No puedes eliminar el primer paso si tiene candidatos activos. Muévelos manualmente.', 'error');
                return;
            }

            const confirmMsg = `ADVERTENCIA: Hay ${candidatesInStep.length} candidatos en este paso.\n\nSe moverán al paso anterior: "${activeProject.steps[stepIndex - 1].name}".\n\n¿Deseas continuar?`;

            if (!window.confirm(confirmMsg)) return;

            // Migrate candidates to previous step
            const previousStep = activeProject.steps[stepIndex - 1];
            setIsBatchLinking(true);
            try {
                // We'll use batchLink action but with stepId update on candidates
                // Or simply loop over them (slower but safer) or add a migration endpoint
                // Let's use batchLink which already exists and handles changing steps

                const payload = {
                    action: 'batchLink',
                    projectId: activeProject.id,
                    stepId: previousStep.id,
                    candidateIds: candidatesInStep.map(c => c.id)
                };

                await fetch('/api/projects', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                // Update local candidates
                setProjectCandidates(prev => prev.map(c =>
                    candidatesInStep.some(cis => cis.id === c.id)
                        ? { ...c, projectMetadata: { ...c.projectMetadata, stepId: previousStep.id } }
                        : c
                ));

            } catch (e) {
                console.error('Error migrating candidates:', e);
                showToast('Error al migrar candidatos. Cancelando eliminación.', 'error');
                setIsBatchLinking(false);
                return;
            } finally {
                setIsBatchLinking(false);
            }
        } else {
            if (!window.confirm('¿Eliminar este paso?')) return;
        }

        // Proceed to delete step
        const updatedSteps = activeProject.steps.filter(s => s.id !== stepId);
        saveStepsUpdate(updatedSteps, 'Paso eliminado');
    };

    const handleLaunchStep = async (stepId) => {
        if (!activeProject) return;
        const step = activeProject.steps.find(s => s.id === stepId);

        showToast(`Lanzando Brenda en ${step?.name || 'este paso'}...`, 'info');

        try {
            const res = await fetch('/api/projects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'launchStep',
                    projectId: activeProject.id,
                    stepId
                })
            });
            const data = await res.json();
            if (data.logs) console.log('[BRENDA ENGINE LOGS]', data.logs);
            if (data.success) {
                showToast(`¡Brenda lanzada! ${data.processed || 0} candidatos procesados.`, 'success');
            } else {
                showToast(data.error || 'Error al lanzar Brenda', 'error');
            }
        } catch (e) {
            console.error('Launch error:', e);
            showToast('Error de conexión al lanzar', 'error');
        }
    };

    const handleAddStep = async () => {
        if (!activeProject) return;
        const name = prompt('Nombre del nuevo paso:', 'Nuevo Paso');
        if (!name || !name.trim()) return;

        const newStep = {
            id: `step_${Date.now()}`,
            name: name.trim(),
            aiConfig: { enabled: false, prompt: '', waitMessage: '' }
        };

        const updatedSteps = [...(activeProject.steps || []), newStep];
        saveStepsUpdate(updatedSteps, 'Paso creado');
    };

    const updateStepAI = async (stepId, aiConfig) => {
        const updatedSteps = activeProject.steps.map(s =>
            s.id === stepId ? { ...s, aiConfig } : s
        );
        saveStepsUpdate(updatedSteps, aiConfig.enabled ? 'IA Activada' : 'IA Desactivada');
    };

    const saveStepsUpdate = async (updatedSteps, toastMsg) => {
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
                if (showToast) showToast(toastMsg, 'success');
            }
        } catch (e) {
            if (showToast) showToast('Error al guardar cambio', 'error');
        }
    };

    // Deprecated old function kept for ref if needed but replaced by above
    const _handleUpdateStepName = async (stepId) => {
        console.log('[ProjectsSection] handleUpdateStepName triggered for:', stepId);
        const step = activeProject.steps.find(s => s.id === stepId);
        if (!step) {
            console.error('[ProjectsSection] Step not found:', stepId);
            return;
        }

        const newName = prompt('Nuevo nombre del paso:', step.name);
        console.log('[ProjectsSection] Prompt result:', newName);
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
        // Defensive: Ensure candidates is an array AND filter null/undefined items
        const safeCandidates = (Array.isArray(candidates) ? candidates : []).filter(c => c && c.id);
        console.log('[Projects] AI Results:', safeCandidates.length);

        setSearchPreview(safeCandidates);
        setSelectedSearchIds(safeCandidates.map(c => c.id)); // Select all by default
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
                        resultsCount: safeCandidates.length
                    })
                });
                fetchProjectSearches(activeProject.id);
            } catch (e) { console.error('Error saving search history:', e); }
        }
    };

    const handleBatchLink = async (subset = null) => {
        if (!activeProject || (!subset && selectedSearchIds.length === 0)) return;
        setIsBatchLinking(true);

        try {
            // Determine candidates to link: either the specific subset (single add) or the multi-selection
            let candidatesToLink = [];
            if (subset && Array.isArray(subset)) {
                candidatesToLink = subset;
            } else {
                candidatesToLink = searchPreview.filter(c => selectedSearchIds.includes(c.id));
            }

            if (candidatesToLink.length === 0) {
                setIsBatchLinking(false);
                return;
            }

            // CRITICAL: Always use the FIRST step (Leftmost)
            const targetStepId = activeProject.steps && activeProject.steps.length > 0
                ? activeProject.steps[0].id
                : null;

            if (!targetStepId) {
                showToast('El proyecto no tiene pasos para recibir candidatos', 'error');
                setIsBatchLinking(false);
                return;
            }

            const payload = {
                action: 'batchLink',
                projectId: activeProject.id,
                stepId: targetStepId, // FORCE LEFTMOST STEP
                candidateIds: candidatesToLink.map(c => c.id)
            };

            const res = await fetch('/api/projects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await res.json();
            if (data.success) {
                showToast(`${candidatesToLink.length} candidatos importados`, 'success');
                // Remove imported candidates from preview
                const linkedIds = candidatesToLink.map(c => c.id);
                setSearchPreview(prev => prev.filter(c => !linkedIds.includes(c.id)));
                setSelectedSearchIds(prev => prev.filter(id => !linkedIds.includes(id)));

                // If modal empty, close it
                if (searchPreview.length - candidatesToLink.length <= 0) {
                    setShowAISearch(false);
                }

                // Refresh Project Candidates
                fetchProjectCandidates(activeProject.id);
            } else {
                showToast(data.error || 'Error al importar', 'error');
            }
        } catch (error) {
            console.error('Error importing candidates:', error);
            showToast('Error al importar candidatos', 'error');
        } finally {
            setIsBatchLinking(false);
        }
    };

    const handleOptimizePrompt = async (text, setter, type = 'instruction') => {
        if (!text.trim()) return;
        setIsOptimizing(true);
        try {
            const res = await fetch('/api/ai/optimize-prompt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: text, type })
            });
            const data = await res.json();
            if (data.success && data.optimizedPrompt) {
                setter(data.optimizedPrompt);
                showToast('Optimizado con éxito ✨', 'success');
            } else {
                showToast(data.error || 'Error al optimizar', 'error');
            }
        } catch (e) {
            console.error('Error optimizing:', e);
            showToast('Error de conexión', 'error');
        } finally {
            setIsOptimizing(false);
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


    return (
        <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
        >
            <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-900/50 p-4 space-y-4">
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

                {/* AI Search Results Preview Modal */}
                {Array.isArray(searchPreview) && searchPreview.length > 0 && (
                    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                        <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-4xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[85vh]">
                            <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-white/50 dark:bg-slate-800/50 backdrop-blur-md">
                                <div>
                                    <h3 className="text-xl font-black text-slate-800 dark:text-white uppercase tracking-tight flex items-center gap-2">
                                        <Sparkles className="w-5 h-5 text-purple-500" />
                                        Resultados de IA
                                    </h3>
                                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                                        Selecciona los candidatos para importar al paso: <span className="text-blue-500 font-bold">{(activeProject.steps && activeProject.steps[0]?.name) || 'Paso 1'}</span>
                                    </p>
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => {
                                            if (selectedSearchIds.length === searchPreview.length) setSelectedSearchIds([]);
                                            else setSelectedSearchIds(searchPreview.map(c => c.id));
                                        }}
                                        className="text-xs font-bold text-blue-500 hover:text-blue-700 uppercase tracking-widest px-3"
                                    >
                                        {selectedSearchIds.length === searchPreview.length ? 'Deseleccionar' : 'Seleccionar Todos'}
                                    </button>
                                    <button
                                        onClick={() => { setSearchPreview([]); setActiveQuery(''); setSelectedSearchIds([]); }}
                                        className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                                    >
                                        <X className="w-5 h-5 text-slate-400" />
                                    </button>
                                </div>
                            </div>

                            <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
                                {searchPreview.map(cand => {
                                    // Extreme defense against bad data
                                    const displayName = String(cand?.nombreReal || cand?.nombre || 'Desconocido');
                                    const initials = displayName.substring(0, 2).toUpperCase();
                                    const location = String(cand?.municipio || 'Sin ubicación');
                                    const phone = String(cand?.whatsapp || cand?.telefono || 'Sin contacto');
                                    const category = String(cand?.categoria || 'General');

                                    const age = cand?.edad || calculateAge(cand?.fechaNacimiento);
                                    const ageDisplay = age ? `${age} años` : 'Edad N/A';

                                    const isSelected = selectedSearchIds.includes(cand.id);

                                    return (
                                        <div key={cand?.id || Math.random()}
                                            onClick={() => {
                                                if (isSelected) setSelectedSearchIds(prev => prev.filter(id => id !== cand.id));
                                                else setSelectedSearchIds(prev => [...prev, cand.id]);
                                            }}
                                            className={`flex items-center justify-between p-3 rounded-2xl border transition-all cursor-pointer group ${isSelected ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-500 dark:border-blue-500' : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700/50 hover:border-slate-300'}`}>

                                            <div className="flex items-center gap-4 flex-1">
                                                {/* Checkbox UI */}
                                                <div className={`w-5 h-5 rounded-lg border-2 flex items-center justify-center transition-colors ${isSelected ? 'bg-blue-500 border-blue-500' : 'border-slate-300 dark:border-slate-600 group-hover:border-blue-400'}`}>
                                                    {isSelected && <div className="w-2 h-2 bg-white rounded-sm" />}
                                                </div>

                                                <div className="w-12 h-12 flex-shrink-0 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-sm uppercase">
                                                    {initials}
                                                </div>

                                                <div className="flex-1 grid grid-cols-2 gap-4">
                                                    <div className="space-y-1">
                                                        <p className="font-black text-slate-800 dark:text-white text-base truncate">
                                                            {displayName}
                                                        </p>
                                                        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-medium">
                                                            <Briefcase className="w-3 h-3" />
                                                            <span className="uppercase tracking-tight truncate max-w-[150px]">{category}</span>
                                                        </div>
                                                    </div>
                                                    <div className="space-y-1 flex flex-col justify-center border-l border-slate-200 dark:border-slate-700 pl-4">
                                                        <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                                                            <MapPin className="w-3 h-3 opacity-50" />
                                                            <span>{location}</span>
                                                            <span className="text-slate-300">•</span>
                                                            <span>{ageDisplay}</span>
                                                        </div>
                                                        <div className="flex items-center gap-2 text-xs text-slate-500">
                                                            <div className="w-3 h-3 rounded-full bg-green-500/20 flex items-center justify-center">
                                                                <div className="w-1.5 h-1.5 rounded-full bg-green-500"></div>
                                                            </div>
                                                            <span className="font-mono opacity-70">{phone}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-4 pl-4 border-l border-slate-200 dark:border-slate-700 ml-4">
                                                <span className="px-3 py-1 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 text-xs font-black uppercase">
                                                    85% Match
                                                </span>
                                                <Button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleBatchLink([cand]);
                                                    }}
                                                    className="p-2 h-auto text-[10px] bg-slate-200 hover:bg-blue-500 hover:text-white dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-blue-600 transition-colors rounded-xl"
                                                    title="Importar solo a él"
                                                >
                                                    <Plus className="w-4 h-4" />
                                                </Button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            <div className="p-6 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex justify-between items-center">
                                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                                    {selectedSearchIds.length} seleccionados
                                </span>
                                <div className="flex gap-3">
                                    <button
                                        onClick={() => { setSearchPreview([]); setActiveQuery(''); setSelectedSearchIds([]); }}
                                        className="px-6 py-3 rounded-xl font-bold text-slate-500 hover:text-slate-700 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors uppercase text-xs tracking-widest"
                                    >
                                        Cancelar
                                    </button>
                                    <Button
                                        onClick={() => handleBatchLink()}
                                        disabled={isBatchLinking || selectedSearchIds.length === 0}
                                        className="bg-purple-600 hover:bg-purple-700 text-white shadow-xl shadow-purple-600/30 px-8 py-3 rounded-xl font-black uppercase tracking-widest text-xs flex items-center gap-2"
                                    >
                                        {isBatchLinking ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                                        Importar Seleccionados
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* AI Step Config Modal */}
                {openStepConfig && (
                    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                        <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
                            <div className="p-6 space-y-6">
                                <div className="flex items-center gap-3">
                                    <div className="p-3 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-2xl shadow-lg shadow-purple-500/30">
                                        <Bot className="w-8 h-8 text-white" />
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-black text-slate-800 dark:text-white uppercase tracking-tight">Configurar Agente IA</h3>
                                        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                                            Paso: {activeProject.steps.find(s => s.id === openStepConfig.stepId)?.name}
                                        </p>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <div className="flex justify-between items-center">
                                            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-widest flex items-center gap-2">
                                                Prompt / Instrucción
                                                <button
                                                    onClick={() => handleOptimizePrompt(stepPrompt, setStepPrompt, 'instruction')}
                                                    disabled={isOptimizing || !stepPrompt.trim()}
                                                    className={`p-1 rounded-md transition-all ${isOptimizing ? 'animate-spin text-purple-500' : 'text-purple-500 hover:bg-purple-100 dark:hover:bg-purple-900/40 hover:scale-110'}`}
                                                    title="Mejorar con IA Mágica"
                                                >
                                                    <Sparkles className="w-3.5 h-3.5" />
                                                </button>
                                            </label>
                                            <div className="flex gap-2">
                                                <span className="text-[10px] bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-slate-500">{"{{Candidato}}"}</span>
                                                <span className="text-[10px] bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-slate-500">{"{{Vacante}}"}</span>
                                            </div>
                                        </div>
                                        <textarea
                                            value={stepPrompt}
                                            onChange={(e) => setStepPrompt(e.target.value)}
                                            className="w-full bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-sm focus:ring-2 focus:ring-purple-500 outline-none resize-none h-32"
                                            placeholder="Ej: Saluda a {{Candidato}} y pregúntale si le interesa la vacante de {{Vacante}}..."
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-widest flex items-center gap-2">
                                            Mensaje de Espera (Tapón Inteligente)
                                            <button
                                                onClick={() => handleOptimizePrompt(stepWaitMsg, setStepWaitMsg, 'wait')}
                                                disabled={isOptimizing || !stepWaitMsg.trim()}
                                                className={`p-1 rounded-md transition-all ${isOptimizing ? 'animate-spin text-yellow-500' : 'text-yellow-500 hover:bg-yellow-100 dark:hover:bg-yellow-900/40 hover:scale-110'}`}
                                                title="Mejorar mensaje de espera"
                                            >
                                                <Sparkles className="w-3.5 h-3.5" />
                                            </button>
                                        </label>
                                        <p className="text-[10px] text-slate-500 italic mb-1">
                                            Si el siguiente paso está APAGADO, Brenda dirá esto para ganar tiempo.
                                        </p>
                                        <textarea
                                            value={stepWaitMsg}
                                            onChange={(e) => setStepWaitMsg(e.target.value)}
                                            className="w-full bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-sm focus:ring-2 focus:ring-yellow-500 outline-none resize-none h-20"
                                            placeholder="Ej: Excelente, cumples el perfil. Estamos coordinando fechas para entrevistas, te aviso en breve..."
                                        />
                                    </div>
                                </div>

                                <div className="flex justify-end gap-3 pt-2">
                                    <button
                                        onClick={() => setOpenStepConfig(null)}
                                        className="px-4 py-2 text-slate-500 hover:text-slate-700 font-bold text-xs uppercase"
                                    >
                                        Cancelar
                                    </button>
                                    <Button
                                        onClick={() => {
                                            const step = activeProject.steps.find(s => s.id === openStepConfig.stepId);
                                            const newConfig = {
                                                ...(step.aiConfig || {}),
                                                enabled: true, // Auto-enable on save
                                                prompt: stepPrompt,
                                                waitMessage: stepWaitMsg
                                            };
                                            updateStepAI(openStepConfig.stepId, newConfig);
                                            setOpenStepConfig(null);
                                        }}
                                        className="bg-purple-600 hover:bg-purple-700 text-white rounded-xl px-6 py-2 shadow-lg shadow-purple-500/20"
                                    >
                                        Guardar y Activar
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
                <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">
                    {/* Projects List sidebar */}
                    <div className="col-span-12 lg:col-span-2 flex flex-col min-h-0 space-y-2 overflow-hidden">
                        <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-2">
                            {projects.length === 0 ? null : (
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
                    </div>

                    {/* Main Area (Kanban tablero) */}
                    <div className="col-span-12 lg:col-span-10 flex flex-col min-h-0 bg-white/40 dark:bg-slate-800/20 rounded-[32px] border border-slate-200 dark:border-slate-800 overflow-hidden shadow-2xl shadow-blue-500/5">
                        {activeProject ? (
                            <div className="flex-1 flex flex-col min-h-0 p-4 space-y-4">
                                {/* Project bar - Ultra compact */}
                                <div className="flex flex-row items-center justify-between gap-4 bg-white/80 dark:bg-slate-900/60 p-2 px-4 rounded-[20px] border border-slate-100 dark:border-slate-800 shadow-sm backdrop-blur-md">
                                    <div className="flex items-center gap-2">
                                        <div className="p-1.5 bg-blue-600 rounded-lg shadow-lg shadow-blue-500/20">
                                            <FolderKanban className="w-4 h-4 text-white" />
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <h3 className="text-sm font-black text-slate-800 dark:text-white uppercase tracking-tighter truncate max-w-[200px]">{activeProject.name}</h3>
                                            <div className="flex items-center gap-2">
                                                <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded-md">
                                                    <Users className="w-2 h-2" />
                                                    {projectCandidates.length}
                                                </span>
                                                {activeProject.vacancyId && (
                                                    <span className="px-1.5 py-0.5 rounded-md bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-[8px] font-black uppercase tracking-widest flex items-center gap-1">
                                                        <Briefcase className="w-2 h-2" />
                                                        {vacancies.find(v => v.id === activeProject.vacancyId)?.name || 'Vacante'}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => { resetForm(); setShowCreateModal(true); }}
                                            className="flex items-center gap-1.5 text-slate-400 hover:text-blue-500 transition-colors p-1"
                                            title="Nuevo Proyecto"
                                        >
                                            <Plus className="w-4 h-4" />
                                        </button>
                                        <Button
                                            icon={Sparkles}
                                            onClick={() => setShowAISearch(true)}
                                            className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-black text-[8px] uppercase tracking-widest px-3 py-1.5 h-auto shadow-lg shadow-blue-600/20"
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
                                                    onEdit={(id, mode) => handleUpdateStepName(id, mode)}
                                                    onLaunch={(id) => handleLaunchStep(id)}
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
                                    <button
                                        onClick={handleAddStep}
                                        className="flex-shrink-0 w-80 h-full rounded-[40px] border-2 border-dashed border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center gap-4 text-slate-400 hover:text-blue-500 hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-all group"
                                    >
                                        <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center group-hover:scale-110 transition-transform">
                                            <Plus className="w-8 h-8" />
                                        </div>
                                        <span className="font-black uppercase tracking-tighter text-sm">Nuevo Paso</span>
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center">
                                <Button
                                    onClick={() => { resetForm(); setShowCreateModal(true); }}
                                    className="flex items-center gap-3 bg-blue-600 hover:bg-blue-700 text-white border-none shadow-xl shadow-blue-500/20 py-4 px-10 h-auto text-[14px] font-black uppercase tracking-widest rounded-2xl transform hover:scale-105 transition-all"
                                >
                                    <Plus className="w-6 h-6" />
                                    Crear nuevo proyecto
                                </Button>
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

                            {/* Fechas de Vigencia */}
                            <div className="flex gap-4">
                                <div className="flex-1">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1 mb-2 block">Fecha Inicio</label>
                                    <input
                                        type="date"
                                        value={startDate}
                                        onChange={(e) => setStartDate(e.target.value)}
                                        className="w-full h-14 px-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none uppercase text-slate-700 dark:text-white"
                                    />
                                </div>
                                <div className="flex-1">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1 mb-2 block">Fecha Fin (Vigencia)</label>
                                    <input
                                        type="date"
                                        value={endDate}
                                        onChange={(e) => setEndDate(e.target.value)}
                                        className="w-full h-14 px-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none uppercase text-slate-700 dark:text-white"
                                    />
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
