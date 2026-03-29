import React, { useState, useEffect } from 'react';
import { Plus, X, GripVertical, Check, Trash2, Edit2, Box, ArrowRight, Loader2, ListTodo } from 'lucide-react';
import { updateCandidate } from '../services/candidatesService';

export default function ManualProjectsSidepanel({ selectedChat, onClose, showToast, onCandidateUpdated }) {
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);

    // Vistas: 'pipeline' (para asignar al candidato) o 'settings' (para configurar proyectos)
    const [view, setView] = useState('pipeline'); 

    // Formularios
    const [showNewProjectForm, setShowNewProjectForm] = useState(false);
    const [newProjectName, setNewProjectName] = useState('');
    const [expandedProjectId, setExpandedProjectId] = useState(null);

    const [newStepName, setNewStepName] = useState('');

    useEffect(() => {
        loadProjects();
    }, []);

    // Si cambian de chat y estábamos en 'settings', igual lo podemos mantener o regresar a 'pipeline'
    useEffect(() => {
        if (selectedChat) {
            setView('pipeline');
        } else {
            setView('settings');
        }
    }, [selectedChat?.id]);

    const loadProjects = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/manual_projects');
            const data = await res.json();
            if (data.success) {
                setProjects(data.data);
            }
        } catch (e) {
            console.error(e);
            showToast && showToast('Error cargando proyectos', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleCreateProject = async (e) => {
        e.preventDefault();
        if (!newProjectName.trim()) return;
        try {
            const res = await fetch('/api/manual_projects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newProjectName.trim() })
            });
            const data = await res.json();
            if (data.success) {
                setProjects([...projects, data.data]);
                setNewProjectName('');
                setShowNewProjectForm(false);
                setExpandedProjectId(data.data.id);
            }
        } catch (error) {
            showToast && showToast('Error al crear proyecto', 'error');
        }
    };

    const handleDeleteProject = async (id, e) => {
        e.stopPropagation();
        if (!window.confirm('¿Seguro que deseas eliminar todo este proyecto?')) return;
        try {
            const res = await fetch(`/api/manual_projects?id=${id}`, { method: 'DELETE' });
            if (res.ok) {
                setProjects(projects.filter(p => p.id !== id));
            }
        } catch (error) {
            showToast && showToast('Error al eliminar proyecto', 'error');
        }
    };

    const handleAddStep = async (projectId, e) => {
        e.preventDefault();
        if (!newStepName.trim()) return;
        
        const project = projects.find(p => p.id === projectId);
        if (!project) return;

        const newStep = {
            id: 'step_' + Math.random().toString(36).substr(2, 9),
            name: newStepName.trim()
        };

        const updatedSteps = [...(project.steps || []), newStep];
        await updateProject(projectId, { steps: updatedSteps });
        setNewStepName('');
    };

    const handleDeleteStep = async (projectId, stepId) => {
        const project = projects.find(p => p.id === projectId);
        if (!project) return;
        
        const updatedSteps = project.steps.filter(s => s.id !== stepId);
        await updateProject(projectId, { steps: updatedSteps });
    };

    const updateProject = async (projectId, updates) => {
        try {
            const res = await fetch('/api/manual_projects', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: projectId, ...updates })
            });
            const data = await res.json();
            if (data.success) {
                setProjects(projects.map(p => p.id === projectId ? data.data : p));
            }
        } catch (e) {
            showToast && showToast('Error al actualizar', 'error');
        }
    };

    // ----- Drag and Drop -----
    const handleDragStart = (e, index, projectId) => {
        e.dataTransfer.setData('stepIndex', index.toString());
        e.dataTransfer.setData('projectId', projectId);
    };

    const handleDrop = async (e, toIndex, projectId) => {
        const fromIndex = parseInt(e.dataTransfer.getData('stepIndex'));
        const draggedProjectId = e.dataTransfer.getData('projectId');
        
        if (draggedProjectId !== projectId || fromIndex === toIndex || isNaN(fromIndex)) return;

        const project = projects.find(p => p.id === projectId);
        const newSteps = [...project.steps];
        const [movedStep] = newSteps.splice(fromIndex, 1);
        newSteps.splice(toIndex, 0, movedStep);

        // Optimistic update
        setProjects(projects.map(p => p.id === projectId ? { ...p, steps: newSteps } : p));
        await updateProject(projectId, { steps: newSteps });
    };

    const handleDragOver = (e) => {
        e.preventDefault(); // allow drop
    };

    // ----- Assignment (Operativa) -----
    const handleAssignCandidate = async (projectId, stepId) => {
        if (!selectedChat) return;
        
        // Se asume que el backend actualiza
        const res = await updateCandidate(selectedChat.id, {
            manualProjectId: projectId,
            manualProjectStepId: stepId
        });

        if (res.success) {
            showToast && showToast('Pipeline actualizado', 'success');
            if (onCandidateUpdated) {
                onCandidateUpdated(res.candidate); // Propagar al padre para cambiar la UI del chat
            }
        } else {
            showToast && showToast('Error al asignar pipeline', 'error');
        }
    };


    if (loading) {
        return <div className="w-[340px] border-l border-gray-100 dark:border-gray-800 bg-white dark:bg-[#111b21] flex h-full items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-gray-300" /></div>;
    }

    // Pipeline Activo (Si hay candidato seleccionado)
    const activeProjectId = selectedChat?.manualProjectId;
    const activeStepId = selectedChat?.manualProjectStepId;
    const activeProject = projects.find(p => p.id === activeProjectId);

    return (
        <div className="w-full md:w-[350px] border-l border-gray-100 dark:border-gray-800 bg-[#f8f9fa] dark:bg-[#0b141a] flex flex-col h-full z-20 shadow-[-4px_0_15px_rgba(0,0,0,0.02)]">
            {/* Header */}
            <div className="h-[59px] px-4 py-2 flex items-center justify-between border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-[#202c33] shrink-0">
                <div className="flex items-center gap-2">
                    <Box className="w-5 h-5 text-indigo-500" />
                    <h2 className="text-[16px] font-semibold text-[#111b21] dark:text-[#e9edef]">CRM Manual</h2>
                </div>
                <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-white/5 transition-colors">
                    <X className="w-5 h-5 text-gray-500" />
                </button>
            </div>

            {/* Toggle View */}
            <div className="flex bg-white dark:bg-[#202c33] px-4 py-2 border-b border-gray-100 dark:border-gray-800 shrink-0">
                <button 
                    onClick={() => setView('pipeline')}
                    className={`flex-1 py-1.5 text-[13px] font-medium rounded-md transition-colors ${view === 'pipeline' ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400' : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-white/5'}`}
                >
                    Activo
                </button>
                <button 
                    onClick={() => setView('settings')}
                    className={`flex-1 py-1.5 text-[13px] font-medium rounded-md transition-colors ${view === 'settings' ? 'bg-gray-100 text-gray-800 dark:bg-white/10 dark:text-white' : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-white/5'}`}
                >
                    Ajustes y Pasos
                </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
                
                {view === 'pipeline' && (
                    <div className="space-y-4">
                        {!selectedChat ? (
                            <div className="text-center py-8 px-4 text-gray-400 text-sm">
                                <ArrowRight className="w-8 h-8 mx-auto xl text-gray-300 mb-2 opacity-50" />
                                Selecciona un chat para asignarle un proyecto manual.
                            </div>
                        ) : (
                            <>
                                <div className="bg-white dark:bg-[#111b21] border border-gray-100 dark:border-gray-800 rounded-xl p-4 shadow-sm">
                                    <h3 className="text-[13px] font-bold text-gray-400 uppercase tracking-wider mb-3">Proyecto Asignado</h3>
                                    <select 
                                        className="w-full bg-gray-50 dark:bg-[#202c33] border border-gray-200 dark:border-gray-700 text-sm rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500/50 appearance-none font-medium mb-1 cursor-pointer"
                                        value={activeProjectId || ''}
                                        onChange={(e) => handleAssignCandidate(e.target.value, null)}
                                    >
                                        <option value="">-- Sin Proyecto --</option>
                                        {projects.map(p => (
                                            <option key={p.id} value={p.id}>{p.name}</option>
                                        ))}
                                    </select>
                                </div>

                                {activeProject && activeProject.steps && activeProject.steps.length > 0 && (
                                    <div className="bg-white dark:bg-[#111b21] border border-gray-100 dark:border-gray-800 rounded-xl p-4 shadow-sm">
                                        <h3 className="text-[13px] font-bold text-gray-400 uppercase tracking-wider mb-4">Pipeline Status</h3>
                                        <div className="relative pl-3 space-y-5">
                                            {/* Linea vertical de conexion */}
                                            <div className="absolute left-[17px] top-2 bottom-2 w-0.5 bg-gray-100 dark:bg-gray-800 z-0 rounded-full"></div>
                                            
                                            {activeProject.steps.map((step, idx) => {
                                                const isActive = activeStepId === step.id;
                                                const isPast = activeProject.steps.findIndex(s => s.id === activeStepId) > idx;

                                                return (
                                                    <div 
                                                        key={step.id} 
                                                        onClick={() => handleAssignCandidate(activeProject.id, step.id)}
                                                        className="relative z-10 flex flex-col group cursor-pointer"
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            <div className={`w-3.5 h-3.5 rounded-full shrink-0 border-2 transition-all duration-300 ${isActive ? 'bg-indigo-500 border-indigo-200 ring-4 ring-indigo-50 dark:ring-indigo-500/20' : isPast ? 'bg-indigo-400 border-indigo-400' : 'bg-white dark:bg-[#202c33] border-gray-300 dark:border-gray-600 group-hover:border-indigo-300'}`}></div>
                                                            <div className={`text-[14px] font-medium transition-colors ${isActive ? 'text-indigo-600 dark:text-indigo-400 font-bold' : isPast ? 'text-gray-600 dark:text-gray-300' : 'text-gray-400 dark:text-gray-500 group-hover:text-gray-600 group-hover:dark:text-gray-300'}`}>
                                                                {step.name}
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                {activeProject && (!activeProject.steps || activeProject.steps.length === 0) && (
                                    <p className="text-xs text-gray-400 text-center py-4">Este proyecto no tiene pasos configurados aún.</p>
                                )}
                            </>
                        )}
                    </div>
                )}

                {view === 'settings' && (
                    <div className="space-y-3">
                        <button 
                            onClick={() => setShowNewProjectForm(true)}
                            className="w-full flex items-center justify-center gap-2 py-2.5 bg-white dark:bg-[#111b21] border border-dashed border-gray-300 dark:border-gray-700 rounded-xl text-sm font-medium text-gray-500 hover:text-indigo-500 hover:border-indigo-300 hover:bg-indigo-50/50 dark:hover:bg-indigo-500/10 transition-colors"
                        >
                            <Plus className="w-4 h-4" /> Crear Proyecto
                        </button>

                        {showNewProjectForm && (
                            <form onSubmit={handleCreateProject} className="bg-white dark:bg-[#111b21] p-3 rounded-xl border border-indigo-200 shadow-sm flex gap-2">
                                <input 
                                    autoFocus
                                    type="text" 
                                    className="flex-1 bg-gray-50 dark:bg-[#202c33] border border-gray-200 dark:border-gray-700 outline-none px-3 py-1.5 rounded-lg text-sm"
                                    placeholder="Nombre del proyecto..."
                                    value={newProjectName}
                                    onChange={e => setNewProjectName(e.target.value)}
                                />
                                <button type="submit" className="p-1.5 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 shrink-0"><Check className="w-4 h-4"/></button>
                                <button type="button" onClick={() => setShowNewProjectForm(false)} className="p-1.5 bg-gray-100 dark:bg-white/10 text-gray-500 rounded-lg hover:bg-gray-200 shrink-0"><X className="w-4 h-4"/></button>
                            </form>
                        )}

                        {projects.map(project => (
                            <div key={project.id} className="bg-white dark:bg-[#111b21] border border-gray-100 dark:border-gray-800 rounded-xl shadow-sm overflow-hidden transition-all">
                                <div 
                                    className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5"
                                    onClick={() => setExpandedProjectId(expandedProjectId === project.id ? null : project.id)}
                                >
                                    <div className="font-semibold text-[14px] text-gray-800 dark:text-gray-200 flex items-center gap-2">
                                        <ListTodo className="w-4 h-4 text-gray-400" />
                                        {project.name}
                                    </div>
                                    <button onClick={(e) => handleDeleteProject(project.id, e)} className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-md transition-colors">
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                                
                                {expandedProjectId === project.id && (
                                    <div className="p-3 bg-gray-50 dark:bg-[#0b141a] border-t border-gray-100 dark:border-gray-800">
                                        <h4 className="text-[11px] font-bold text-gray-400 uppercase mb-2 ml-1">Pasos del pipeline</h4>
                                        
                                        <div className="space-y-1.5 mb-3">
                                            {(!project.steps || project.steps.length === 0) ? (
                                                <div className="text-xs text-center text-gray-400 py-2 italic bg-white dark:bg-[#111b21] rounded border border-dashed border-gray-200 dark:border-gray-800">No hay pasos</div>
                                            ) : (
                                                project.steps.map((step, idx) => (
                                                    <div 
                                                        key={step.id}
                                                        draggable
                                                        onDragStart={(e) => handleDragStart(e, idx, project.id)}
                                                        onDragOver={handleDragOver}
                                                        onDrop={(e) => handleDrop(e, idx, project.id)}
                                                        className="flex items-center gap-2 bg-white dark:bg-[#202c33] border border-gray-200 dark:border-gray-700 rounded-lg p-2 shadow-sm cursor-grab active:cursor-grabbing hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors"
                                                    >
                                                        <GripVertical className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" />
                                                        <div className="flex-1 text-[13px] font-medium text-gray-700 dark:text-gray-300 truncate">{step.name}</div>
                                                        <button 
                                                            onClick={(e) => { e.stopPropagation(); handleDeleteStep(project.id, step.id); }}
                                                            className="p-1 text-gray-300 hover:text-red-500 shrink-0"
                                                        >
                                                            <X className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>
                                                ))
                                            )}
                                        </div>

                                        <form onSubmit={(e) => handleAddStep(project.id, e)} className="flex items-center gap-2">
                                            <input 
                                                type="text" 
                                                className="flex-1 bg-white dark:bg-[#202c33] border border-gray-200 dark:border-gray-700 outline-none text-[13px] px-3 py-1.5 rounded-lg"
                                                placeholder="Nuevo paso..."
                                                value={newStepName}
                                                onChange={(e) => setNewStepName(e.target.value)}
                                            />
                                            <button type="submit" disabled={!newStepName.trim()} className="bg-indigo-500 disabled:bg-indigo-300 text-white rounded-lg p-1.5 hover:bg-indigo-600 transition-colors">
                                                <Plus className="w-4 h-4" />
                                            </button>
                                        </form>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
