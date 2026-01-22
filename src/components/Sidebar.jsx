import React from 'react';
import { Users, Settings, Bot, History, Zap, Briefcase, Send, User, LogOut, MessageSquare, Layout } from 'lucide-react';

const WhatsAppIcon = () => (
    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.008-.57-.008-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
);

/**
 * Sidebar de navegación Rediseñado (Premium Blue)
 */
const Sidebar = ({ activeSection, onSectionChange, onLogout }) => {
    const menuItems = [
        { id: 'candidates', label: 'Candidatos', icon: Users, position: 'top' },
        { id: 'assistant', label: 'Update Bot', icon: Bot, position: 'top' },
        { id: 'automations', label: 'Automatizaciones', icon: Zap, position: 'top' },
        { id: 'vacancies', label: 'Vacantes', icon: Briefcase, position: 'top' },
        { id: 'bulks', label: 'Bulks', icon: Send, position: 'top' },
        { id: 'post-maker', label: 'Post Maker', icon: Layout, position: 'top' },
        { id: 'history', label: 'Historial', icon: History, position: 'top' },
        { id: 'users', label: 'Usuarios', icon: User, position: 'top' },
        { id: 'settings', label: 'Settings', icon: Settings, position: 'bottom' }
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
                    w-full flex items-center space-x-3 px-4 py-3 rounded-xl
                    transition-all duration-300 group relative
                    ${isActive
                        ? 'bg-white/15 text-white shadow-lg backdrop-blur-md'
                        : 'text-blue-100/70 hover:text-white hover:bg-white/10'
                    }
                `}
                title={item.label}
            >
                {isActive && (
                    <div className="absolute left-0 w-1 h-6 bg-blue-400 rounded-r-full" />
                )}
                <Icon className={`w-5 h-5 transition-transform duration-300 ${isActive ? 'scale-110 text-white' : 'group-hover:scale-110'}`} />
                <span className={`font-medium text-sm ${isActive ? 'font-bold' : ''}`}>{item.label}</span>
            </button>
        );
    };

    return (
        <aside className="w-64 bg-blue-700 flex flex-col h-screen sticky top-0 overflow-hidden shadow-2xl transition-colors duration-500">
            {/* Background pattern/gradient */}
            <div className="absolute inset-0 bg-gradient-to-b from-blue-600 via-blue-700 to-blue-800 pointer-events-none" />

            {/* Logo/Header - LOGIN STYLE */}
            <div className="relative p-6 mb-2">
                <div className="flex items-center space-x-4">
                    <div className="relative flex-shrink-0">
                        <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-purple-700 rounded-xl flex items-center justify-center shadow-lg transform rotate-3 hover:rotate-6 transition-transform duration-300">
                            <MessageSquare className="w-6 h-6 text-white" />
                        </div>
                        <div className="absolute -bottom-1.5 -right-1.5 bg-green-500 rounded-full p-1 border-2 border-slate-950">
                            <WhatsAppIcon />
                        </div>
                    </div>
                    <div>
                        <h2 className="text-lg font-extrabold text-white leading-tight tracking-tight">
                            Candidatic IA
                        </h2>
                        <div className="flex items-center mt-1">
                            <span className="text-[10px] font-bold text-blue-200 bg-blue-500/30 px-2 py-0.5 rounded-full uppercase tracking-widest border border-blue-400/30">
                                Business
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Menu Items - Top */}
            <nav className="relative flex-1 p-4 space-y-2 overflow-y-auto">
                <div className="mb-4 text-[10px] font-bold text-blue-300/50 uppercase tracking-widest px-4">
                    Principal
                </div>
                {topItems.map(item => (
                    <MenuItem key={item.id} item={item} />
                ))}
            </nav>

            {/* Footer / Bottom Items */}
            <div className="relative p-4 mt-auto border-t border-white/5 bg-white/5 backdrop-blur-sm">
                <div className="space-y-2">
                    {bottomItems.map(item => (
                        <MenuItem key={item.id} item={item} />
                    ))}

                    <button
                        onClick={onLogout}
                        className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all duration-300 group text-red-300 hover:text-red-100 hover:bg-red-500/20"
                        title="Cerrar Sesión"
                    >
                        <LogOut className="w-5 h-5 transition-transform group-hover:-translate-x-1" />
                        <span className="font-medium text-sm">Cerrar Sesión</span>
                    </button>
                </div>

                <div className="mt-4 px-4 py-3 bg-white/5 rounded-xl border border-white/5">
                    <div className="flex items-center justify-between text-[10px] text-blue-200/40">
                        <span>Estado del Sistema</span>
                        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                    </div>
                </div>
            </div>
        </aside>
    );
};

export default Sidebar;
