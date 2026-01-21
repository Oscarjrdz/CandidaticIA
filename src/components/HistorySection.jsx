import React, { useState, useEffect } from 'react';
import { FileText, Download, Trash2, Search, RefreshCw, History as HistoryIcon } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import { getCredentials } from '../utils/storage';
import { getFiles, deleteFile } from '../services/assistantService';

const HistorySection = ({ showToast }) => {
    const [files, setFiles] = useState([]);
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState('');
    const [credentials, setCredentials] = useState(null);

    const loadHistoryFiles = async (creds = credentials) => {
        if (!creds) return;
        setLoading(true);
        try {
            const result = await getFiles(creds);
            if (result.success) {
                const txtFiles = result.files.filter(f =>
                    (f.filename && f.filename.endsWith('.txt')) ||
                    (f.name && f.name.endsWith('.txt'))
                );
                setFiles(txtFiles);
            } else {
                showToast(result.error, 'error');
            }
        } catch {
            showToast('Error al cargar archivos de historial', 'error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const creds = getCredentials();
        if (creds && creds.botId) {
            setCredentials(creds);
            loadHistoryFiles(creds);
        }
    }, []);

    const handleDelete = async (fileId) => {
        if (!window.confirm('¿Eliminar este historial permanentemente?')) return;

        const result = await deleteFile(credentials, fileId);
        if (result.success) {
            showToast('Historial eliminado', 'success');
            loadHistoryFiles();
        } else {
            showToast(result.error, 'error');
        }
    };

    const handleDownload = (url) => {
        window.open(url, '_blank');
    };

    const filteredFiles = files.filter(f => {
        const name = f.filename || f.name || '';
        return name.toLowerCase().includes(search.toLowerCase());
    });

    return (
        <div className="space-y-6">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 bg-amber-100 dark:bg-amber-900 rounded-lg flex items-center justify-center">
                            <HistoryIcon className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                                Historial de Conversaciones
                            </h2>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                {files.length} chats exportados en la base de conocimiento
                            </p>
                        </div>
                    </div>
                    <Button
                        onClick={() => loadHistoryFiles()}
                        icon={RefreshCw}
                        variant="outline"
                        size="sm"
                        disabled={loading}
                    >
                        Refrescar
                    </Button>
                </div>

                <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Buscar por número..."
                        className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-amber-500 text-sm outline-none"
                    />
                </div>
            </div>

            <Card>
                {loading ? (
                    <div className="space-y-3 p-4">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="h-12 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
                        ))}
                    </div>
                ) : filteredFiles.length === 0 ? (
                    <div className="text-center py-12">
                        <FileText className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                        <p className="text-gray-500">No hay historiales guardados aún.</p>
                        <p className="text-xs text-gray-400 mt-1">Configura el "Timer" en la sección de Candidatos para generarlos automáticamente.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-gray-200 dark:border-gray-700">
                                    <th className="text-left py-3 px-6 font-semibold text-gray-700 dark:text-gray-300">Archivo</th>
                                    <th className="text-center py-3 px-6 font-semibold text-gray-700 dark:text-gray-300">Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredFiles.map((file, idx) => {
                                    const fileName = file.filename || file.name || `Chat ${idx}`;
                                    const number = fileName.replace('.txt', '');

                                    return (
                                        <tr key={file.id || idx} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors">
                                            <td className="py-3 px-6">
                                                <div className="flex items-center space-x-3">
                                                    <FileText className="w-5 h-5 text-gray-400" />
                                                    <div>
                                                        <div className="font-medium text-gray-900 dark:text-white text-sm">
                                                            {fileName}
                                                        </div>
                                                        <div className="text-xs text-gray-500 font-mono">
                                                            {number}
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="py-3 px-6 text-center">
                                                <div className="flex items-center justify-center space-x-2">
                                                    <button
                                                        onClick={() => handleDownload(file.url)}
                                                        className="p-2 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
                                                        title="Descargar / Ver"
                                                    >
                                                        <Download className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDelete(file.id)}
                                                        className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                                                        title="Eliminar"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>
        </div>
    );
};

export default HistorySection;
