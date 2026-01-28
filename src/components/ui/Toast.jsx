import React, { useEffect } from 'react';
import { CheckCircle, XCircle, Info, X } from 'lucide-react';

/**
 * Componente Toast para notificaciones
 */
const Toast = ({
    message,
    type = 'info',
    onClose,
    duration = 5000,
    position = 'top-right'
}) => {
    useEffect(() => {
        if (duration > 0) {
            const timer = setTimeout(() => {
                onClose();
            }, duration);

            return () => clearTimeout(timer);
        }
    }, [duration, onClose]);

    const types = {
        success: {
            icon: CheckCircle,
            bgColor: 'bg-green-600',
            textColor: 'text-white',
            borderColor: 'border-green-700',
        },
        error: {
            icon: XCircle,
            bgColor: 'bg-red-600',
            textColor: 'text-white',
            borderColor: 'border-red-700',
        },
        warning: {
            icon: Info, // Fallback icon for warning
            bgColor: 'bg-amber-500',
            textColor: 'text-white',
            borderColor: 'border-amber-600',
        },
        info: {
            icon: Info,
            bgColor: 'bg-blue-600',
            textColor: 'text-white',
            borderColor: 'border-blue-700',
        },
    };

    const config = types[type] || types.info;
    const Icon = config.icon;

    return (
        <div className={`
      fixed ${positions[position]} z-50
      animate-slide-up
    `}>
            <div className={`
        ${config.bgColor} ${config.textColor}
        px-4 py-3 rounded-lg shadow-lg
        border-l-4 ${config.borderColor}
        flex items-center space-x-3
        min-w-[300px] max-w-md
      `}>
                <Icon className="w-5 h-5 flex-shrink-0" />
                <p className="flex-1 text-sm font-medium">{message}</p>
                <button
                    onClick={onClose}
                    className="flex-shrink-0 hover:opacity-80 smooth-transition"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
};


export default Toast;
