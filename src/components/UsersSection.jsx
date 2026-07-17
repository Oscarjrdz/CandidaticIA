import React, { useState, useEffect, useRef } from 'react';
import { useConfirmModal } from './ui/ConfirmModal';
import { UserPlus, Trash2, Pencil, Shield, Loader2, RefreshCw, Search, User, ShieldCheck, Plus, Check, X, Tag, BarChart2, MessageSquare, Clock, CheckCircle, XCircle } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import Modal from './ui/Modal';
import Input from './ui/Input';
import Select from './ui/Select';
import { useToastContext } from '../contexts/ToastContext';

const AVAILABLE_SECTIONS = [
    { id: 'settings', name: 'Configuración' },
    { id: 'candidates', name: 'Candidatos' },
    { id: 'chat', name: 'Chat Web' },
    { id: 'bulks', name: 'Envíos Masivos' },
    { id: 'bot-ia', name: 'Bot IA' },
    { id: 'automations', name: 'Automatizaciones' },
    { id: 'vacancies', name: 'Vacantes' },
    { id: 'history', name: 'Historial' },
    { id: 'users', name: 'Usuarios' },
{ id: 'media-library', name: 'Biblioteca' },
    { id: 'projects', name: 'Proyectos' }
];

const AVAILABLE_CHAT_FILTERS = [
    { id: 'filter_todos', name: 'Todos' },
    { id: 'filter_complete', name: 'Perfil Completo' },
    { id: 'filter_incomplete', name: 'Incompletos' },
    { id: 'filter_labels', name: 'Etiquetas' },
    { id: 'filter_crm', name: 'CRM de Proyectos' }
];

const AVAILABLE_EXTRA_PERMS = [
    { id: 'can_manage_tags', name: 'Crear / Editar Etiquetas' },
    { id: 'view_incomplete_candidates', name: 'Ver candidatos incompletos' }
];

