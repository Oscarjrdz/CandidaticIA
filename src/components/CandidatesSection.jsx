import React, { useState, useEffect } from 'react';
import { Users, Search, Trash2, RefreshCw, User } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import { getCandidates, deleteCandidate, CandidatesSubscription } from '../services/candidatesService';

/**
 * Sección de Candidatos
 */
const CandidatesSection = ({ showToast }) => {
    const [candidates, setCandidates] = useState([]);
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState('');
    const [lastUpdate, setLastUpdate] = useState(null);

    useEffect(() => {
        // Cargar candidatos al montar
        loadCandidates();

        // Polling cada 10 segundos
        const subscription = new CandidatesSubscription((newCandidates) => {
            setCandidates(newCandidates);
            setLastUpdate(new Date());
        }, 10000);

        subscription.start();

        return () => {
            subscription.stop();
        };
    }, []);

    const loadCandidates = async () => {
        setLoading(true);
        const result = await getCandidates(50, 0, search);

        if (result.success) {
            setCandidates(result.candidates);
            setLastUpdate(new Date());
        } else {
            showToast('Error cargando candidatos', 'error');
        }

        setLoading(false);
    };

    const handleSearch = (e) => {
        setSearch(e.target.value);
    };

    const handleSearchSubmit = (e) => {
        e.preventDefault();
        loadCandidates();
    };

    const handleDelete = async (id, nombre) => {
        if (!window.confirm(`¿Eliminar candidato ${nombre}?`)) {
            return;
        }

        const result = await deleteCandidate(id);

        if (result.success) {
            showToast('Candidato eliminado correctamente', 'success');
            loadCandidates();
        } else {
            showToast(`Error: ${result.error}`, 'error');
        }
    };

    const formatPhone = (phone) => {
        // Formatear número de teléfono
        if (phone.startsWith('52')) {
            return `+${phone.slice(0, 2)} ${phone.slice(2, 5)} ${phone.slice(5, 8)} ${phone.slice(8)}`;
        }
        return phone;
    };

    const formatDate = (dateString) => {
        if (!dateString) return '-';
        const date = new Date(dateString);
        const now = new Date();
        const diff = now - date;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (minutes < 1) return 'Ahora';
        if (minutes < 60) return `Hace ${minutes}m`;
        if (hours < 24) return `Hace ${hours}h`;
        if (days < 7) return `Hace ${days}d`;
        return date.toLocaleDateString();
    };

    return (
        <div className="space-y-6">
            {/* Header con búsqueda */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center">
                            <Users className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                                Candidatos
                            </h2>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                {candidates.length} candidato{candidates.length !== 1 ? 's' : ''} registrado{candidates.length !== 1 ? 's' : ''}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center space-x-2">
                        {lastUpdate && (
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                                Actualizado: {lastUpdate.toLocaleTimeString()}
                            </span>
                        )}
                        <Button
                            onClick={loadCandidates}
                            icon={RefreshCw}
                            variant="outline"
                            size="sm"
                            disabled={loading}
                        >
                            {loading ? 'Cargando...' : 'Refrescar'}
                        </Button>
                    </div>
                </div>

                {/* Búsqueda */}
                <form onSubmit={handleSearchSubmit} className="flex items-center space-x-2">
                    <div className="flex-1 relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <input
                            type="text"
                            value={search}
                            onChange={handleSearch}
                            placeholder="Buscar por nombre o número..."
                            className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                    </div>
                    <Button type="submit" size="sm">
                        Buscar
                    </Button>
                </form>
            </div>

            {/* Tabla de candidatos */}
            <Card>
                <div className="overflow-x-auto">
                    {candidates.length === 0 ? (
                        <div className="text-center py-12">
                            <User className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                            <p className="text-gray-500 dark:text-gray-400">
                                {search ? 'No se encontraron candidatos' : 'No hay candidatos registrados aún'}
                            </p>
                            <p className="text-sm text-gray-400 dark:text-gray-500 mt-2">
                                Los candidatos se agregarán automáticamente cuando recibas mensajes de WhatsApp
                            </p>
                        </div>
                    ) : (
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-gray-200 dark:border-gray-700">
                                    <th className="text-left py-4 px-4 font-semibold text-gray-700 dark:text-gray-300">Foto</th>
                                    <th className="text-left py-4 px-4 font-semibold text-gray-700 dark:text-gray-300">Nombre</th>
                                    <th className="text-left py-4 px-4 font-semibold text-gray-700 dark:text-gray-300">WhatsApp</th>
                                    <th className="text-left py-4 px-4 font-semibold text-gray-700 dark:text-gray-300">Último Mensaje</th>
                                    <th className="text-center py-4 px-4 font-semibold text-gray-700 dark:text-gray-300">Mensajes</th>
                                    <th className="text-center py-4 px-4 font-semibold text-gray-700 dark:text-gray-300">Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {candidates.map((candidate) => (
                                    <tr
                                        key={candidate.id}
                                        className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900 smooth-transition"
                                    >
                                        <td className="py-4 px-4">
                                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-semibold">
                                                {candidate.foto ? (
                                                    <img
                                                        src={candidate.foto}
                                                        alt={candidate.nombre}
                                                        className="w-10 h-10 rounded-full object-cover"
                                                    />
                                                ) : (
                                                    <span>{candidate.nombre.charAt(0).toUpperCase()}</span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="py-4 px-4">
                                            <div className="font-medium text-gray-900 dark:text-white">
                                                {candidate.nombre}
                                            </div>
                                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                                Desde {formatDate(candidate.primerContacto)}
                                            </div>
                                        </td>
                                        <td className="py-4 px-4">
                                            <div className="text-sm text-gray-700 dark:text-gray-300 font-mono">
                                                {formatPhone(candidate.whatsapp)}
                                            </div>
                                        </td>
                                        <td className="py-4 px-4">
                                            <div className="text-sm text-gray-600 dark:text-gray-400">
                                                {formatDate(candidate.ultimoMensaje)}
                                            </div>
                                        </td>
                                        <td className="py-4 px-4 text-center">
                                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                                                {candidate.totalMensajes}
                                            </span>
                                        </td>
                                        <td className="py-4 px-4 text-center">
                                            <button
                                                onClick={() => handleDelete(candidate.id, candidate.nombre)}
                                                className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg smooth-transition group"
                                                title="Eliminar candidato"
                                            >
                                                <Trash2 className="w-4 h-4 text-gray-400 group-hover:text-red-600 dark:group-hover:text-red-400" />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </Card>
        </div>
    );
};

export default CandidatesSection;
