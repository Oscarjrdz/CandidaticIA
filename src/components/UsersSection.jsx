import React, { useState, useEffect, useRef } from 'react';
import { UserPlus, Trash2, Pencil, Shield, Loader2, RefreshCw, Search, User, ShieldCheck, Plus, Check, X, Tag } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import Modal from './ui/Modal';
import Input from './ui/Input';
import Select from './ui/Select';

const AVAILABLE_SECTIONS = [
    { id: 'settings', name: 'Configuración' },
    { id: 'candidates', name: 'Candidatos' },
    { id: 'chat', name: 'Chat Web' },
    { id: 'bot-ia', name: 'Bot IA' },
    { id: 'automations', name: 'Automatizaciones' },
    { id: 'vacancies', name: 'Vacantes' },
    { id: 'history', name: 'Historial' },
    { id: 'users', name: 'Usuarios' },
    { id: 'post-maker', name: 'Post Maker' },
    { id: 'media-library', name: 'Biblioteca Multimedia' },
    { id: 'projects', name: 'Proyectos' },
    { id: 'bypass', name: 'ByPass Intelligence' }
];

const AVAILABLE_CHAT_FILTERS = [
    { id: 'filter_todos', name: 'Todos' },
    { id: 'filter_complete', name: 'Perfil Completo' },
    { id: 'filter_incomplete', name: 'Incompletos' },
    { id: 'filter_labels', name: 'Etiquetas' },
    { id: 'filter_projects', name: 'Proyectos' },
    { id: 'filter_crm', name: 'CRM Manual' }
];

const AVAILABLE_EXTRA_PERMS = [
    { id: 'can_manage_tags', name: 'Crear / Editar Etiquetas' }
];