const UsersSection = () => {
    const { showToast } = useToastContext();
    const [activeTab, setActiveTab] = useState('users');
    const { confirmModalJSX, showConfirm } = useConfirmModal();
    const [users, setUsers] = useState([]);
    const [roles, setRoles] = useState([]);
    const [allManualProjects, setAllManualProjects] = useState([]);
    const [allTags, setAllTags] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');

    // Activity stats state
    const [activityStats, setActivityStats] = useState([]);
    const [activityDate, setActivityDate] = useState(() => new Date().toISOString().split('T')[0]);
    const [activityLoading, setActivityLoading] = useState(false);

    const loadActivityStats = async (date) => {
        setActivityLoading(true);
        try {
            const res = await fetch(`/api/recruiter-stats?date=${date}`);
            const data = await res.json();
            if (data.success) setActivityStats(data.stats);
        } catch (e) {
            showToast('Error cargando estadísticas', 'error');
        } finally {
            setActivityLoading(false);
        }
    };

    useEffect(() => {
        if (activeTab === 'activity') loadActivityStats(activityDate);
    }, [activeTab, activityDate]);
    
    // WA numbers state
    const [allWaNumbers, setAllWaNumbers] = useState([]);

    // Tag dropdown UI state
    const [tagSearch, setTagSearch] = useState('');
    const [tagPanelOpen, setTagPanelOpen] = useState(false);
    const tagPanelRef = useRef(null);

    // User Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [editingUser, setEditingUser] = useState(null);
    const [formData, setFormData] = useState({
        name: '',
        whatsapp: '',
        pin: '',
        role: 'Recruiter',
        status: 'Active',
        allowed_crm_projects: [],
        allowed_labels: [],
        allowed_wa_numbers: []
    });

    // Role Modal State
    const [isRoleModalOpen, setIsRoleModalOpen] = useState(false);
    const [editingRole, setEditingRole] = useState(null);
    const [roleFormData, setRoleFormData] = useState({
        name: '',
        permissions: {}
    });

    // Tag Manager inline state
    const [_tagManagerOpen, _setTagManagerOpen] = useState(false);
    const [_editingTagIndex, setEditingTagIndex] = useState(null);
    const [newTagName, setNewTagName] = useState('');
    const [newTagColor, setNewTagColor] = useState('#3b82f6');
    const [_savingTag, setSavingTag] = useState(false);

    const TAG_PALETTE = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#8b5cf6','#ec4899','#06b6d4','#14b8a6','#64748b'];

    const loadData = async () => {
        setLoading(true);
        try {
            const [usersRes, rolesRes, manualRes, tagsRes, waRes] = await Promise.all([
                fetch('/api/users'),
                fetch('/api/roles'),
                fetch('/api/manual_projects'),
                fetch('/api/tags'),
                fetch('/api/wa-numbers')
            ]);

            const usersData = await usersRes.json();
            const rolesData = await rolesRes.json();
            const manualData = await manualRes.json();
            const tagsData = await tagsRes.json();
            const waData = await waRes.json();

            if (usersData.success) setUsers(usersData.users);
            if (rolesData.success) setRoles(rolesData.roles);
            if (manualData.success && manualData.data) setAllManualProjects(manualData.data);
            if (tagsData.success && tagsData.tags) setAllTags(tagsData.tags);
            if (waData.success && waData.numbers) setAllWaNumbers(waData.numbers);
        } catch {
            showToast('Error cargando datos', 'error');
        } finally {
            setLoading(false);
        }
    };

    // -------- TAG CRUD --------
    const saveTagsToApi = async (newTags) => {
        setSavingTag(true);
        try {
            const res = await fetch('/api/tags', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tags: newTags })
            });
            const data = await res.json();
            if (data.success) {
                setAllTags(newTags);
                showToast('Etiquetas guardadas', 'success');
            } else {
                showToast('Error al guardar etiquetas', 'error');
            }
        } catch {
            showToast('Error de conexión', 'error');
        } finally {
            setSavingTag(false);
        }
    };

    const _handleCreateTag = async () => {
        const trimmed = newTagName.trim();
        if (!trimmed) return;
        if (allTags.some(t => (typeof t === 'string' ? t : t.name).toLowerCase() === trimmed.toLowerCase())) {
            showToast('Ya existe una etiqueta con ese nombre', 'error');
            return;
        }
        const newTags = [...allTags, { name: trimmed, color: newTagColor }];
        await saveTagsToApi(newTags);
        setNewTagName('');
        setNewTagColor('#3b82f6');
    };

    const _handleUpdateTag = async (index) => {
        const trimmed = newTagName.trim();
        if (!trimmed) return;
        const updated = allTags.map((t, i) => {
            if (i !== index) return t;
            return { name: trimmed, color: newTagColor };
        });
        await saveTagsToApi(updated);
        setEditingTagIndex(null);
        setNewTagName('');
        setNewTagColor('#3b82f6');
    };

    const _handleDeleteTag = async (index) => {
        const tagName = typeof allTags[index] === 'string' ? allTags[index] : allTags[index].name;
        const ok = await showConfirm({
            title: 'Eliminar Etiqueta',
            message: `¿Eliminar la etiqueta "${tagName}"? Se eliminará de todos los candidatos que la tengan.`,
            confirmText: 'Eliminar',
            variant: 'danger'
        });
        if (!ok) return;
        const updated = allTags.filter((_, i) => i !== index);
        await saveTagsToApi(updated);
    };

    const _startEditTag = (index) => {
        const t = allTags[index];
        setEditingTagIndex(index);
        setNewTagName(typeof t === 'string' ? t : t.name);
        setNewTagColor(typeof t === 'string' ? '#3b82f6' : (t.color || '#3b82f6'));
    };

    useEffect(() => {
        loadData();
        const _refreshTags = () => fetch('/api/tags').then(r => r.json()).then(d => { if (d.success && d.tags) setAllTags(d.tags); }).catch(() => {});
    }, []);

    // Close tag dropdown on outside click
    useEffect(() => {
        if (!tagPanelOpen) return;
        const handleClick = (e) => {
            if (tagPanelRef.current && !tagPanelRef.current.contains(e.target)) {
                setTagPanelOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [tagPanelOpen]);

    // -------- USER LOGIC --------
    // Helper: get permissions object for a given role name
    const getRolePermissions = (roleName) => {
        const role = roles.find(r => r.name === roleName);
        return role?.permissions || {};
    };

    const handleOpenModal = (user = null) => {
        setTagSearch('');
        setTagPanelOpen(false);
        if (user) {
            setEditingUser(user);
            setFormData({
                name: user.name,
                whatsapp: user.whatsapp || '',
                pin: user.pin || '',
                role: user.role,
                status: user.status,
                allowed_crm_projects: user.allowed_crm_projects || [],
                allowed_labels: user.allowed_labels || [],
                allowed_wa_numbers: user.allowed_wa_numbers || [],
                can_manage_tags: user.can_manage_tags || false
            });
        } else {
            setEditingUser(null);
            setFormData({
                name: '',
                whatsapp: '',
                pin: '',
                role: roles.length > 0 ? roles[0].name : 'Recruiter',
                status: 'Active',
                allowed_crm_projects: [],
                allowed_labels: [],
                allowed_wa_numbers: []
            });
        }
        setIsModalOpen(true);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            const method = editingUser ? 'PUT' : 'POST';
            // Ensure the user ID is always present for PUT — use whatsapp as fallback
            const userId = editingUser?.id || editingUser?.whatsapp;
            const body = editingUser ? { ...formData, id: userId, whatsapp: formData.whatsapp || editingUser.whatsapp } : formData;

            const res = await fetch('/api/users', {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            const data = await res.json();
            if (data.success) {
                showToast(editingUser ? 'Usuario actualizado' : 'Usuario creado', 'success');
                setIsModalOpen(false);
                loadData();
            } else {
                showToast(data.error || 'Error al guardar', 'error');
            }
        } catch {
            showToast('Error de conexión', 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id) => {
        const ok = await showConfirm({
            title: 'Eliminar Usuario',
            message: '¿Estás seguro de que deseas eliminar este usuario? Esta acción no se puede deshacer.',
            confirmText: 'Eliminar',
            variant: 'danger'
        });
        if (!ok) return;
        try {
            const res = await fetch(`/api/users?id=${id}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
                showToast('Usuario eliminado', 'success');
                loadData();
            }
        } catch {
            showToast('Error al eliminar', 'error');
        }
    };

    // -------- ROLE LOGIC --------
    const handleOpenRoleModal = (role = null) => {
        if (role) {
            setEditingRole(role);
            setRoleFormData({
                name: role.name,
                permissions: role.permissions || {}
            });
        } else {
            setEditingRole(null);
            const defaultPerms = {};
            AVAILABLE_SECTIONS.forEach(s => defaultPerms[s.id] = false);
            AVAILABLE_CHAT_FILTERS.forEach(f => defaultPerms[f.id] = false);
            setRoleFormData({
                name: '',
                permissions: defaultPerms
            });
        }
        setIsRoleModalOpen(true);
    };

    const handleRoleSubmit = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            const method = editingRole ? 'PUT' : 'POST';
            const body = editingRole ? { ...roleFormData, id: editingRole.id } : roleFormData;

            const res = await fetch('/api/roles', {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            const data = await res.json();
            if (data.success) {
                showToast(editingRole ? 'Rol actualizado' : 'Rol creado', 'success');
                setIsRoleModalOpen(false);
                loadData();
            } else {
                showToast(data.error || 'Error al guardar rol', 'error');
            }
        } catch {
            showToast('Error de conexión', 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleRoleDelete = async (id) => {
        const ok = await showConfirm({
            title: 'Eliminar Rol',
            message: '¿Estás seguro de que deseas eliminar este rol? Los usuarios asignados perderán sus permisos.',
            confirmText: 'Eliminar',
            variant: 'danger'
        });
        if (!ok) return;
        try {
            const res = await fetch(`/api/roles?id=${id}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
                showToast('Rol eliminado', 'success');
                loadData();
            } else {
                showToast('Error al eliminar rol', 'error');
            }
        } catch {
            showToast('Error de conexión', 'error');
        }
    };

    const togglePermission = (sectionId) => {
        setRoleFormData(prev => ({
            ...prev,
            permissions: {
                ...prev.permissions,
                [sectionId]: !prev.permissions[sectionId]
            }
        }));
    };

    // User-level assignment toggles
    const toggleUserCrmProject = (projectId) => {
        setFormData(prev => {
            const current = prev.allowed_crm_projects || [];
            const next = current.includes(projectId)
                ? current.filter(id => id !== projectId)
                : [...current, projectId];
            return { ...prev, allowed_crm_projects: next };
        });
    };

    const toggleUserLabel = (labelName) => {
        setFormData(prev => {
            const current = prev.allowed_labels || [];
            const next = current.includes(labelName)
                ? current.filter(n => n !== labelName)
                : [...current, labelName];
            return { ...prev, allowed_labels: next };
        });
    };

    const toggleUserWaNumber = (numberId) => {
        setFormData(prev => {
            const current = prev.allowed_wa_numbers || [];
            const next = current.includes(numberId)
                ? current.filter(id => id !== numberId)
                : [...current, numberId];
            return { ...prev, allowed_wa_numbers: next };
        });
    };

    const filteredUsers = users.filter(u =>
        (u.name || '').toLowerCase().includes(search.toLowerCase()) ||
        (u.whatsapp || '').includes(search)
    );

    const filteredRoles = roles.filter(r => 
        (r.name || '').toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="space-y-6">
            {/* Header: Command Bar Style */}
            <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 flex flex-col md:flex-row items-center justify-between gap-4 min-h-[82px]">
                <div className="flex items-center space-x-4">
                    <div className="w-10 h-10 rounded-2xl bg-blue-600 shadow-lg shadow-blue-500/20 flex items-center justify-center transition-all">
                        {activeTab === 'users' ? <User className="w-5 h-5 text-white" /> : <ShieldCheck className="w-5 h-5 text-white" />}
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white leading-tight uppercase tracking-tight">EQUIPO Y ACCESOS</h2>
                        <div className="flex items-center gap-2 mt-0.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>
                            <p className="text-[10px] font-black tracking-widest uppercase text-blue-600 dark:text-blue-400">GESTIÓN DE PERSONAL Y ROLES</p>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Button onClick={loadData} icon={RefreshCw} variant="outline" size="sm" disabled={loading} />
                    {activeTab === 'users' ? (
                        <Button onClick={() => handleOpenModal()} icon={UserPlus} className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-[10px] font-black uppercase tracking-widest">
                            Nuevo Usuario
                        </Button>
                    ) : (
                        <Button onClick={() => handleOpenRoleModal()} icon={Shield} className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-[10px] font-black uppercase tracking-widest">
                            Nuevo Rol
                        </Button>
                    )}
                </div>
            </div>

            <div className="flex space-x-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl w-fit">
                <button
                    onClick={() => setActiveTab('users')}
                    className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                        activeTab === 'users'
                            ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
                            : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                    }`}
                >
                    Usuarios
                </button>
                <button
                    onClick={() => setActiveTab('roles')}
                    className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                        activeTab === 'roles'
                            ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
                            : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                    }`}
                >
                    Roles y Permisos
                </button>
                <button
                    onClick={() => setActiveTab('activity')}
                    className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-1.5 ${
                        activeTab === 'activity'
                            ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
                            : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                    }`}
                >
                    <BarChart2 className="w-3.5 h-3.5" />
                    Actividad
                </button>
            </div>

            <Card>
                <div className="p-4 border-b border-gray-100 dark:border-gray-700/50 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="relative w-full md:w-96">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                            type="search"
                            placeholder={activeTab === 'users' ? "Buscar por nombre o teléfono..." : "Buscar por nombre de rol..."}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-gray-200 dark:focus:ring-gray-700/50 focus:outline-none dark:text-white text-xs font-medium"
                        />
                    </div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                        Total: {activeTab === 'users' ? users.length : roles.length}
                    </div>
                </div>
                
                <div className="overflow-x-auto">
                    {loading ? (
                        <div className="p-12 text-center">
                            <Loader2 className="w-8 h-8 animate-spin mx-auto text-blue-600 mb-4" />
                            <p className="text-gray-500">Cargando...</p>
                        </div>
                    ) : activeTab === 'users' ? (
                        /* ----------- TABLA DE USUARIOS ----------- */
                        filteredUsers.length === 0 ? (
                            <div className="p-12 text-center text-gray-500 uppercase text-xs tracking-wider">
                                No se encontraron usuarios
                            </div>
                        ) : (
                            <table className="w-full text-left">
                                <thead className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-700">
                                    <tr>
                                        <th className="py-4 px-6 font-semibold text-gray-700 dark:text-gray-300 text-sm">Usuario</th>
                                        <th className="py-4 px-6 font-semibold text-gray-700 dark:text-gray-300 text-sm">WhatsApp</th>
                                        <th className="py-4 px-6 font-semibold text-gray-700 dark:text-gray-300 text-sm">Rol</th>
                                        <th className="py-4 px-6 font-semibold text-gray-700 dark:text-gray-300 text-sm">Estado</th>
                                        <th className="py-4 px-6 font-semibold text-gray-700 dark:text-gray-300 text-sm text-right">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
                                    {filteredUsers.map(user => (
                                        <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors">
                                            <td className="py-4 px-6">
                                                <div className="flex items-center space-x-3">
                                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${user.role === 'SuperAdmin' ? 'bg-purple-100 text-purple-600 dark:bg-purple-900 dark:text-purple-300' :
                                                        'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                                                        }`}>
                                                        {(user.name || 'U').charAt(0).toUpperCase()}
                                                    </div>
                                                    <div>
                                                        <p className="font-bold text-gray-900 dark:text-white text-sm">{user.name}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="py-4 px-6 text-sm text-gray-700 dark:text-gray-300">
                                                {user.whatsapp}
                                            </td>
                                            <td className="py-4 px-6">
                                                <span className="flex items-center space-x-1.5 text-sm">
                                                    <Shield className={`w-3.5 h-3.5 ${user.role === 'SuperAdmin' ? 'text-purple-500' : 'text-blue-500'}`} />
                                                    <span className="text-gray-700 dark:text-gray-300">{user.role}</span>
                                                </span>
                                            </td>
                                            <td className="py-4 px-6">
                                                <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${user.status === 'Active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                                    {user.status === 'Active' ? 'Activo' : 'Inactivo'}
                                                </span>
                                            </td>
                                            <td className="py-4 px-6 text-right">
                                                <div className="flex items-center justify-end space-x-2">
                                                    <button onClick={() => handleOpenModal(user)} className="p-2 text-gray-400 hover:text-blue-500 transition-colors">
                                                        <Pencil className="w-4 h-4" />
                                                    </button>
                                                    {user.role !== 'SuperAdmin' && (
                                                        <button onClick={() => handleDelete(user.id)} className="p-2 text-gray-400 hover:text-red-500 transition-colors" title="Eliminar usuario">
                                                            <Trash2 className="w-4 h-4" />
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )
                    ) : (
                        /* ----------- TABLA DE ROLES ----------- */
                        filteredRoles.length === 0 ? (
                            <div className="p-12 text-center text-gray-500 uppercase text-xs tracking-wider">
                                No se encontraron roles
                            </div>
                        ) : (
                            <table className="w-full text-left">
                                <thead className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-700">
                                    <tr>
                                        <th className="py-4 px-6 font-semibold text-gray-700 dark:text-gray-300 text-sm">Nombre del Rol</th>
                                        <th className="py-4 px-6 font-semibold text-gray-700 dark:text-gray-300 text-sm">Secciones Permitidas</th>
                                        <th className="py-4 px-6 font-semibold text-gray-700 dark:text-gray-300 text-sm text-right">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
                                    {filteredRoles.map(role => {
                                        const activeCount = Object.values(role.permissions || {}).filter(Boolean).length;
                                        return (
                                            <tr key={role.id} className="hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors">
                                                <td className="py-4 px-6">
                                                    <div className="flex items-center space-x-2">
                                                        <ShieldCheck className={`w-5 h-5 ${role.name === 'SuperAdmin' ? 'text-purple-500' : 'text-blue-500'}`} />
                                                        <span className="font-bold text-gray-900 dark:text-white">{role.name}</span>
                                                    </div>
                                                </td>
                                                <td className="py-4 px-6 text-sm">
                                                    <span className="px-2 py-1 rounded bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 text-xs font-bold">
                                                        {activeCount} de {AVAILABLE_SECTIONS.length}
                                                    </span>
                                                </td>
                                                <td className="py-4 px-6 text-right">
                                                    <div className="flex items-center justify-end space-x-2">
                                                        <button onClick={() => handleOpenRoleModal(role)} className="p-2 text-gray-400 hover:text-blue-500 transition-colors">
                                                            <Pencil className="w-4 h-4" />
                                                        </button>
                                                        {role.name !== 'SuperAdmin' && (
                                                            <button onClick={() => handleRoleDelete(role.id)} className="p-2 text-gray-400 hover:text-red-500 transition-colors" title="Eliminar rol">
                                                                <Trash2 className="w-4 h-4" />
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )
                    )}
                </div>
            </Card>

            {/* ----------- ACTIVITY TAB ----------- */}
            {activeTab === 'activity' && (
                <Card>
                    <div className="p-4 border-b border-gray-100 dark:border-gray-700/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                            <h3 className="text-sm font-bold text-gray-900 dark:text-white">Actividad de Reclutadores</h3>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Estadísticas diarias de todos los usuarios</p>
                        </div>
                        <div className="flex items-center gap-2">
                            <input
                                type="date"
                                value={activityDate}
                                onChange={e => setActivityDate(e.target.value)}
                                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            <button onClick={() => loadActivityStats(activityDate)} className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                                <RefreshCw className={`w-3.5 h-3.5 text-gray-500 ${activityLoading ? 'animate-spin' : ''}`} />
                            </button>
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        {activityLoading ? (
                            <div className="flex items-center justify-center py-12">
                                <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                            </div>
                        ) : activityStats.length === 0 ? (
                            <div className="text-center py-12 text-gray-400 dark:text-gray-500 text-sm">
                                Sin actividad registrada para este día
                            </div>
                        ) : (
                            <table className="w-full text-left">
                                <thead>
                                    <tr className="border-b border-gray-100 dark:border-gray-700/50">
                                        {['Reclutador', 'Tiempo activo', 'Chats visitados', 'Chats respondidos', 'Mensajes enviados', 'Dentro 24h ✅', 'Fuera 24h ⛔'].map(label => (
                                            <th key={label} className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 whitespace-nowrap">
                                                {label}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50 dark:divide-gray-700/30">
                                    {activityStats.map((s) => (
                                        <tr key={s.userId} className="hover:bg-gray-50 dark:hover:bg-gray-700/20 transition-colors">
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-white text-[11px] font-bold shrink-0">
                                                        {s.userName.charAt(0).toUpperCase()}
                                                    </div>
                                                    <div>
                                                        <p className="text-sm font-semibold text-gray-900 dark:text-white">{s.userName}</p>
                                                        <p className="text-[10px] text-gray-400">{s.role}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className="flex items-center gap-1 text-sm font-mono font-semibold text-gray-700 dark:text-gray-200">
                                                    <Clock className="w-3.5 h-3.5 text-blue-400" />
                                                    {s.timeHuman}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className="flex items-center gap-1 text-sm font-semibold text-gray-700 dark:text-gray-200">
                                                    <MessageSquare className="w-3.5 h-3.5 text-gray-400" />
                                                    {s.chatsVisited}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className="flex items-center gap-1 text-sm font-semibold text-gray-700 dark:text-gray-200">
                                                    <MessageSquare className="w-3.5 h-3.5 text-indigo-400" />
                                                    {s.chatsResponded}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">{s.messagesSent}</span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs font-bold">
                                                    <CheckCircle className="w-3 h-3" />
                                                    {s.chatsIn24h}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-xs font-bold">
                                                    <XCircle className="w-3 h-3" />
                                                    {s.chatsOut24h}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </Card>
            )}

            {/* ----------- USER MODAL ----------- */}
            <Modal
                isOpen={isModalOpen}
                onClose={() => { setIsModalOpen(false); setTagPanelOpen(false); }}
                title={editingUser ? 'Editar Usuario' : 'Nuevo Usuario'}
                maxWidth="max-w-4xl"
            >
                <form onSubmit={handleSubmit} className="flex flex-col gap-0">
                    {/* ── Datos básicos ── */}
                    <div className="px-6 pt-4 pb-5 space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <Input
                                label="Nombre Completo"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                required
                                placeholder="Ej: Oscar Rodriguez"
                            />
                            <Input
                                label="WhatsApp"
                                value={formData.whatsapp}
                                onChange={(e) => setFormData({ ...formData, whatsapp: e.target.value })}
                                required
                                placeholder="Ej: 5218116038195"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <Select
                                label="Rol"
                                value={formData.role}
                                onChange={(val) => setFormData({ ...formData, role: val })}
                                options={roles.map(r => ({ value: r.name, label: r.name }))}
                                placeholder="Seleccionar rol..."
                            />
                            <Select
                                label="Estado"
                                value={formData.status}
                                onChange={(val) => setFormData({ ...formData, status: val })}
                                options={[
                                    { value: 'Active', label: 'Activo', color: '#10b981' },
                                    { value: 'Inactive', label: 'Inactivo', color: '#ef4444' }
                                ]}
                                placeholder="Estado..."
                            />
                        </div>
                    </div>

                    {/* ── Accesos y permisos ── */}
                    {formData.role && formData.role !== 'SuperAdmin' && (() => {
                        const perms = getRolePermissions(formData.role);
                        const hasNoneLabels = (formData.allowed_labels || []).includes('__none__');
                        const selectedLabels = (formData.allowed_labels || []).filter(l => l !== '__none__');
                        const filteredTags = allTags.filter(t => {
                            const name = typeof t === 'string' ? t : t.name;
                            return name.toLowerCase().includes(tagSearch.toLowerCase());
                        });
                        const allTagNames = allTags.map(t => typeof t === 'string' ? t : t.name);
                        const allSelected = allTagNames.length > 0 && allTagNames.every(n => selectedLabels.includes(n));
                        const hasNoneWA = (formData.allowed_wa_numbers || []).length === 0;

                        return (
                            <div className="border-t border-gray-100 dark:border-gray-700">
                                {/* Header de sección */}
                                <div className="px-6 py-3 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-100 dark:border-gray-700">
                                    <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest">Accesos y permisos</p>
                                </div>

                                <div className="px-6 py-5 grid grid-cols-1 md:grid-cols-3 gap-5">
                                    {/* ── Proyectos CRM ── */}
                                    {!!perms['filter_crm'] && allManualProjects.length > 0 && (
                                        <div className="flex flex-col gap-2">
                                            <div>
                                                <h4 className="text-sm font-bold text-gray-800 dark:text-white">📋 Proyectos CRM</h4>
                                                <p className="text-[10px] text-gray-400 mt-0.5">Sin selección = todos. "Ninguno" = acceso cero.</p>
                                            </div>
                                            <div className="rounded-xl border border-purple-200 dark:border-purple-800 bg-purple-50/40 dark:bg-purple-900/10 overflow-hidden">
                                                {/* Sel. todos / Quitar todos */}
                                                {(() => {
                                                    const allProjIds = allManualProjects.map(p => p.id);
                                                    const hasNoneP = (formData.allowed_crm_projects || []).includes('__none__');
                                                    const allProjSelected = allProjIds.length > 0 && allProjIds.every(id => (formData.allowed_crm_projects || []).includes(id));
                                                    return (
                                                        <div className={`flex items-center justify-between px-3 py-2 bg-purple-100/60 dark:bg-purple-900/30 border-b border-purple-200 dark:border-purple-800 ${hasNoneP ? 'opacity-40 pointer-events-none' : ''}`}>
                                                            <span className="text-[10px] font-bold text-purple-600 dark:text-purple-400 uppercase tracking-wide">Proyectos</span>
                                                            <button
                                                                type="button"
                                                                onClick={() => setFormData(f => ({ ...f, allowed_crm_projects: allProjSelected ? [] : allProjIds }))}
                                                                className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-purple-200 dark:bg-purple-800 text-purple-700 dark:text-purple-300 hover:bg-purple-300 dark:hover:bg-purple-700 transition-colors"
                                                            >
                                                                {allProjSelected ? 'Quitar todos' : 'Sel. todos'}
                                                            </button>
                                                        </div>
                                                    );
                                                })()}
                                                {/* Ninguno */}
                                                <label className="flex items-center gap-2.5 px-3 py-2 border-b border-purple-200 dark:border-purple-800 cursor-pointer hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors">
                                                    <input
                                                        type="checkbox"
                                                        checked={(formData.allowed_crm_projects || []).includes('__none__')}
                                                        onChange={() => {
                                                            const hasNone = (formData.allowed_crm_projects || []).includes('__none__');
                                                            setFormData(f => ({ ...f, allowed_crm_projects: hasNone ? [] : ['__none__'] }));
                                                        }}
                                                        className="w-3.5 h-3.5 text-purple-600 rounded"
                                                    />
                                                    <span className="text-xs font-bold text-purple-700 dark:text-purple-300 select-none">🚫 Ninguno</span>
                                                </label>
                                                {/* Lista de proyectos */}
                                                <div className="divide-y divide-purple-100 dark:divide-purple-900/40">
                                                    {allManualProjects.map(proj => (
                                                        <label key={proj.id} className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-purple-50 dark:hover:bg-purple-900/10 transition-colors ${(formData.allowed_crm_projects || []).includes('__none__') ? 'opacity-40 pointer-events-none' : ''}`}>
                                                            <input
                                                                type="checkbox"
                                                                checked={(formData.allowed_crm_projects || []).includes(proj.id)}
                                                                onChange={() => toggleUserCrmProject(proj.id)}
                                                                disabled={(formData.allowed_crm_projects || []).includes('__none__')}
                                                                className="w-3.5 h-3.5 text-purple-600 rounded"
                                                            />
                                                            <span className="text-xs font-medium text-gray-800 dark:text-gray-300 select-none truncate">{proj.name}</span>
                                                        </label>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* ── Etiquetas (dropdown con search) ── */}
                                    {!!perms['filter_labels'] && (
                                        <div className="flex flex-col gap-2">
                                            <div>
                                                <h4 className="text-sm font-bold text-gray-800 dark:text-white">🏷️ Etiquetas Visibles</h4>
                                                <p className="text-[10px] text-gray-400 mt-0.5">Sin selección = todas. "Ninguna" = acceso cero.</p>
                                            </div>
                                            <div className="relative" ref={tagPanelRef}>
                                                {/* Trigger button */}
                                                <button
                                                    type="button"
                                                    onClick={() => setTagPanelOpen(o => !o)}
                                                    className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border border-amber-200 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-900/10 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors text-left"
                                                >
                                                    <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">
                                                        {hasNoneLabels
                                                            ? '🚫 Sin acceso por etiqueta'
                                                            : selectedLabels.length === 0
                                                                ? '✅ Todas las etiquetas'
                                                                : `${selectedLabels.length} etiqueta${selectedLabels.length !== 1 ? 's' : ''} seleccionada${selectedLabels.length !== 1 ? 's' : ''}`
                                                        }
                                                    </span>
                                                    <svg className={`w-3.5 h-3.5 text-amber-500 transition-transform shrink-0 ${tagPanelOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                                                </button>

                                                {/* Dropdown panel */}
                                                {tagPanelOpen && (
                                                    <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded-xl border border-amber-200 dark:border-amber-700 bg-white dark:bg-gray-900 shadow-xl overflow-hidden">
                                                        {/* Search + select all — FIRST */}
                                                        <div className={`px-2 py-2 border-b border-gray-100 dark:border-gray-700 flex gap-2 ${hasNoneLabels ? 'opacity-40 pointer-events-none' : ''}`}>
                                                            <div className="relative flex-1">
                                                                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                                                                <input
                                                                    type="text"
                                                                    value={tagSearch}
                                                                    onChange={e => setTagSearch(e.target.value)}
                                                                    placeholder="Buscar etiqueta..."
                                                                    className="w-full pl-6 pr-2 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-amber-400"
                                                                />
                                                            </div>
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    if (allSelected) {
                                                                        setFormData(f => ({ ...f, allowed_labels: [] }));
                                                                    } else {
                                                                        setFormData(f => ({ ...f, allowed_labels: allTagNames }));
                                                                    }
                                                                }}
                                                                className="px-2 py-1 text-[10px] font-bold rounded-lg bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors whitespace-nowrap"
                                                            >
                                                                {allSelected ? 'Quitar todas' : 'Sel. todas'}
                                                            </button>
                                                        </div>

                                                        {/* Ninguna — second */}
                                                        <label className="flex items-center gap-2.5 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-100 dark:border-amber-800 cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors">
                                                            <input
                                                                type="checkbox"
                                                                checked={hasNoneLabels}
                                                                onChange={() => {
                                                                    setFormData(f => ({ ...f, allowed_labels: hasNoneLabels ? [] : ['__none__'] }));
                                                                }}
                                                                className="w-3.5 h-3.5 text-amber-600 rounded"
                                                            />
                                                            <span className="text-xs font-bold text-amber-700 dark:text-amber-300 select-none">🚫 Ninguna etiqueta</span>
                                                        </label>

                                                        {/* Scrollable list — 6 items visible */}
                                                        <div className={`overflow-y-auto divide-y divide-gray-50 dark:divide-gray-800 ${hasNoneLabels ? 'opacity-40 pointer-events-none' : ''}`} style={{ maxHeight: '156px' }}>
                                                            {filteredTags.length === 0 ? (
                                                                <p className="px-3 py-3 text-xs text-gray-400 text-center">Sin resultados</p>
                                                            ) : filteredTags.map(tagObj => {
                                                                const tName = typeof tagObj === 'string' ? tagObj : tagObj.name;
                                                                const tColor = typeof tagObj === 'string' ? '#3b82f6' : tagObj.color;
                                                                return (
                                                                    <label key={tName} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-amber-50 dark:hover:bg-amber-900/10 transition-colors">
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={selectedLabels.includes(tName)}
                                                                            onChange={() => toggleUserLabel(tName)}
                                                                            className="w-3.5 h-3.5 text-amber-600 rounded"
                                                                        />
                                                                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tColor }}></span>
                                                                        <span className="text-xs font-medium text-gray-800 dark:text-gray-300 select-none truncate">{tName}</span>
                                                                    </label>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            {/* ¿Puede editar etiquetas? */}
                                            <div className="flex items-center justify-between px-3 py-2.5 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-900/10">
                                                <div>
                                                    <p className="text-xs font-semibold text-gray-800 dark:text-white">✏️ ¿Puede editar etiquetas?</p>
                                                    <p className="text-[10px] text-gray-400 mt-0.5">Crear, editar y eliminar etiquetas.</p>
                                                </div>
                                                <div className="relative shrink-0">
                                                    <select
                                                        value={formData.can_manage_tags ? 'yes' : 'no'}
                                                        onChange={(e) => setFormData(f => ({ ...f, can_manage_tags: e.target.value === 'yes' }))}
                                                        className="appearance-none pl-3 pr-7 py-1.5 text-xs font-bold bg-white dark:bg-gray-800 border border-amber-300 dark:border-amber-700 rounded-lg focus:ring-2 focus:ring-amber-400 focus:outline-none cursor-pointer text-gray-800 dark:text-gray-200"
                                                    >
                                                        <option value="no">🚫 No</option>
                                                        <option value="yes">✅ Sí</option>
                                                    </select>
                                                    <div className="pointer-events-none absolute inset-y-0 right-1.5 flex items-center">
                                                        <svg className="w-3 h-3 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* ── Números WhatsApp ── */}
                                    <div className="flex flex-col gap-2">
                                        <div>
                                            <h4 className="text-sm font-bold text-gray-800 dark:text-white">📱 Números WhatsApp</h4>
                                            <p className="text-[10px] text-gray-400 mt-0.5">Sin selección = ve todos. Marca solo los que debe ver.</p>
                                        </div>
                                        <div className="rounded-xl border border-green-200 dark:border-green-800 bg-green-50/40 dark:bg-green-900/10 overflow-hidden">
                                            {/* Todos */}
                                            <label className="flex items-center gap-2.5 px-3 py-2.5 bg-green-100/60 dark:bg-green-900/30 border-b border-green-200 dark:border-green-800 cursor-pointer hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors">
                                                <input
                                                    type="checkbox"
                                                    checked={hasNoneWA}
                                                    onChange={() => setFormData(f => ({ ...f, allowed_wa_numbers: [] }))}
                                                    className="w-3.5 h-3.5 text-green-600 rounded"
                                                />
                                                <span className="text-xs font-bold text-green-700 dark:text-green-300 select-none">✅ Todos los números</span>
                                            </label>
                                            {/* Lista de números WA */}
                                            {allWaNumbers.length === 0 ? (
                                                <p className="px-3 py-3 text-[10px] text-gray-400">Sin números configurados aún.</p>
                                            ) : (
                                                <div className="divide-y divide-green-100 dark:divide-green-900/30">
                                                    {allWaNumbers.map(num => (
                                                        <label key={num.id} className={`flex items-center gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-green-50 dark:hover:bg-green-900/10 transition-colors ${hasNoneWA ? '' : ''}`}>
                                                            <input
                                                                type="checkbox"
                                                                checked={(formData.allowed_wa_numbers || []).includes(num.id)}
                                                                onChange={() => toggleUserWaNumber(num.id)}
                                                                className="w-3.5 h-3.5 text-green-600 rounded"
                                                            />
                                                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: num.color || '#25d366' }}></span>
                                                            <div className="min-w-0">
                                                                <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate">{num.label}</p>
                                                                <p className="text-[10px] text-gray-400 truncate">{num.phone}</p>
                                                            </div>
                                                        </label>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })()}

                    {/* ── Footer ── */}
                    <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-700 flex justify-end gap-3 bg-gray-50/50 dark:bg-gray-800/30 rounded-b-xl">
                        <Button variant="outline" type="button" onClick={() => { setIsModalOpen(false); setTagPanelOpen(false); }} disabled={saving}>
                            Cancelar
                        </Button>
                        <Button type="submit" disabled={saving}>
                            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : editingUser ? 'Actualizar' : 'Crear Usuario'}
                        </Button>
                    </div>
                </form>
            </Modal>

            {/* ----------- ROLE MODAL ----------- */}
            <Modal
                isOpen={isRoleModalOpen}
                onClose={() => setIsRoleModalOpen(false)}
                title={editingRole ? 'Editar Rol' : 'Nuevo Rol'}
            >
                <form onSubmit={handleRoleSubmit} className="space-y-4 pt-2">
                    <Input
                        label="Nombre del Rol"
                        value={roleFormData.name}
                        onChange={(e) => setRoleFormData({ ...roleFormData, name: e.target.value })}
                        required
                        placeholder="Ej: Manager"
                        disabled={editingRole && editingRole.name === 'SuperAdmin'}
                    />

                    <div>
                        <h4 className="text-xs font-bold text-gray-800 dark:text-white mb-2">Permisos de Secciones</h4>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 p-1.5 border border-gray-100 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800/50">
                            {AVAILABLE_SECTIONS.map(section => (
                                <label key={section.id} className="flex items-center space-x-2 cursor-pointer px-2 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                                    <input
                                        type="checkbox"
                                        checked={!!roleFormData.permissions[section.id]}
                                        onChange={() => togglePermission(section.id)}
                                        disabled={editingRole && editingRole.name === 'SuperAdmin'}
                                        className="w-3.5 h-3.5 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600"
                                    />
                                    <span className="text-xs font-medium text-gray-900 dark:text-gray-300 select-none">
                                        {section.name}
                                    </span>
                                </label>
                            ))}
                        </div>
                    </div>

                    <div>
                        <h4 className="text-xs font-bold text-gray-800 dark:text-white mb-2">Filtros de Chat (Quiénes puede ver)</h4>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 p-1.5 border border-gray-100 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800/50">
                            {AVAILABLE_CHAT_FILTERS.map(filter => (
                                <label key={filter.id} className="flex items-center space-x-2 cursor-pointer px-2 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                                    <input
                                        type="checkbox"
                                        checked={!!roleFormData.permissions[filter.id]}
                                        onChange={() => togglePermission(filter.id)}
                                        disabled={editingRole && editingRole.name === 'SuperAdmin'}
                                        className="w-3.5 h-3.5 text-purple-600 bg-gray-100 border-gray-300 rounded focus:ring-purple-500 dark:bg-gray-700 dark:border-gray-600"
                                    />
                                    <span className="text-xs font-medium text-gray-900 dark:text-gray-300 select-none">
                                        {filter.name}
                                    </span>
                                </label>
                            ))}
                        </div>
                    </div>

                    <div>
                        <h4 className="text-xs font-bold text-gray-800 dark:text-white mb-2">Permisos Extra</h4>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 p-1.5 border border-gray-100 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800/50">
                            {AVAILABLE_EXTRA_PERMS.map(perm => (
                                <label key={perm.id} className="flex items-center space-x-2 cursor-pointer px-2 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                                    <input
                                        type="checkbox"
                                        checked={!!roleFormData.permissions[perm.id]}
                                        onChange={() => togglePermission(perm.id)}
                                        disabled={editingRole && editingRole.name === 'SuperAdmin'}
                                        className="w-3.5 h-3.5 text-amber-600 bg-gray-100 border-gray-300 rounded focus:ring-amber-500 dark:bg-gray-700 dark:border-gray-600"
                                    />
                                    <span className="text-xs font-medium text-gray-900 dark:text-gray-300 select-none">
                                        {perm.name}
                                    </span>
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* Nota: Los proyectos/pipelines específicos se asignan por usuario, no por rol */}

                    <div className="flex justify-end space-x-3 pt-4">
                        <Button variant="outline" type="button" onClick={() => setIsRoleModalOpen(false)} disabled={saving}>
                            Cancelar
                        </Button>
                        <Button type="submit" disabled={saving || (editingRole && editingRole.name === 'SuperAdmin')}>
                            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : editingRole ? 'Actualizar Rol' : 'Crear Rol'}
                        </Button>
                    </div>
                </form>
            </Modal>
            {confirmModalJSX}
        </div>
    );
};

export default UsersSection;
