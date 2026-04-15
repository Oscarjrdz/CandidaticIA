import React, { useEffect } from 'react';
import { X } from 'lucide-react';

const Modal = ({ isOpen, onClose, title, children, maxWidth = 'max-w-lg' }) => {
    useEffect(() => {
        const handleEsc = (e) => {
            if (e.key === 'Escape') onClose();
        };

        if (isOpen) {
            document.addEventListener('keydown', handleEsc);
            document.body.style.overflow = 'hidden'; // Prevent background scroll
        }

        return () => {
            document.removeEventListener('keydown', handleEsc);
            document.body.style.overflow = 'unset';
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 animate-fade-in"
            style={{
                WebkitBackdropFilter: 'blur(4px)',
                backdropFilter: 'blur(4px)',
            }}
            onClick={onClose}
        >
            <div
                className={`bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full ${maxWidth} border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col max-h-[90vh] animate-slide-up`}
                style={{
                    WebkitTransform: 'translateZ(0)',
                    transform: 'translateZ(0)',
                }}
                onClick={e => e.stopPropagation()}
            >
                {/* Header — always visible, never scrolls */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700 shrink-0">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white truncate pr-4">
                        {title}
                    </h3>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 transition-colors shrink-0"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content — scrollable on small laptop screens */}
                <div className="flex-1 overflow-y-auto overscroll-contain">
                    <div className="p-6">
                        {children}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Modal;
