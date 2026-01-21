import React, { useState, useEffect } from 'react';
import { Send, Users, MessageSquare, CheckSquare, Square, Loader2, AlertCircle } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import { getCandidates } from '../services/candidatesService';

/**
 * Sección de Envío Masivo (Bulks)
 */
const BulksSection = ({ showToast }) => {
    const [candidates, setCandidates] = useState([]);
    const [loading, setLoading] = useState(false);
    const [sending, setSending] = useState(false);
    const [selectedIds, setSelectedIds] = useState([]);
    const [message, setMessage] = useState('');
    const [credentials, setCredentials] = useState(null);

    useEffect(() => {
        loadCandidates();
        const savedCreds = localStorage.getItem('builderbot_credentials');
        if (savedCreds) setCredentials(JSON.parse(savedCreds));
    }, []);

    const loadCandidates = async () => {
        setLoading(true);
        try {
            const result = await getCandidates(200, 0); // Traer suficientes candidatos
            if (result.success) {
                setCandidates(result.candidates);
            }
        } catch (error) {
            showToast('Error cargando candidatos', 'error');
        } finally {
            setLoading(false);
        }
    };

    const toggleSelect = (id) => {
        setSelectedIds(prev =>
            prev.includes(id)
                ? prev.filter(i => i !== id)
                : [...prev, id]
        );
    };

    const toggleSelectAll = () => {
        if (selectedIds.length === candidates.length) {
            setSelectedIds([]);
        } else {
            setSelectedIds(candidates.map(c => c.id));
        }
    };

    const handleBulkSend = async () => {
        if (selectedIds.length === 0) {
            showToast('Selecciona al menos un candidato', 'warning');
            return;
        }
        if (!message.trim()) {
            showToast('Escribe un mensaje', 'warning');
            return;
        }
        if (!credentials) {
            showToast('Configura las credenciales en Settings primero', 'error');
            return;
        }

        if (!window.confirm(`¿Estás seguro de enviar este mensaje a ${selectedIds.length} candidatos?`)) {
            return;
        }

        setSending(true);
        let successCount = 0;
        let failCount = 0;

        for (const id of selectedIds) {
            try {
                const res = await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        candidateId: id,
                        message: message,
                        botId: credentials.botId,
                        apiKey: credentials.apiKey
                    })
                });

                if (res.ok) successCount++;
                else failCount++;
            } catch (error) {
                failCount++;
            }
        }

        setSending(false);
        showToast(`Envío completado: ${successCount} exitosos, ${failCount} fallidos`, successCount > 0 ? 'success' : 'error');
        if (successCount > 0) {
            setMessage('');
            setSelectedIds([]);
        }
    };

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Panel de Mensaje */}
                <div className="lg:col-span-1 space-y-4">
                    <Card title="Redactar Mensaje Masivo">
                        <div className="space-y-4 p-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    Contenido del Mensaje
                                </label>
                                <textarea
                                    value={message}
                                    onChange={(e) => setMessage(e.target.value)}
                                    placeholder="Escribe el mensaje para enviar a todos los candidatos seleccionados..."
                                    className="w-full h-40 px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                                />
                            </div>

                            <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg flex items-start space-x-2">
                                <AlertCircle className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                                <p className="text-xs text-blue-700 dark:text-blue-300 italic">
                                    Nota: Los mensajes se enviarán uno por uno. Evita enviar demasiados mensajes en poco tiempo para prevenir el bloqueo de WhatsApp.
                                </p>
                            </div>

                            <Button
                                onClick={handleBulkSend}
                                icon={sending ? Loader2 : Send}
                                disabled={sending || selectedIds.length === 0}
                                className="w-full"
                            >
                                {sending ? 'Enviando...' : `Enviar a ${selectedIds.length} seleccionados`}
                            </Button>
                        </div>
                    </Card>
                </div>

                {/* Lista de Selección */}
                <div className="lg:col-span-2">
                    <Card
                        title="Seleccionar Destinatarios"
                        extra={
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={toggleSelectAll}
                                icon={selectedIds.length === candidates.length ? CheckSquare : Square}
                            >
                                {selectedIds.length === candidates.length ? 'Desmarcar Todos' : 'Seleccionar Todos'}
                            </Button>
                        }
                    >
                        <div className="overflow-hidden">
                            {loading ? (
                                <div className="p-12 text-center">
                                    <Loader2 className="w-8 h-8 animate-spin mx-auto text-blue-600 mb-4" />
                                    <p className="text-gray-500">Cargando candidatos...</p>
                                </div>
                            ) : candidates.length === 0 ? (
                                <div className="p-12 text-center">
                                    <Users className="w-12 h-12 mx-auto text-gray-300 mb-4" />
                                    <p className="text-gray-500">No hay candidatos para mostrar</p>
                                </div>
                            ) : (
                                <div className="max-h-[600px] overflow-y-auto">
                                    <table className="w-full text-left bg-transparent">
                                        <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800 z-10 border-b border-gray-100 dark:border-gray-700">
                                            <tr>
                                                <th className="py-3 px-4 w-10"></th>
                                                <th className="py-3 px-4 font-semibold text-gray-700 dark:text-gray-300">Nombre</th>
                                                <th className="py-3 px-4 font-semibold text-gray-700 dark:text-gray-300">WhatsApp</th>
                                                <th className="py-3 px-4 font-semibold text-gray-700 dark:text-gray-300 text-center">Último contacto</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {candidates.map((candidate) => (
                                                <tr
                                                    key={candidate.id}
                                                    onClick={() => toggleSelect(candidate.id)}
                                                    className={`
                                                        border-b border-gray-100 dark:border-gray-700 cursor-pointer smooth-transition
                                                        ${selectedIds.includes(candidate.id) ? 'bg-blue-50 dark:bg-blue-900/10' : 'hover:bg-gray-50 dark:hover:bg-gray-900'}
                                                    `}
                                                >
                                                    <td className="py-3 px-4">
                                                        {selectedIds.includes(candidate.id) ? (
                                                            <CheckSquare className="w-5 h-5 text-blue-600" />
                                                        ) : (
                                                            <Square className="w-5 h-5 text-gray-300" />
                                                        )}
                                                    </td>
                                                    <td className="py-3 px-4">
                                                        <span className="font-medium text-gray-900 dark:text-white">
                                                            {candidate.nombre}
                                                        </span>
                                                    </td>
                                                    <td className="py-3 px-4">
                                                        <span className="text-gray-600 dark:text-gray-400 font-mono text-sm">
                                                            {candidate.whatsapp}
                                                        </span>
                                                    </td>
                                                    <td className="py-3 px-4 text-center">
                                                        <span className="text-xs text-gray-500">
                                                            {candidate.ultimoMensaje ? new Date(candidate.ultimoMensaje).toLocaleDateString() : '-'}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </Card>
                </div>
            </div>
        </div>
    );
};

export default BulksSection;
