import React, { useState, useEffect } from 'react';
import { Folder, Upload, Image as ImageIcon, Video, Mic, Trash2, Search, Plus, Loader2 } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';

/**
 * Biblioteca Multimedia - Zuckerberg Level Robust Implementation
 * Centralized repository for bot-accessible assets.
 */
const MediaLibrarySection = ({ showToast }) => {
    const [assets, setAssets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');

    const fetchAssets = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/media/list');
            const data = await res.json();
            if (data.success) {
                setAssets(data.files || []);
            }
        } catch (error) {
            console.error('Error fetching assets:', error);
            showToast?.('Error al cargar la biblioteca', 'error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchAssets();
    }, []);

    const filteredAssets = assets.filter(asset =>
        asset.name?.toLowerCase().includes(search.toLowerCase()) ||
        asset.id?.toLowerCase().includes(search.toLowerCase())
    );

    const getIcon = (mime) => {
        if (mime?.includes('image')) return <ImageIcon className="w-6 h-6 text-blue-500" />;
        if (mime?.includes('video')) return <Video className="w-6 h-6 text-red-500" />;
        if (mime?.includes('audio')) return <Mic className="w-6 h-6 text-green-500" />;
        return <Folder className="w-6 h-6 text-gray-500" />;
    };

    return (
        <div className="h-[calc(100vh-theme(spacing.24))] flex flex-col space-y-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-lg flex items-center justify-center shadow-lg">
                            <Folder className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                                Biblioteca Multimedia
                            </h2>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                Gestiona los archivos que Brenda e Inmobiliaria comparten
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center space-x-2">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Buscar archivos..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="pl-10 pr-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 outline-none w-64"
                            />
                        </div>
                        <Button icon={Plus} variant="primary">
                            Subir
                        </Button>
                    </div>
                </div>
            </div>

            <div className="flex-1 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-y-auto p-6">
                {loading ? (
                    <div className="h-full flex flex-col items-center justify-center text-gray-400 space-y-2">
                        <Loader2 className="w-8 h-8 animate-spin" />
                        <span>Cargando biblioteca...</span>
                    </div>
                ) : filteredAssets.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center">
                        <Upload className="w-12 h-12 text-gray-300 mb-4" />
                        <h3 className="text-lg font-medium text-gray-900 dark:text-white">Sin archivos</h3>
                        <p className="text-gray-500 text-sm max-w-xs">No se encontraron archivos en la biblioteca actualmente.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                        {filteredAssets.map((file) => (
                            <Card key={file.id} className="group relative overflow-hidden flex flex-col p-0">
                                <div className="aspect-video bg-gray-50 dark:bg-gray-900 flex items-center justify-center relative">
                                    {file.mime?.includes('image') ? (
                                        <img src={file.url} alt="" className="w-full h-full object-cover" />
                                    ) : getIcon(file.mime)}

                                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center space-x-2">
                                        <a href={file.url} target="_blank" rel="noreferrer" className="p-2 bg-white rounded-full hover:bg-gray-100 shadow-lg">
                                            <Search className="w-4 h-4 text-gray-900" />
                                        </a>
                                        <button className="p-2 bg-red-500 rounded-full hover:bg-red-600 shadow-lg text-white">
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                                <div className="p-3 border-t border-gray-100 dark:border-gray-700">
                                    <h4 className="text-xs font-semibold text-gray-900 dark:text-white truncate" title={file.name || file.id}>
                                        {file.name || 'Sin nombre'}
                                    </h4>
                                    <div className="flex items-center justify-between mt-1">
                                        <span className="text-[10px] text-gray-400 uppercase">{file.mime?.split('/')[1] || 'FILE'}</span>
                                        <span className="text-[10px] text-gray-400">{new Date(file.createdAt).toLocaleDateString()}</span>
                                    </div>
                                </div>
                            </Card>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default MediaLibrarySection;
