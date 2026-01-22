import React from 'react';
import { Loader2 } from 'lucide-react';

/**
 * Componente Button reutilizable
 */
const Button = ({
    children,
    onClick,
    variant = 'primary',
    size = 'md',
    disabled = false,
    loading = false,
    icon: Icon,
    className = '',
    type = 'button',
    ...props
}) => {
    const baseStyles = 'inline-flex items-center justify-center font-medium rounded-lg smooth-transition focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed';

    const variants = {
        primary: 'bg-blue-600 hover:bg-blue-700 text-white focus:ring-gray-400 dark:focus:ring-gray-600',
        secondary: 'bg-gray-200 hover:bg-gray-300 text-gray-900 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-white focus:ring-gray-500',
        success: 'bg-success hover:bg-green-600 text-white focus:ring-green-400',
        danger: 'bg-error hover:bg-red-600 text-white focus:ring-red-400',
        outline: 'border-2 border-gray-300 hover:border-gray-400 text-gray-700 dark:border-gray-600 dark:hover:border-gray-500 dark:text-gray-300 focus:ring-gray-400',
    };

    const sizes = {
        sm: 'px-3 py-1.5 text-sm',
        md: 'px-4 py-2 text-base',
        lg: 'px-6 py-3 text-lg',
    };

    return (
        <button
            type={type}
            onClick={onClick}
            disabled={disabled || loading}
            className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
            {...props}
        >
            {loading ? (
                <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Cargando...
                </>
            ) : (
                <>
                    {Icon && <Icon className="w-4 h-4 mr-2" />}
                    {children}
                </>
            )}
        </button>
    );
};

export default Button;