const UsersSection = ({ showToast }) => {
    const [activeTab, setActiveTab] = useState('users');
    const [users, setUsers] = useState([]);
    const [roles, setRoles] = useState([]);
    const [allProjects, setAllProjects] = useState([]);
    const [allManualProjects, setAllManualProjects] = useState([]);
    const [allTags, setAllTags] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    
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
        allowed_projects: [],
        allowed_crm_projects: [],
        allowed_labels: []
    });

    // Role Modal State
    const [isRoleModalOpen, setIsRoleModalOpen] = useState(false);
    const [editingRole, setEditingRole] = useState(null);
    const [roleFormData, setRoleFormData] = useState({
        name: '',
        permissions: {}
    });

    // Tag Manager inline state
    const [tagManagerOpen, setTagManagerOpen] = useState(false);
    const [editingTagIndex, setEditingTagIndex] = useState(null);
    const [newTagName, setNewTagName] = useState('');
    const [newTagColor, setNewTagColor] = useState('#3b82f6');
    const [savingTag, setSavingTag] = useState(false);

    const TAG_PALETTE = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#8b5cf6','#ec4899','#06b6d4','#14b8a6','#64748b'];

    const loadData = async () => {
        setLoading(true);
        try {
            const [usersRes, rolesRes, projRes, manualRes, tagsRes] = await Promise.all([
                fetch('/api/users'),
                fetch('/api/roles'),
                fetch('/api/projects'),
                fetch('/api/manual_projects'),
                fetch('/api/tags')
            ]);
            
            const usersData = await usersRes.json();
            const rolesData = await rolesRes.json();
            const projData = await projRes.json();
            const manualData = await manualRes.json();
            const tagsData = await tagsRes.json();
            
            if (usersData.success) setUsers(usersData.users);
            if (rolesData.success) setRoles(rolesData.roles);
            if (projData.success && projData.projects) setAllProjects(projData.projects);
            if (manualData.success && manualData.data) setAllManualProjects(manualData.data);
            if (tagsData.success && tagsData.tags) setAllTags(tagsData.tags);
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

    const handleCreateTag = async () => {
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

    const handleUpdateTag = async (index) => {
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

    const handleDeleteTag = async (index) => {
        const tagName = typeof allTags[index] === 'string' ? allTags[index] : allTags[index].name;
        if (!window.confirm(`¿Eliminar la etiqueta "${tagName}"?`)) return;
        const updated = allTags.filter((_, i) => i !== index);
        await saveTagsToApi(updated);
    };

    const startEditTag = (index) => {
        const t = allTags[index];
        setEditingTagIndex(index);
        setNewTagName(typeof t === 'string' ? t : t.name);
        setNewTagColor(typeof t === 'string' ? '#3b82f6' : (t.color || '#3b82f6'));
    };

    useEffect(() => {
        loadData();
    }, []);

    // -------- USER LOGIC --------
    // Helper: get permissions object for a given role name
    const getRolePermissions = (roleName) => {
        const role = roles.find(r => r.name === roleName);
        return role?.permissions || {};
    };

    const handleOpenModal = (user = null) => {
        if (user) {
            setEditingUser(user);
            setFormData({
                name: user.name,
                whatsapp: user.whatsapp || '',
                pin: user.pin || '',
                role: user.role,
                status: user.status,
                allowed_projects: user.allowed_projects || [],
                allowed_crm_projects: user.allowed_crm_projects || [],
                allowed_labels: user.allowed_labels || [],
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
                allowed_projects: [],
                allowed_crm_projects: [],
                allowed_labels: []
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
        if (!window.confirm('¿Estás seguro de eliminar este usuario?')) return;
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
        if (!window.confirm('¿Estás seguro de eliminar este rol?')) return;
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
    const toggleUserProject = (projectId) => {
        setFormData(prev => {
            const current = prev.allowed_projects || [];
            const next = current.includes(projectId)
                ? current.filter(id => id !== projectId)
                : [...current, projectId];
            return { ...prev, allowed_projects: next };
        });
    };

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
                                                        <p className="text-xs text-gray-500">PIN: {user.pin || '****'}</p>
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

            {/* ----------- USER MODAL ----------- */}
            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title={editingUser ? 'Editar Usuario' : 'Nuevo Usuario'}
                maxWidth="max-w-4xl"
            >
                <form onSubmit={handleSubmit} className="space-y-4 pt-2">
                    <Input
                        label="Nombre Completo"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        required
                        placeholder="Ej: Oscar Rodriguez"
                    />
                    <div className="grid grid-cols-2 gap-4">
                        <Input
                            label="WhatsApp"
                            value={formData.whatsapp}
                            onChange={(e) => setFormData({ ...formData, whatsapp: e.target.value })}
                            required
                            placeholder="Ej: 8116038195"
                        />
                        <Input
                            label="PIN de Autorización"
                            value={formData.pin}
                            onChange={(e) => setFormData({ ...formData, pin: e.target.value })}
                            required
                            maxLength={4}
                            placeholder="Ej: 1234"
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

                    {/* === ASIGNACIONES POR USUARIO === */}
                    {formData.role && formData.role !== 'SuperAdmin' && (() => {
                        const perms = getRolePermissions(formData.role);
                        return (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2 border-t border-gray-100 dark:border-gray-700">
                                {/* Proyectos AI asignados */}
                                {!!perms['filter_projects'] && allProjects.length > 0 && (
                                    <div>
                                        <h4 className="text-sm font-bold text-gray-800 dark:text-white mb-1">📂 Proyectos Asignados</h4>
                                        <p className="text-[10px] text-gray-400 mb-2">Sin selección = ver todos. Marca “Ninguno” para restringir a cero.</p>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 overflow-y-auto p-2 border border-blue-100 dark:border-blue-900 rounded-lg bg-blue-50/50 dark:bg-blue-900/10">
                                            {/* Opción Ninguno */}
                                            <label className="col-span-full flex items-center space-x-3 cursor-pointer p-2 rounded-lg bg-blue-100/60 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors border border-blue-200 dark:border-blue-800">
                                                <input
                                                    type="checkbox"
                                                    checked={(formData.allowed_projects || []).includes('__none__')}
                                                    onChange={() => {
                                                        const hasNone = (formData.allowed_projects || []).includes('__none__');
                                                        setFormData(f => ({ ...f, allowed_projects: hasNone ? [] : ['__none__'] }));
                                                    }}
                                                    className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600"
                                                />
                                                <span className="text-sm font-bold text-blue-700 dark:text-blue-300 select-none">🚫 Ninguno (sin acceso a proyectos)</span>
                                            </label>
                                            {/* Proyectos individuales (deshabilitados si está marcado Ninguno) */}
                                            {allProjects.map(proj => (
                                                <label key={proj.id} className={`flex items-center space-x-3 cursor-pointer p-2 rounded-lg hover:bg-blue-100/50 dark:hover:bg-blue-900/20 transition-colors ${ (formData.allowed_projects || []).includes('__none__') ? 'opacity-40 pointer-events-none' : ''}`}>
                                                    <input
                                                        type="checkbox"
                                                        checked={(formData.allowed_projects || []).includes(proj.id)}
                                                        onChange={() => toggleUserProject(proj.id)}
                                                        disabled={(formData.allowed_projects || []).includes('__none__')}
                                                        className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                                                    />
                                                    <span className="text-sm font-medium text-gray-900 dark:text-gray-300 select-none truncate">{proj.name}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Pipelines CRM Manual asignados */}
                                {!!perms['filter_crm'] && allManualProjects.length > 0 && (
                                    <div>
                                        <h4 className="text-sm font-bold text-gray-800 dark:text-white mb-1">📋 Pipelines CRM Asignados</h4>
                                        <p className="text-[10px] text-gray-400 mb-2">Sin selección = ver todos. Marca “Ninguno” para restringir a cero.</p>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 overflow-y-auto p-2 border border-purple-100 dark:border-purple-900 rounded-lg bg-purple-50/50 dark:bg-purple-900/10">
                                            {/* Opción Ninguno */}
                                            <label className="col-span-full flex items-center space-x-3 cursor-pointer p-2 rounded-lg bg-purple-100/60 dark:bg-purple-900/30 hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors border border-purple-200 dark:border-purple-800">
                                                <input
                                                    type="checkbox"
                                                    checked={(formData.allowed_crm_projects || []).includes('__none__')}
                                                    onChange={() => {
                                                        const hasNone = (formData.allowed_crm_projects || []).includes('__none__');
                                                        setFormData(f => ({ ...f, allowed_crm_projects: hasNone ? [] : ['__none__'] }));
                                                    }}
                                                    className="w-4 h-4 text-purple-600 bg-gray-100 border-gray-300 rounded focus:ring-purple-500 dark:bg-gray-700 dark:border-gray-600"
                                                />
                                                <span className="text-sm font-bold text-purple-700 dark:text-purple-300 select-none">🚫 Ninguno (sin acceso a pipelines)</span>
                                            </label>
                                            {allManualProjects.map(proj => (
                                                <label key={proj.id} className={`flex items-center space-x-3 cursor-pointer p-2 rounded-lg hover:bg-purple-100/50 dark:hover:bg-purple-900/20 transition-colors ${ (formData.allowed_crm_projects || []).includes('__none__') ? 'opacity-40 pointer-events-none' : ''}`}>
                                                    <input
                                                        type="checkbox"
                                                        checked={(formData.allowed_crm_projects || []).includes(proj.id)}
                                                        onChange={() => toggleUserCrmProject(proj.id)}
                                                        disabled={(formData.allowed_crm_projects || []).includes('__none__')}
                                                        className="w-4 h-4 text-purple-600 bg-gray-100 border-gray-300 rounded focus:ring-purple-500 dark:focus:ring-purple-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                                                    />
                                                    <span className="text-sm font-medium text-gray-900 dark:text-gray-300 select-none truncate">{proj.name}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Etiquetas visibles */}
                                {!!perms['filter_labels'] && (
                                    <div className="space-y-3">
                                        {/* Checkboxes de etiquetas visibles */}
                                        <div>
                                            <h4 className="text-sm font-bold text-gray-800 dark:text-white mb-1">🏷️ Etiquetas Visibles</h4>
                                            <p className="text-[10px] text-gray-400 mb-2">Sin selección = ver todas. Marca cuales puede ver o marca "Ninguna".</p>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 overflow-y-auto p-2 border border-amber-100 dark:border-amber-900 rounded-lg bg-amber-50/50 dark:bg-amber-900/10">
                                                {/* Opción Ninguna etiqueta */}
                                                <label className="col-span-full flex items-center space-x-3 cursor-pointer p-2 rounded-lg bg-amber-100/60 dark:bg-amber-900/30 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors border border-amber-200 dark:border-amber-800">
                                                    <input
                                                        type="checkbox"
                                                        checked={(formData.allowed_labels || []).includes('__none__')}
                                                        onChange={() => {
                                                            const hasNone = (formData.allowed_labels || []).includes('__none__');
                                                            setFormData(f => ({ ...f, allowed_labels: hasNone ? [] : ['__none__'] }));
                                                        }}
                                                        className="w-4 h-4 text-amber-600 bg-gray-100 border-gray-300 rounded focus:ring-amber-500 dark:bg-gray-700 dark:border-gray-600"
                                                    />
                                                    <span className="text-sm font-bold text-amber-700 dark:text-amber-300 select-none">🚫 Ninguna etiqueta (sin acceso por etiqueta)</span>
                                                </label>
                                                {/* Etiquetas individuales */}
                                                {allTags.map(tagObj => {
                                                    const tName = typeof tagObj === 'string' ? tagObj : tagObj.name;
                                                    const tColor = typeof tagObj === 'string' ? '#3b82f6' : tagObj.color;
                                                    const isDisabled = (formData.allowed_labels || []).includes('__none__');
                                                    return (
                                                        <label key={tName} className={`flex items-center space-x-3 cursor-pointer p-2 rounded-lg hover:bg-amber-100/50 dark:hover:bg-amber-900/20 transition-colors ${isDisabled ? 'opacity-40 pointer-events-none' : ''}`}>
                                                            <input
                                                                type="checkbox"
                                                                checked={(formData.allowed_labels || []).includes(tName)}
                                                                onChange={() => toggleUserLabel(tName)}
                                                                disabled={isDisabled}
                                                                className="w-4 h-4 text-amber-600 bg-gray-100 border-gray-300 rounded focus:ring-amber-500 dark:focus:ring-amber-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                                                            />
                                                            <span className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-gray-300 select-none truncate">
                                                                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: tColor }}></span>
                                                                {tName}
                                                            </span>
                                                        </label>
                                                    );
                                                })}
                                            </div>
                                        </div>

                                        {/* Permiso: ¿Puede editar etiquetas? */}
                                        <div className="flex items-center justify-between p-3 border border-amber-200 dark:border-amber-800 rounded-xl bg-amber-50/40 dark:bg-amber-900/10">
                                            <div>
                                                <p className="text-sm font-semibold text-gray-800 dark:text-white">✏️ ¿Puede editar etiquetas?</p>
                                                <p className="text-[10px] text-gray-400 mt-0.5">Permite crear, editar y eliminar etiquetas del sistema.</p>
                                            </div>
                                            <div className="relative">
                                                <select
                                                    value={formData.can_manage_tags ? 'yes' : 'no'}
                                                    onChange={(e) => setFormData(f => ({ ...f, can_manage_tags: e.target.value === 'yes' }))}
                                                    className="appearance-none pl-3 pr-8 py-2 text-sm font-bold bg-white dark:bg-gray-800 border border-amber-300 dark:border-amber-700 rounded-xl focus:ring-2 focus:ring-amber-400 focus:outline-none cursor-pointer text-gray-800 dark:text-gray-200"
                                                >
                                                    <option value="no">🚫 No puede</option>
                                                    <option value="yes">✅ Sí puede</option>
                                                </select>
                                                <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center">
                                                    <svg className="w-3.5 h-3.5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })()}

                    <div className="flex justify-end space-x-3 pt-4">
                        <Button variant="outline" type="button" onClick={() => setIsModalOpen(false)} disabled={saving}>
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
                        <h4 className="text-sm font-bold text-gray-800 dark:text-white mb-3">Permisos de Secciones</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-48 overflow-y-auto p-2 border border-gray-100 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800/50">
                            {AVAILABLE_SECTIONS.map(section => (
                                <label key={section.id} className="flex items-center space-x-3 cursor-pointer p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                                    <input
                                        type="checkbox"
                                        checked={!!roleFormData.permissions[section.id]}
                                        onChange={() => togglePermission(section.id)}
                                        disabled={editingRole && editingRole.name === 'SuperAdmin'}
                                        className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                                    />
                                    <span className="text-sm font-medium text-gray-900 dark:text-gray-300 select-none">
                                        {section.name}
                                    </span>
                                </label>
                            ))}
                        </div>
                    </div>

                    <div>
                        <h4 className="text-sm font-bold text-gray-800 dark:text-white mb-3">Filtros de Chat (Quiénes puede ver)</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-48 overflow-y-auto p-2 border border-gray-100 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800/50">
                            {AVAILABLE_CHAT_FILTERS.map(filter => (
                                <label key={filter.id} className="flex items-center space-x-3 cursor-pointer p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                                    <input
                                        type="checkbox"
                                        checked={!!roleFormData.permissions[filter.id]}
                                        onChange={() => togglePermission(filter.id)}
                                        disabled={editingRole && editingRole.name === 'SuperAdmin'}
                                        className="w-4 h-4 text-purple-600 bg-gray-100 border-gray-300 rounded focus:ring-purple-500 dark:focus:ring-purple-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                                    />
                                    <span className="text-sm font-medium text-gray-900 dark:text-gray-300 select-none">
                                        {filter.name}
                                    </span>
                                </label>
                            ))}
                        </div>
                    </div>

                    <div>
                        <h4 className="text-sm font-bold text-gray-800 dark:text-white mb-3">Permisos Extra</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-48 overflow-y-auto p-2 border border-gray-100 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800/50">
                            {AVAILABLE_EXTRA_PERMS.map(perm => (
                                <label key={perm.id} className="flex items-center space-x-3 cursor-pointer p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                                    <input
                                        type="checkbox"
                                        checked={!!roleFormData.permissions[perm.id]}
                                        onChange={() => togglePermission(perm.id)}
                                        disabled={editingRole && editingRole.name === 'SuperAdmin'}
                                        className="w-4 h-4 text-amber-600 bg-gray-100 border-gray-300 rounded focus:ring-amber-500 dark:focus:ring-amber-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                                    />
                                    <span className="text-sm font-medium text-gray-900 dark:text-gray-300 select-none">
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
        </div>
    );
};

export default UsersSection;
