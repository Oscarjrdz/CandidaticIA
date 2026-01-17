import React, { useState, useEffect, useRef } from 'react';
import { Bot, FileText, Upload, Trash2, Save, RefreshCw, File } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import { getCredentials } from '../utils/storage';

const AssistantSection = ({ showToast }) => {
    const [credentials, setCredentials] = useState(null);
    const [activeTab, setActiveTab] = useState('prompt'); // 'prompt' | 'files'

    // Prompt State
    const [instructions, setInstructions] = useState('');
    const [loadingPrompt, setLoadingPrompt] = useState(false);
    const [savingPrompt, setSavingPrompt] = useState(false);

    // Files State
    const [files, setFiles] = useState([]);
    const [loadingFiles, setLoadingFiles] = useState(false);
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef(null);

    useEffect(() => {
        const creds = getCredentials();
        if (creds && creds.botId && creds.answerId && creds.apiKey) {
            setCredentials(creds);
            // Load initial data based on simplified logic (maybe just prompt first)
            fetchInstructions(creds);
        }
    }, []);

    useEffect(() => {
        if (credentials && activeTab === 'files') {
            fetchFiles();
        }
    }, [activeTab, credentials]);

    // --- PROMPT HANDLING ---

    const fetchInstructions = async (creds = credentials) => {
        if (!creds) return;
        setLoadingPrompt(true);
        try {
            const params = new URLSearchParams({
                botId: creds.botId,
                answerId: creds.answerId,
                apiKey: creds.apiKey,
                type: 'instructions'
            });

            const res = await fetch(`/api/assistant?${params}`);
            const data = await res.json();

            if (res.ok) {
                // Intentar extraer el texto limpio
                let rawInstructions = '';
                if (typeof data === 'string') {
                    rawInstructions = data;
                } else if (data && data.instructions) {
                    rawInstructions = data.instructions;
                } else if (data && data.data && data.data.instructions) {
                    rawInstructions = data.data.instructions;
                } else {
                    // Fallback: Si no encontramos 'instructions', mostramos JSON pero intentamos limpiar
                    rawInstructions = JSON.stringify(data, null, 2);
                }

                // Si el texto parece ser un JSON stringified que contiene "instructions", intentamos parsearlo de nuevo
                try {
                    if (rawInstructions.trim().startsWith('{') && rawInstructions.includes('"instructions"')) {
                        const parsed = JSON.parse(rawInstructions);
                        if (parsed.instructions) rawInstructions = parsed.instructions;
                    }
                } catch (e) {
                    // Ignorar error de parseo
                }

                setInstructions(rawInstructions);
            } else {
                showToast(data.error || 'Error cargando instrucciones', 'error');
            }
        } catch (error) {
            console.error(error);
            showToast('Error de conexión', 'error');
        } finally {
            setLoadingPrompt(false);
        }
    };

    const handleSavePrompt = async () => {
        if (!credentials) return;
        setSavingPrompt(true);
        try {
            const params = new URLSearchParams({
                botId: credentials.botId,
                answerId: credentials.answerId,
                apiKey: credentials.apiKey,
                type: 'instructions'
            });

            const res = await fetch(`/api/assistant?${params}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ instructions })
            });

            const data = await res.json();

            if (res.ok) {
                showToast('Instrucciones actualizadas correctamente', 'success');
            } else {
                showToast(data.error || 'Error guardando instrucciones', 'error');
            }
        } catch (error) {
            showToast('Error de conexión', 'error');
        } finally {
            setSavingPrompt(false);
        }
    };

    // --- FILES HANDLING ---

    const fetchFiles = async () => {
        if (!credentials) return;
        setLoadingFiles(true);
        try {
            const params = new URLSearchParams({
                botId: credentials.botId,
                answerId: credentials.answerId,
                apiKey: credentials.apiKey,
                type: 'files'
            });

            const res = await fetch(`/api/assistant?${params}`);
            const data = await res.json();

            if (res.ok) {
                // Asumimos que data es un array de archivos o contiene un array
                // Docs: GET /files -> lista
                setFiles(Array.isArray(data) ? data : (data.files || []));
            } else {
                showToast(data.error || 'Error cargando archivos', 'error');
            }
        } catch (error) {
            showToast('Error de conexión', 'error');
        } finally {
            setLoadingFiles(false);
        }
    };

    const handleFileUpload = async (e) => {
        const file = e.target.files[0];
        if (!file || !credentials) return;

        setUploading(true);
        const formData = new FormData();
        formData.append('file', file);

        try {
            const params = new URLSearchParams({
                botId: credentials.botId,
                answerId: credentials.answerId,
                apiKey: credentials.apiKey,
                type: 'files'
            });

            const res = await fetch(`/api/assistant?${params}`, {
                method: 'POST',
                body: formData
            });

            const data = await res.json();

            if (res.ok) {
                showToast('Archivo subido correctamente', 'success');
                fetchFiles();
                if (fileInputRef.current) fileInputRef.current.value = '';
            } else {
                showToast(data.error || 'Error subiendo archivo', 'error');
            }
        } catch (error) {
            showToast('Error de conexión', 'error');
        } finally {
            setUploading(false);
        }
    };

    const handleDeleteFile = async (fileId) => {
        if (!credentials || !window.confirm('¿Seguro de eliminar este archivo?')) return;

        try {
            const params = new URLSearchParams({
                botId: credentials.botId,
                answerId: credentials.answerId,
                apiKey: credentials.apiKey,
                type: 'files',
                fileId
            });

            const res = await fetch(`/api/assistant?${params}`, {
                method: 'DELETE'
            });

            if (res.ok) {
                showToast('Archivo eliminado', 'success');
                fetchFiles();
            } else {
                const data = await res.json();
                showToast(data.error || 'Error eliminando archivo', 'error');
            }
        } catch (error) {
            showToast('Error de conexión', 'error');
        }
    };

    if (!credentials) {
        return (
            <Card title="Configuración de Asistente" icon={Bot}>
                <div className="text-center py-8 text-gray-500">
                    <p>Por favor, configure las credenciales (Bot ID, Answer ID, API Key) en la sección de Settings primero.</p>
                </div>
            </Card>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header / Tabs */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
                <div className="flex items-center space-x-3 mb-6">
                    <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900 rounded-lg flex items-center justify-center">
                        <Bot className="w-6 h-6 text-purple-600 dark:text-purple-300" />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                            Gestión del Asistente IA
                        </h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                            Bot ID: <span className="font-mono text-xs">{credentials.botId}</span>
                        </p>
                    </div>
                </div>

                <div className="flex space-x-2 border-b border-gray-200 dark:border-gray-700">
                    <button
                        onClick={() => setActiveTab('prompt')}
                        className={`pb-3 px-4 font-medium text-sm transition-colors relative ${activeTab === 'prompt'
                            ? 'text-blue-600 dark:text-blue-400'
                            : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                            }`}
                    >
                        Instrucciones (Prompt)
                        {activeTab === 'prompt' && (
                            <div className="absolute bottom-0 left-0 w-full h-0.5 bg-blue-600 dark:bg-blue-400 rounded-t-full" />
                        )}
                    </button>
                    <button
                        onClick={() => setActiveTab('files')}
                        className={`pb-3 px-4 font-medium text-sm transition-colors relative ${activeTab === 'files'
                            ? 'text-blue-600 dark:text-blue-400'
                            : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                            }`}
                    >
                        Base de Conocimiento (Archivos)
                        {activeTab === 'files' && (
                            <div className="absolute bottom-0 left-0 w-full h-0.5 bg-blue-600 dark:bg-blue-400 rounded-t-full" />
                        )}
                    </button>
                </div>
            </div>

            {/* Content Area */}
            {activeTab === 'prompt' ? (
                <Card>
                    <div className="space-y-4">
                        <div className="flex justify-between items-center">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                Prompt del Sistema
                            </label>
                            <Button
                                size="sm"
                                variant="outline"
                                icon={RefreshCw}
                                onClick={() => fetchInstructions()}
                                disabled={loadingPrompt}
                            >
                                Recargar
                            </Button>
                        </div>

                        {loadingPrompt ? (
                            <div className="h-64 flex items-center justify-center bg-gray-50 dark:bg-gray-900 rounded-lg animate-pulse">
                                <span className="text-gray-400">Cargando instrucciones...</span>
                            </div>
                        ) : (
                            <textarea
                                value={instructions}
                                onChange={(e) => setInstructions(e.target.value)}
                                className="w-full h-96 p-4 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent font-sans text-sm leading-relaxed resize-y"
                                placeholder="Escribe aquí las instrucciones para tu asistente..."
                            />
                        )}

                        <div className="flex justify-end">
                            <Button
                                onClick={handleSavePrompt}
                                loading={savingPrompt}
                                icon={Save}
                                disabled={loadingPrompt}
                            >
                                Guardar Cambios
                            </Button>
                        </div>
                    </div>
                </Card>
            ) : (
                <Card>
                    <div className="space-y-6">
                        {/* Upload Area */}
                        <div className="border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-8 text-center hover:border-blue-500 dark:hover:border-blue-500 transition-colors bg-gray-50 dark:bg-gray-900/50">
                            <div className="mx-auto w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mb-4">
                                <Upload className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                            </div>
                            <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-1">
                                Subir nuevo archivo
                            </h3>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                                PDF, TXT, DOCX, etc. Máximo 10MB.
                            </p>

                            <input
                                ref={fileInputRef}
                                type="file"
                                onChange={handleFileUpload}
                                className="hidden"
                                id="file-upload"
                                disabled={uploading}
                            />

                            <label
                                htmlFor="file-upload"
                                className={`inline-flex items-center px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 cursor-pointer transition-colors ${uploading ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                                {uploading ? 'Subiendo...' : 'Seleccionar Archivo'}
                            </label>
                        </div>

                        {/* Files List */}
                        <div>
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                                    Archivos Cargados ({files.length})
                                </h3>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    icon={RefreshCw}
                                    onClick={fetchFiles}
                                    disabled={loadingFiles}
                                >
                                    Refrescar
                                </Button>
                            </div>

                            {loadingFiles ? (
                                <div className="space-y-3">
                                    {[1, 2, 3].map(i => (
                                        <div key={i} className="h-16 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />
                                    ))}
                                </div>
                            ) : files.length === 0 ? (
                                <div className="text-center py-12 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
                                    <FileText className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
                                    <p className="text-gray-500 dark:text-gray-400">No hay archivos en la base de conocimiento</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 gap-3">
                                    {files.map((file, idx) => (
                                        <div key={file.id || idx} className="flex items-center justify-between p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:shadow-sm transition-shadow">
                                            <div className="flex items-center space-x-3">
                                                <div className="w-10 h-10 bg-orange-100 dark:bg-orange-900/30 rounded-lg flex items-center justify-center">
                                                    <File className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                                                </div>
                                                <div>
                                                    <p className="font-medium text-gray-900 dark:text-white truncate max-w-xs sm:max-w-md">
                                                        {file.filename || file.name || `Archivo ${idx + 1}`}
                                                    </p>
                                                    <p className="text-xs text-gray-500 font-mono">
                                                        ID: {file.id}
                                                    </p>
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => handleDeleteFile(file.id)}
                                                className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                                title="Eliminar archivo"
                                            >
                                                <Trash2 className="w-5 h-5" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </Card>
            )}
        </div>
    );
};

export default AssistantSection;
