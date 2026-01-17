import React from 'react';
import { X, Download, FileText } from 'lucide-react';
import Button from './ui/Button';
import { downloadChatHistory } from '../services/chatExportService';

const ChatHistoryModal = ({ isOpen, onClose, candidate, chatContent }) => {
    if (!isOpen) return null;

    const handleDownload = () => {
        downloadChatHistory(candidate);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-3xl w-full max-h-[80vh] flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
                    <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center">
                            <FileText className="w-6 h-6 text-blue-600 dark:text-blue-300" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                                Historial de Conversación
                            </h2>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                {candidate?.name || candidate?.whatsapp}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    <pre className="whitespace-pre-wrap font-sans text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                        {chatContent}
                    </pre>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200 dark:border-gray-700">
                    <Button
                        variant="outline"
                        onClick={onClose}
                    >
                        Cerrar
                    </Button>
                    <Button
                        icon={Download}
                        onClick={handleDownload}
                    >
                        Descargar .txt
                    </Button>
                </div>
            </div>
        </div>
    );
};

export default ChatHistoryModal;
