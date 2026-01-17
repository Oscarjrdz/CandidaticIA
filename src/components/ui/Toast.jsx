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
            bgColor: 'bg-success',
            textColor: 'text-white',
            borderColor: 'border-green-600',
        },
        error: {
            icon: XCircle,
            bgColor: 'bg-error',
            textColor: 'text-white',
            borderColor: 'border-red-600',
        },
        info: {
            icon: Info,
            bgColor: 'bg-info',
            textColor: 'text-white',
            borderColor: 'border-blue-600',
        },
    };

    const positions = {
        'top-right': 'top-4 right-4',
        'top-left': 'top-4 left-4',
        'bottom-right': 'bottom-4 right-4',
        'bottom-left': 'bottom-4 left-4',
        'top-center': 'top-4 left-1/2 transform -translate-x-1/2',
    };

    const config = types[type];
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

/**
 * Hook para manejar toasts
 */
export const useToast = () => {
    const [toast, setToast] = React.useState(null);

    const showToast = (message, type = 'info', duration = 5000) => {
        setToast({ message, type, duration });
    };

    const hideToast = () => {
        setToast(null);
    };

    return {
        toast,
        showToast,
        hideToast,
        ToastComponent: toast ? (
            <Toast
                message={toast.message}
                type={toast.type}
                duration={toast.duration}
                onClose={hideToast}
            />
        ) : null,
    };
};

export default Toast;
