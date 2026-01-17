import React from 'react';

/**
 * Componente Card reutilizable para secciones
 */
const Card = ({
    title,
    icon: Icon,
    children,
    className = '',
    headerClassName = '',
    bodyClassName = '',
    actions,
}) => {
    return (
        <div className={`
      bg-white dark:bg-gray-800 
      rounded-xl 
      border border-gray-200 dark:border-gray-700
      shadow-sm hover-lift
      smooth-transition
      ${className}
    `}>
            {(title || Icon || actions) && (
                <div className={`
          px-6 py-4 
          border-b border-gray-200 dark:border-gray-700
          flex items-center justify-between
          ${headerClassName}
        `}>
                    <div className="flex items-center space-x-3">
                        {Icon && (
                            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                                <Icon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                            </div>
                        )}
                        {title && (
                            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                                {title}
                            </h2>
                        )}
                    </div>
                    {actions && (
                        <div className="flex items-center space-x-2">
                            {actions}
                        </div>
                    )}
                </div>
            )}

            <div className={`px-6 py-5 ${bodyClassName}`}>
                {children}
            </div>
        </div>
    );
};

export default Card;
