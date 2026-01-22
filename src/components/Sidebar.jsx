import React from 'react';
import { Users, Settings, Bot, History, Zap, Briefcase, Send, User, LogOut } from 'lucide-react';

/**
 * Sidebar de navegación
 */
const Sidebar = ({ activeSection, onSectionChange, onLogout }) => {
    const menuItems = [
        {
            id: 'candidates',
            label: 'Candidatos',
            icon: Users,
            position: 'top'
        },
        {
            id: 'assistant',
            label: 'Update Bot',
            icon: Bot,
            position: 'top'
        },
        {
            id: 'automations',
            label: 'Automatizaciones',
            icon: Zap,
            position: 'top'
        },
        {
            id: 'vacancies',
            label: 'Vacantes',
            icon: Briefcase,
            position: 'top'
        },
        {
            id: 'bulks',
            label: 'Bulks',
            icon: Send,
            position: 'top'
        },
        {
            id: 'history',
            label: 'Historial',
            icon: History,
            position: 'top'
        },
        {
            id: 'users',
            label: 'Usuarios',
            icon: User,
            position: 'top'
        },
        {
            id: 'settings',
            label: 'Settings',
            icon: Settings,
            position: 'bottom'
        }
    ];

    const topItems = menuItems.filter(item => item.position === 'top');
    const bottomItems = menuItems.filter(item => item.position === 'bottom');

    const MenuItem = ({ item }) => {
        const Icon = item.icon;
        const isActive = activeSection === item.id;

        return (
            <button
                onClick={() => onSectionChange(item.id)}
                className={`
                    w-full flex items-center space-x-3 px-4 py-3 rounded-lg
                    smooth-transition group
                    ${isActive
                        ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 shadow-lg'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }
                `}
                title={item.label}
            >
                <Icon className={`w-5 h-5 ${isActive ? 'text-inherit' : 'text-gray-500 dark:text-gray-400 group-hover:text-gray-900 dark:group-hover:text-white'}`} />
                <span className="font-medium text-sm">{item.label}</span>
            </button>
        );
    };

    return (
        <aside className="w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col h-screen sticky top-0">
            {/* Logo/Header */}
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-gray-900 dark:bg-white rounded-xl flex items-center justify-center shadow-lg">
                        <Users className="w-6 h-6 text-white dark:text-gray-900" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white leading-tight">
                            Candidatic IA
                        </h2>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                            v1.0
                        </p>
                    </div>
                </div>
            </div>

            {/* Menu Items - Top */}
            <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
                {topItems.map(item => (
                    <MenuItem key={item.id} item={item} />
                ))}
            </nav>

            {/* Menu Items - Bottom */}
            <nav className="p-4 space-y-2 border-t border-gray-200 dark:border-gray-700">
                {bottomItems.map(item => (
                    <MenuItem key={item.id} item={item} />
                ))}

                {/* Logout Button */}
                <button
                    onClick={onLogout}
                    className="w-full flex items-center space-x-3 px-4 py-3 rounded-lg smooth-transition group text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                    title="Cerrar Sesión"
                >
                    <LogOut className="w-5 h-5 text-red-500 group-hover:text-red-600" />
                    <span className="font-medium text-sm">Cerrar Sesión</span>
                </button>
            </nav>
        </aside>
    );
};

export default Sidebar;
