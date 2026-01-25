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
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState('');

    useEffect(() => {
        // Future: Load from api/media/library
    }, []);

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
                                Gestiona los archivos que el Bot IA compartirá con los candidatos
                            </p>
                        </div>
                    </div>
                    <Button icon={Plus} variant="primary">
                        Subir Archivo
                    </Button>
                </div>
            </div>

            <div className="flex-1 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col items-center justify-center text-center p-12">
                <div className="w-20 h-20 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mb-4">
                    <Upload className="w-10 h-10 text-gray-400" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                    Tu biblioteca está vacía
                </h3>
                <p className="text-gray-500 dark:text-gray-400 max-w-sm">
                    Sube imágenes, PDF o videos informativos para que el bot pueda enviarlos automáticamente durante las entrevistas.
                </p>
                <div className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-4 w-full max-w-2xl">
                    <div className="p-4 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl flex flex-col items-center space-y-2 opacity-50">
                        <ImageIcon className="w-6 h-6" />
                        <span className="text-xs font-medium">Imágenes</span>
                    </div>
                    <div className="p-4 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl flex flex-col items-center space-y-2 opacity-50">
                        <Video className="w-6 h-6" />
                        <span className="text-xs font-medium">Videos</span>
                    </div>
                    <div className="p-4 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl flex flex-col items-center space-y-2 opacity-50">
                        <Mic className="w-6 h-6" />
                        <span className="text-xs font-medium">Audios</span>
                    </div>
                    <div className="p-4 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl flex flex-col items-center space-y-2 opacity-50">
                        <Folder className="w-6 h-6" />
                        <span className="text-xs font-medium">Documentos</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MediaLibrarySection;
