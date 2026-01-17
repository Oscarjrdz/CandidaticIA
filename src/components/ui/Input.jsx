import React, { forwardRef } from 'react';

/**
 * Componente Input reutilizable
 */
const Input = forwardRef(({
    label,
    error,
    helperText,
    icon: Icon,
    rightIcon: RightIcon,
    className = '',
    containerClassName = '',
    type = 'text',
    ...props
}, ref) => {
    const inputStyles = `
    w-full px-4 py-2.5 
    bg-white dark:bg-gray-800 
    border rounded-lg 
    text-gray-900 dark:text-gray-100
    placeholder-gray-400 dark:placeholder-gray-500
    smooth-transition
    focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
    disabled:opacity-50 disabled:cursor-not-allowed
    ${error ? 'border-error focus:ring-error' : 'border-gray-300 dark:border-gray-600'}
    ${Icon ? 'pl-10' : ''}
    ${RightIcon ? 'pr-10' : ''}
  `;

    return (
        <div className={`${containerClassName}`}>
            {label && (
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    {label}
                </label>
            )}

            <div className="relative">
                {Icon && (
                    <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400">
                        <Icon className="w-5 h-5" />
                    </div>
                )}

                <input
                    ref={ref}
                    type={type}
                    className={`${inputStyles} ${className}`}
                    {...props}
                />

                {RightIcon && (
                    <div className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400">
                        <RightIcon className="w-5 h-5" />
                    </div>
                )}
            </div>

            {error && (
                <p className="mt-1.5 text-sm text-error animate-fade-in">
                    {error}
                </p>
            )}

            {helperText && !error && (
                <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">
                    {helperText}
                </p>
            )}
        </div>
    );
});

Input.displayName = 'Input';

export default Input;
