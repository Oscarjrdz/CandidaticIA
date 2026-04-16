import React, { useState, useEffect } from 'react';
import {
    Users, Settings, Bot, History, Zap, Briefcase, Send, User, LogOut,
    MessageSquare, Layout, Smartphone, Folder, FolderKanban, GripVertical, Wifi, BrainCircuit, X
} from 'lucide-react';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const WhatsAppIcon = () => (
    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.008-.57-.008-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
);

const DEFAULT_MENU_ITEMS = [
    { id: 'candidates', label: 'Candidatos', icon: Users, position: 'top' },
    { id: 'chat', label: 'Chat Web', icon: MessageSquare, position: 'top' },
    { id: 'bulks', label: 'Envíos Masivos', icon: Send, position: 'top' },
    { id: 'bot-ia', label: 'Bot IA (2.0)', icon: Smartphone, position: 'top' },
    { id: 'automations', label: 'Automatizaciones', icon: Zap, position: 'top' },
    { id: 'vacancies', label: 'Vacantes', icon: Briefcase, position: 'top' },
    { id: 'bypass', label: 'ByPass', icon: Zap, position: 'top' },
    // { id: 'media-library', label: 'Biblioteca Multimedia', icon: Folder, position: 'top' },
    { id: 'projects', label: 'Proyectos', icon: FolderKanban, position: 'top' },
    { id: 'post-maker', label: 'Post Maker', icon: Layout, position: 'top' },
    { id: 'users', label: 'Usuarios', icon: User, position: 'top' },
    { id: 'settings', label: 'Settings', icon: Settings, position: 'bottom' }
];

const SortableMenuItem = ({ item, activeSection, onSectionChange, badge }) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: item.id });

    const style = {
        transform: CSS.Translate.toString(transform),
        transition,
        zIndex: isDragging ? 50 : 'auto',
        opacity: isDragging ? 0.5 : 1
    };

    const Icon = item.icon;
    const isActive = activeSection === item.id;

    return (
        <div
            ref={setNodeRef}
            style={style}
            className="group relative"
        >
            <button
                onClick={() => onSectionChange(item.id)}
                className={`
                    w-full flex items-center space-x-3 px-4 py-3 rounded-xl
                    transition-all duration-300 relative
                    ${isActive
                        ? 'bg-white/15 text-white shadow-lg backdrop-blur-md'
                        : 'text-blue-100/70 hover:text-white hover:bg-white/10'
                    }
                `}
                title={item.label}
            >
                {isActive && (
                    <div className="absolute left-0 w-1 h-6 bg-blue-400 rounded-r-full" />
                )}
                <Icon className={`w-5 h-5 transition-transform duration-300 ${isActive ? 'scale-110 text-white' : 'group-hover:scale-105'}`} />
                <span className={`font-medium text-sm flex-1 text-left ${isActive ? 'font-bold' : ''}`}>{item.label}</span>

                {/* Drag Handle */}
                <div
                    {...attributes}
                    {...listeners}
                    className="opacity-0 group-hover:opacity-40 hover:opacity-100 cursor-grab active:cursor-grabbing p-1 -mr-2 transition-opacity"
                >
                    <GripVertical className="w-4 h-4" />
                </div>
            </button>
        </div>
    );
};

