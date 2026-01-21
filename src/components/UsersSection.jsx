import React, { useState, useEffect } from 'react';
import { UserPlus, Trash2, Pencil, Shield, Loader2, RefreshCw, Search, User } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import Modal from './ui/Modal';
import Input from './ui/Input';

const UsersSection = ({ showToast }) => {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [editingUser, setEditingUser] = useState(null);

    const [formData, setFormData] = useState({
        name: '',
        email: '',
        role: 'Recruiter',
        status: 'Active'
    });

    const loadUsers = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/users');
            const data = await res.json();
            if (data.success) {
                setUsers(data.users);
            }
        } catch {
            showToast('Error cargando usuarios', 'error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadUsers();
    }, []);

    const handleOpenModal = (user = null) => {
        if (user) {
            setEditingUser(user);
            setFormData({
                name: user.name,
                email: user.email,
                role: user.role,
                status: user.status
            });
        } else {
            setEditingUser(null);
            setFormData({
                name: '',
                email: '',
                role: 'Recruiter',
                status: 'Active'
            });
        }
        setIsModalOpen(true);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            const method = editingUser ? 'PUT' : 'POST';
            const body = editingUser ? { ...formData, id: editingUser.id } : formData;

            const res = await fetch('/api/users', {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            const data = await res.json();
            if (data.success) {
                showToast(editingUser ? 'Usuario actualizado' : 'Usuario creado', 'success');
                setIsModalOpen(false);
                loadUsers();
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
                loadUsers();
            }
        } catch {
            showToast('Error al eliminar', 'error');
        }
    };

    const filteredUsers = users.filter(u =>
        (u.name || '').toLowerCase().includes(search.toLowerCase()) ||
        (u.email || '').toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                        type="search"
                        placeholder="Buscar usuarios..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none dark:text-white text-sm"
                    />
                </div>
                <div className="flex items-center space-x-2">
                    <Button onClick={loadUsers} icon={RefreshCw} variant="outline" size="sm" disabled={loading} />
                    <Button onClick={() => handleOpenModal()} icon={UserPlus}>Nuevo Usuario</Button>
                </div>
            </div>

            <Card>
                <div className="overflow-x-auto">
                    {loading ? (
                        <div className="p-12 text-center">
                            <Loader2 className="w-8 h-8 animate-spin mx-auto text-blue-600 mb-4" />
                            <p className="text-gray-500">Cargando equipo...</p>
                        </div>
                    ) : filteredUsers.length === 0 ? (
                        <div className="p-12 text-center text-gray-500 uppercase text-xs tracking-wider">
                            No se encontraron usuarios
                        </div>
                    ) : (
                        <table className="w-full text-left">
                            <thead className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-700">
                                <tr>
                                    <th className="py-4 px-6 font-semibold text-gray-700 dark:text-gray-300 text-sm">Usuario</th>
                                    <th className="py-4 px-6 font-semibold text-gray-700 dark:text-gray-300 text-sm">Rol</th>
                                    <th className="py-4 px-6 font-semibold text-gray-700 dark:text-gray-300 text-sm">Estado</th>
                                    <th className="py-4 px-6 font-semibold text-gray-700 dark:text-gray-300 text-sm">Fecha Registro</th>
                                    <th className="py-4 px-6 font-semibold text-gray-700 dark:text-gray-300 text-sm text-right">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
                                {filteredUsers.map(user => (
                                    <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors">
                                        <td className="py-4 px-6">
                                            <div className="flex items-center space-x-3">
                                                <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-blue-600 dark:text-blue-300 font-bold">
                                                    {(user.name || 'U').charAt(0).toUpperCase()}
                                                </div>
                                                <div>
                                                    <p className="font-bold text-gray-900 dark:text-white text-sm">{user.name}</p>
                                                    <p className="text-xs text-gray-500">{user.email}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="py-4 px-6">
                                            <span className="flex items-center space-x-1.5 text-sm text-gray-700 dark:text-gray-300">
                                                <Shield className="w-3.5 h-3.5 text-indigo-500" />
                                                <span>{user.role}</span>
                                            </span>
                                        </td>
                                        <td className="py-4 px-6">
                                            <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${user.status === 'Active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                                                }`}>
                                                {user.status === 'Active' ? 'Activo' : 'Inactivo'}
                                            </span>
                                        </td>
                                        <td className="py-4 px-6 text-sm text-gray-500">
                                            {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}
                                        </td>
                                        <td className="py-4 px-6 text-right">
                                            <div className="flex items-center justify-end space-x-2">
                                                <button
                                                    onClick={() => handleOpenModal(user)}
                                                    className="p-2 text-gray-400 hover:text-blue-500 transition-colors"
                                                >
                                                    <Pencil className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(user.id)}
                                                    className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </Card>

            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title={editingUser ? 'Editar Usuario' : 'Nuevo Usuario'}
            >
                <form onSubmit={handleSubmit} className="space-y-4 pt-2">
                    <Input
                        label="Nombre Completo"
                        value={formData.name}
                        onChange={(v) => setFormData({ ...formData, name: v })}
                        required
                        placeholder="Ej: Juan Perez"
                    />
                    <Input
                        label="Correo Electrónico"
                        value={formData.email}
                        onChange={(v) => setFormData({ ...formData, email: v })}
                        required
                        type="email"
                        placeholder="ejemplo@candidatic.com"
                    />
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Rol</label>
                            <select
                                value={formData.role}
                                onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                            >
                                <option value="Recruiter">Reclutador</option>
                                <option value="Admin">Administrador</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Estado</label>
                            <select
                                value={formData.status}
                                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                            >
                                <option value="Active">Activo</option>
                                <option value="Inactive">Inactivo</option>
                            </select>
                        </div>
                    </div>

                    <div className="flex justify-end space-x-3 pt-4">
                        <Button variant="outline" onClick={() => setIsModalOpen(false)} disabled={saving}>
                            Cancelar
                        </Button>
                        <Button type="submit" disabled={saving}>
                            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : editingUser ? 'Actualizar' : 'Crear Usuario'}
                        </Button>
                    </div>
                </form>
            </Modal>
        </div>
    );
};

export default UsersSection;
