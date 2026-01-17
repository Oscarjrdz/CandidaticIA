import React, { useState, useEffect, useRef } from 'react';
import { Bot, FileText, Upload, Trash2, Save, RefreshCw, File, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import { getCredentials } from '../utils/storage';

const AssistantSection = ({ showToast }) => {
    // Defensive: ensure showToast is always a function
    const safeShowToast = showToast || ((msg, type) => console.log(`[${type}] ${msg}`));

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
    const [uploadStatus, setUploadStatus] = useState('idle'); // 'idle' | 'uploading' | 'success' | 'error'
    const fileInputRef = useRef(null);

    // Batch Selection State
    const [selectedFiles, setSelectedFiles] = useState(new Set());
    const [selectAll, setSelectAll] = useState(false);
    const [deletingBatch, setDeletingBatch] = useState(false);

    useEffect(() => {
        const creds = getCredentials();
        if (creds && creds.botId && creds.answerId && creds.apiKey) {
            setCredentials(creds);
            // Load initial data based on simplified logic (maybe just prompt first)
            fetchInstructions(creds);
        }
    }, []);

    useEffect(() => {
        console.log('🔄 AssistantSection useEffect triggered:', {
            hasCredentials: !!credentials,
            activeTab,
            env: import.meta.env.MODE
        });

        if (credentials && activeTab === 'files') {
            console.log('📂 Loading files for tab...');
            fetchFiles().catch(err => {
                console.error('❌ Error loading files in useEffect:', err);
                safeShowToast('Error cargando archivos. Revisa la consola.', 'error');
            });
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
                // Función auxiliar para buscar recursivamente la key "instructions"
                const findInstructions = (obj) => {
                    if (!obj) return null;
                    if (typeof obj === 'string') return obj;

                    // 1. Chequeo directo
                    if (obj.instructions && typeof obj.instructions === 'string') {
                        return obj.instructions;
                    }

                    // 2. Si tiene propiedad 'data', buscar adentro primero (prioridad)
                    if (obj.data && typeof obj.data === 'object') {
                        const found = findInstructions(obj.data);
                        if (found) return found;
                    }

                    // 3. Buscar en todas las keys del objeto
                    if (typeof obj === 'object') {
                        for (const key in obj) {
                            if (key !== 'data' && typeof obj[key] === 'object') { // Evitar ciclo infinito con data si ya se revisó
                                const found = findInstructions(obj[key]);
                                if (found) return found;
                            }
                        }
                    }

                    return null;
                };

                let rawInstructions = findInstructions(data);

                // Si falló todo, y el objeto parece ser el wrapper simple, intentamos fallback manual
                if (!rawInstructions) {
                    if (data && data.data && data.data.instructions) rawInstructions = data.data.instructions;
                }

                // Si aún es nulo, mostrar string vacío en lugar de JSON crudo para no confundir, 
                // o el JSON solo si es error explícito
                if (!rawInstructions) {
                    console.warn('No se encontraron instrucciones en:', data);
                    // Último recurso: si es un objeto pequeño, quizás es el mensaje de error o status
                    if (data.error) rawInstructions = `Error: ${data.error}`;
                    else rawInstructions = ''; // Mejor vacío que código raro
                }

                setInstructions(rawInstructions);
            } else {
                safeShowToast(data.error || 'Error cargando instrucciones', 'error');
            }
        } catch (error) {
            console.error(error);
            safeShowToast('Error de conexión', 'error');
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
                safeShowToast('Instrucciones actualizadas correctamente', 'success');
            } else {
                safeShowToast(data.error || 'Error guardando instrucciones', 'error');
            }
        } catch (error) {
            safeShowToast('Error de conexión', 'error');
        } finally {
            setSavingPrompt(false);
        }
    };

    // --- FILES HANDLING ---

    const fetchFiles = async () => {
        if (!credentials) {
            console.warn('⚠️ fetchFiles called without credentials');
            return;
        }

        console.log('📥 Fetching files from API...', { botId: credentials.botId });
        setLoadingFiles(true);

        try {
            const params = new URLSearchParams({
                botId: credentials.botId,
                answerId: credentials.answerId,
                apiKey: credentials.apiKey,
                type: 'files'
            });

            const url = `/api/assistant?${params}`;
            console.log('🌐 API URL:', url.replace(credentials.apiKey, 'REDACTED'));

            const res = await fetch(url);
            console.log('📡 API Response:', { status: res.status, ok: res.ok, statusText: res.statusText });

            // Handle non-JSON responses gracefully
            let data;
            try {
                data = await res.json();
                console.log('📦 Parsed JSON data:', data);
            } catch (jsonError) {
                console.error('❌ Invalid JSON response:', jsonError);
                const textResponse = await res.text();
                console.error('📄 Raw response text:', textResponse);
                setFiles([]);
                setLoadingFiles(false);
                safeShowToast('Error: Respuesta inválida del servidor', 'error');
                return;
            }

            if (res.ok) {
                // Asumimos que data es un array de archivos o contiene un array
                const filesList = Array.isArray(data) ? data : (data.files || []);
                console.log('✅ Files loaded successfully:', filesList.length, 'files');
                setFiles(filesList);
            } else {
                console.error('❌ API returned error:', data);
                setFiles([]);
                safeShowToast(data.error || 'Error cargando archivos', 'error');
            }
        } catch (error) {
            console.error('❌ Fetch files error:', error);
            console.error('Error details:', {
                message: error.message,
                stack: error.stack,
                name: error.name
            });
            setFiles([]);
            safeShowToast(`Error de conexión: ${error.message}`, 'error');
        } finally {
            setLoadingFiles(false);
            console.log('🏁 fetchFiles completed');
        }
    };

    const handleFileUpload = async (e) => {
        // Soporte para evento de input o file direto (para drag & drop)
        const file = e.type === 'change' ? e.target.files[0] : e;
        if (!file || !credentials) return;

        setUploading(true);
        setUploadStatus('uploading');

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
                setUploadStatus('success');
                safeShowToast('Archivo subido correctamente', 'success');

                // Refresco inmediato
                fetchFiles();

                // Refresco con delay para dar tiempo al servidor (eventual consistency)
                setTimeout(() => {
                    fetchFiles();
                }, 2000);

                if (fileInputRef.current) fileInputRef.current.value = '';

                // Reset status after delay
                setTimeout(() => setUploadStatus('idle'), 3000);
            } else {
                setUploadStatus('error');
                // Mostrar detalles del error si existen
                const errorMsg = data.details ? `${data.error}: ${data.details}` : (data.error || 'Error subiendo archivo');
                safeShowToast(errorMsg, 'error');
                setTimeout(() => setUploadStatus('idle'), 3000);
            }
        } catch (error) {
            setUploadStatus('error');
            safeShowToast(`Error de conexión: ${error.message}`, 'error');
            setTimeout(() => setUploadStatus('idle'), 3000);
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
                safeShowToast('Archivo eliminado', 'success');
                fetchFiles();
            } else {
                const data = await res.json();
                safeShowToast(data.error || 'Error eliminando archivo', 'error');
            }
        } catch (error) {
            safeShowToast('Error de conexión', 'error');
        }
    };

    const handleSelectFile = (fileId) => {
        setSelectedFiles(prev => {
            const newSet = new Set(prev);
            if (newSet.has(fileId)) {
                newSet.delete(fileId);
            } else {
                newSet.add(fileId);
            }
            return newSet;
        });
    };

    const handleSelectAll = () => {
        if (selectAll) {
            setSelectedFiles(new Set());
            setSelectAll(false);
        } else {
            setSelectedFiles(new Set(files.map(f => f.id)));
            setSelectAll(true);
        }
    };

    const clearSelection = () => {
        setSelectedFiles(new Set());
        setSelectAll(false);
    };

    const handleBulkDelete = async () => {
        if (selectedFiles.size === 0) return;

        const count = selectedFiles.size;
        if (!window.confirm(`¿Seguro de eliminar ${count} archivo(s)?`)) return;

        setDeletingBatch(true);
        let successCount = 0;
        let errorCount = 0;

        try {
            // Delete files in parallel
            const deletePromises = Array.from(selectedFiles).map(async (fileId) => {
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
                        successCount++;
                        return { success: true, fileId };
                    } else {
                        errorCount++;
                        return { success: false, fileId };
                    }
                } catch (error) {
                    errorCount++;
                    return { success: false, fileId, error };
                }
            });

            await Promise.all(deletePromises);

            // Show results
            if (successCount > 0) {
                safeShowToast(`${successCount} archivo(s) eliminado(s) correctamente`, 'success');
            }
            if (errorCount > 0) {
                safeShowToast(`Error eliminando ${errorCount} archivo(s)`, 'error');
            }

            // Refresh and clear selection
            fetchFiles();
            clearSelection();
        } catch (error) {
            safeShowToast('Error en operación de borrado masivo', 'error');
        } finally {
            setDeletingBatch(false);
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
                        {/* Drag & Drop Upload Area */}
                        {(() => {
                            try {
                                return (
                                    <DragDropUpload
                                        fileInputRef={fileInputRef}
                                        handleFileUpload={handleFileUpload}
                                        uploading={uploading}
                                        uploadStatus={uploadStatus}
                                    />
                                );
                            } catch (error) {
                                console.error('❌ Error rendering DragDropUpload:', error);
                                return (
                                    <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                                        <p className="text-red-800 dark:text-red-400">Error cargando área de subida. Revisa la consola.</p>
                                    </div>
                                );
                            }
                        })()}

                        {/* Files List */}
                        <div>
                            <div className="flex justify-between items-center mb-4">
                                <div className="flex items-center space-x-3">
                                    {Array.isArray(files) && files.length > 0 && (
                                        <input
                                            type="checkbox"
                                            checked={selectAll}
                                            onChange={handleSelectAll}
                                            className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600 cursor-pointer"
                                            title="Seleccionar todos"
                                        />
                                    )}
                                    <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                                        Archivos Cargados ({Array.isArray(files) ? files.length : 0})
                                    </h3>
                                </div>
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

                            {/* Bulk Action Toolbar */}
                            {selectedFiles.size > 0 && (
                                <div className="sticky top-0 z-10 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 mb-4 animate-in slide-in-from-top duration-200">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
                                            {selectedFiles.size} archivo(s) seleccionado(s)
                                        </span>
                                        <div className="flex space-x-2">
                                            <Button size="sm" variant="outline" onClick={clearSelection}>
                                                Cancelar
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                icon={Trash2}
                                                onClick={handleBulkDelete}
                                                loading={deletingBatch}
                                                className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
                                            >
                                                Eliminar Seleccionados
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {loadingFiles ? (
                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2">
                                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(i => (
                                        <div key={i} className="h-14 bg-gray-100 dark:bg-gray-800 rounded-md animate-pulse" />
                                    ))}
                                </div>
                            ) : !Array.isArray(files) ? (
                                <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                                    <p className="text-yellow-800 dark:text-yellow-400">Error: Estado de archivos inválido. Intenta refrescar.</p>
                                </div>
                            ) : files.length === 0 ? (
                                <div className="text-center py-12 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
                                    <FileText className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
                                    <p className="text-gray-500 dark:text-gray-400">No hay archivos en la base de conocimiento</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2">
                                    {files.map((file, idx) => {
                                        try {
                                            // Defensive check for file object
                                            if (!file || typeof file !== 'object') {
                                                console.warn('⚠️ Invalid file object at index', idx, file);
                                                return null;
                                            }

                                            const fileId = file.id || `file-${idx}`;
                                            const fileName = file.filename || file.name || `Archivo ${idx + 1}`;

                                            return (
                                                <div
                                                    key={fileId}
                                                    className={`flex items-center space-x-1.5 p-2 bg-white dark:bg-gray-800 border rounded-md hover:shadow-sm transition-all ${selectedFiles.has(fileId)
                                                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 ring-1 ring-blue-500'
                                                        : 'border-gray-200 dark:border-gray-700'
                                                        }`}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedFiles.has(fileId)}
                                                        onChange={() => handleSelectFile(fileId)}
                                                        className="w-3.5 h-3.5 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600 cursor-pointer flex-shrink-0"
                                                    />
                                                    <div className="w-6 h-6 bg-orange-100 dark:bg-orange-900/30 rounded flex items-center justify-center flex-shrink-0">
                                                        <File className="w-3 h-3 text-orange-600 dark:text-orange-400" />
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="font-medium text-xs text-gray-900 dark:text-white truncate" title={fileName}>
                                                            {fileName}
                                                        </p>
                                                        <p className="text-[10px] text-gray-500 font-mono truncate">
                                                            {fileId.substring(0, 8)}...
                                                        </p>
                                                    </div>
                                                    <button
                                                        onClick={() => handleDeleteFile(fileId)}
                                                        className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors flex-shrink-0"
                                                        title="Eliminar archivo"
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            );
                                        } catch (error) {
                                            console.error('❌ Error rendering file at index', idx, error);
                                            return null;
                                        }
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </Card>
            )
            }
        </div >
    );
};

// Subcomponente para Drag & Drop
const DragDropUpload = ({ fileInputRef, handleFileUpload, uploading, uploadStatus }) => {
    const [dragActive, setDragActive] = useState(false);

    const handleDrag = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === 'dragenter' || e.type === 'dragover') {
            setDragActive(true);
        } else if (e.type === 'dragleave') {
            setDragActive(false);
        }
    };

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);

        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleFileUpload(e.dataTransfer.files[0]);
        }
    };

    const handleClick = () => {
        if (!uploading && fileInputRef.current) {
            fileInputRef.current.click();
        }
    };

    return (
        <div
            className={`
                relative border-2 border-dashed rounded-xl p-10 text-center transition-all duration-200
                ${dragActive
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 ring-4 ring-blue-100 dark:ring-blue-900/40'
                    : 'border-gray-300 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500 bg-gray-50 dark:bg-gray-800/50'
                }
                ${uploading ? 'cursor-not-allowed opacity-80' : 'cursor-pointer'}
                ${uploadStatus === 'success' ? 'border-green-500 bg-green-50 dark:bg-green-900/20' : ''}
                ${uploadStatus === 'error' ? 'border-red-500 bg-red-50 dark:bg-red-900/20' : ''}
            `}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={handleClick}
        >
            <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileUpload}
                className="hidden"
                id="file-upload"
                disabled={uploading}
            />

            <div className="flex flex-col items-center justify-center space-y-4">
                {uploadStatus === 'uploading' ? (
                    <div className="animate-spin text-blue-600 dark:text-blue-400">
                        <Loader2 className="w-12 h-12" />
                    </div>
                ) : uploadStatus === 'success' ? (
                    <div className="text-green-600 dark:text-green-400 scale-110 transform transition-transform duration-300">
                        <CheckCircle className="w-12 h-12" />
                    </div>
                ) : uploadStatus === 'error' ? (
                    <div className="text-red-600 dark:text-red-400">
                        <AlertCircle className="w-12 h-12" />
                    </div>
                ) : (
                    <div className={`p-4 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 transition-transform duration-200 ${dragActive ? 'scale-110' : ''}`}>
                        <Upload className="w-8 h-8" />
                    </div>
                )}

                <div className="space-y-1">
                    <h3 className={`text-lg font-semibold transition-colors duration-200 
                        ${uploadStatus === 'success' ? 'text-green-700 dark:text-green-300' :
                            uploadStatus === 'error' ? 'text-red-700 dark:text-red-300' :
                                'text-gray-900 dark:text-white'}`
                    }>
                        {uploadStatus === 'uploading' ? 'Subiendo archivo...' :
                            uploadStatus === 'success' ? '¡Archivo subido con éxito!' :
                                uploadStatus === 'error' ? 'Error al subir archivo' :
                                    dragActive ? '¡Suelta el archivo aquí!' : 'Sube un nuevo archivo'}
                    </h3>

                    {uploadStatus === 'idle' && (
                        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm mx-auto">
                            Arrastra y suelta documentos aquí, o haz clic para seleccionar.
                            <br />
                            <span className="text-xs text-gray-400 mt-1 block">Soporta PDF, TXT, DOCX, Img (Max 10MB)</span>
                        </p>
                    )}
                </div>

                {uploadStatus === 'idle' && (
                    <button className="px-4 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200 shadow-sm hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors">
                        Seleccionar del ordenador
                    </button>
                )}
            </div>
        </div>
    );
};

export default AssistantSection;