const Sidebar = ({ activeSection, onSectionChange, onLogout, user, onUserUpdate, isMobileOpen, onClose }) => {
    const [items, setItems] = useState([]);
    const [rolePermissions, setRolePermissions] = useState(null);
    useEffect(() => {
        // Fetch roles to get user permissions
        fetch('/api/roles')
            .then(res => res.json())
            .then(data => {
                if (data.success && data.roles) {
                    const currentUserRole = data.roles.find(r => r.name === user?.role);
                    if (currentUserRole && currentUserRole.permissions) {
                        setRolePermissions(currentUserRole.permissions);
                    } else if (user?.role === 'SuperAdmin') {
                        const allPerms = {};
                        DEFAULT_MENU_ITEMS.forEach(i => allPerms[i.id] = true);
                        setRolePermissions(allPerms);
                    } else {
                        // Fallback open for backward compatibility or empty for strict? 
                        // Let's do empty for strict (hide everything unless permitted)
                        setRolePermissions({});
                    }
                }
            })
            .catch(console.error);
    }, [user?.role]);

    useEffect(() => {
        if (!rolePermissions) return; // Wait for permissions to load

        // Filter DEFAULT_MENU_ITEMS based on permissions
        const permittedDefaults = DEFAULT_MENU_ITEMS.filter(item => {
            return rolePermissions[item.id] === true || user?.role === 'SuperAdmin';
        });

        // Initialize from user config or default
        if (user?.sidebarConfig && Array.isArray(user.sidebarConfig)) {
            const reordered = user.sidebarConfig.map(id => permittedDefaults.find(i => i.id === id)).filter(Boolean);
            const missing = permittedDefaults.filter(di => !user.sidebarConfig.includes(di.id));
            
            // Insert new/missing items right after the first item (Candidatos) 
            // instead of at the very bottom, so they don't get hidden by scroll overflow.
            // As soon as the user drags them once, they get saved to sidebarConfig and stay where dragged.
            if (missing.length > 0 && reordered.length > 0) {
                reordered.splice(1, 0, ...missing);
            }
            
            setItems(reordered.length > 0 ? reordered : missing);
        } else {
            setItems(permittedDefaults);
        }
    }, [user, rolePermissions]);

    useEffect(() => {
        if (!rolePermissions) return;

        // Force redirect if the current section is not allowed (ignores SuperAdmin logic by checking user?.role itself)
        if (user?.role !== 'SuperAdmin' && rolePermissions[activeSection] !== true) {
            const firstAllowed = DEFAULT_MENU_ITEMS.find(item => rolePermissions[item.id] === true);
            if (firstAllowed) {
                // Changing section triggers the App re-render to the safe view immediately
                onSectionChange(firstAllowed.id);
            }
        }
    }, [activeSection, rolePermissions, user?.role, onSectionChange]);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    const handleDragEnd = async (event) => {
        const { active, over } = event;
        if (over && active.id !== over.id) {
            const oldIndex = items.findIndex(i => i.id === active.id);
            const newIndex = items.findIndex(i => i.id === over.id);

            const newItems = arrayMove(items, oldIndex, newIndex);
            setItems(newItems);

            // Sync with DB
            if (user?.id) {
                const config = newItems.map(i => i.id);
                try {
                    const res = await fetch('/api/users', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ...user, sidebarConfig: config })
                    });
                    const data = await res.json();
                    if (data.success) {
                        onUserUpdate(data.user);
                        localStorage.setItem('candidatic_user_session', JSON.stringify(data.user));
                    }
                } catch (e) {
                    console.error('Failed to save sidebar config', e);
                }
            }
        }
    };

    const topItems = items.filter(item => item.position === 'top');
    const bottomItem = items.find(item => item.position === 'bottom');

    const handleSectionClick = (sectionId) => {
        onSectionChange(sectionId);
        if (onClose) onClose(); // Close mobile drawer on navigation
    };

    return (
        <>
            {/* Mobile backdrop overlay */}
            {isMobileOpen && (
                <div
                    className="fixed inset-0 bg-black/50 z-40 lg:hidden transition-opacity duration-300"
                    onClick={onClose}
                />
            )}

            <aside className={`
                fixed lg:sticky top-0 left-0 h-screen w-64 bg-blue-700 flex flex-col overflow-hidden shadow-2xl transition-all duration-300 z-50
                ${isMobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
            `}>
                <div className="absolute inset-0 bg-gradient-to-b from-blue-600 via-blue-700 to-blue-800 pointer-events-none" />

                {/* Logo/Header */}
                <div className="relative p-6 mb-2">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                            <div className="relative flex-shrink-0 transition-transform duration-300 hover:scale-105">
                                <BrainCircuit className="w-8 h-8 text-white stroke-[2] drop-shadow-md rotate-90" />
                            </div>
                            <h2 className="text-[20px] font-extrabold text-white tracking-wider flex items-center drop-shadow-sm ml-1">
                                CANDIDATIC&nbsp;<span className="tracking-tighter">IΛ</span>
                            </h2>
                        </div>
                        {/* Mobile close button */}
                        <button
                            onClick={onClose}
                            className="lg:hidden p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* Menu Items - Top */}
                <nav className="relative flex-1 p-4 space-y-2 overflow-y-auto custom-scrollbar">
                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleDragEnd}
                    >
                        <SortableContext
                            items={topItems.map(i => i.id)}
                            strategy={verticalListSortingStrategy}
                        >
                            {topItems.map(item => (
                                <SortableMenuItem
                                    key={item.id}
                                    item={item}
                                    activeSection={activeSection}
                                    onSectionChange={handleSectionClick}
                                />
                            ))}
                        </SortableContext>
                    </DndContext>
                </nav>

                {/* Footer / Bottom Items */}
                <div className="relative p-4 mt-auto border-t border-white/5 bg-white/5" style={{ WebkitBackdropFilter: 'blur(4px)', backdropFilter: 'blur(4px)' }}>
                    <div className="space-y-2">
                        {bottomItem && (
                            <button
                                onClick={() => handleSectionClick(bottomItem.id)}
                                className={`
                                    w-full flex items-center space-x-3 px-4 py-3 rounded-xl
                                    transition-all duration-300 group
                                    ${activeSection === bottomItem.id
                                        ? 'bg-white/15 text-white'
                                        : 'text-blue-100/70 hover:text-white hover:bg-white/10'
                                    }
                                `}
                            >
                                <Settings className="w-5 h-5" />
                                <span className="font-medium text-sm">{bottomItem.label}</span>
                            </button>
                        )}

                        <button
                            onClick={onLogout}
                            className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all duration-300 group text-red-300 hover:text-red-100 hover:bg-red-500/20"
                        >
                            <LogOut className="w-5 h-5 transition-transform group-hover:-translate-x-1" />
                            <span className="font-medium text-sm">Cerrar Sesión</span>
                        </button>
                    </div>
                </div>
            </aside>
        </>
    );
};

export default Sidebar;
