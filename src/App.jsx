import React, { useState, useEffect } from 'react';
import { Moon, Sun, Menu, Users } from 'lucide-react';
import { useToast } from './hooks/useToast';
import Button from './components/ui/Button';
import Sidebar from './components/Sidebar';
import CandidatesSection from './components/CandidatesSection';
import ChatSection from './components/ChatSection';
import BulksSection from './components/BulksSection';

import SettingsSection from './components/SettingsSection';
import AutomationsSection from './components/AutomationsSection';
import VacanciesSection from './components/VacanciesSection';
import BolsaSection from './components/BolsaSection';
import UsersSection from './components/UsersSection';
import PostMakerSection from './components/PostMakerSection';
import BotIASection from './components/BotIASection';
import MediaLibrarySection from './components/MediaLibrarySection';
import CRMProjectsSection from './components/CRMProjectsSection';
import ByPassSection from './components/ByPassSection';
import AdsStatisticsSection from './components/AdsStatisticsSection';
import LoadingOverlay from './components/ui/LoadingOverlay';
import ErrorBoundary from './components/ui/ErrorBoundary';
import LoginPage from './components/LoginPage';
import LandingPage from './components/LandingPage';
import { getTheme, saveTheme } from './utils/storage';
import { usePresence } from './hooks/usePresence';

function App() {
  const [user, setUser] = useState(null);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [showLogin, setShowLogin] = useState(false);

  const [theme, setTheme] = useState('light');
  const [activeSection, setActiveSection] = useState('candidates');
  const [isAppReady, setIsAppReady] = useState(false);
  const [rolePermissions, setRolePermissions] = useState({});
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { toast, showToast, hideToast, ToastComponent } = useToast();
  const { onlineUsers } = usePresence(user, activeSection);

  // Check LocalStorage for session
  useEffect(() => {
    const savedUser = localStorage.getItem('candidatic_user_session');
    if (savedUser) {
      try {
        setUser(JSON.parse(savedUser));
      } catch (e) {
        console.error('Invalid session', e);
        localStorage.removeItem('candidatic_user_session');
      }
    }
    setTimeout(() => {
      setIsAuthChecking(false);
    }, 600);
  }, []);

  // Cargar tema al iniciar
  useEffect(() => {
    const savedTheme = getTheme();
    setTheme(savedTheme);
    if (savedTheme === 'dark') {
      document.documentElement.classList.add('dark');
    }
  }, []);

  // Validar permisos iniciales para evitar flickeo (Ghosting)
  useEffect(() => {
    if (!user) {
      setIsAppReady(false);
      return;
    }
    if (user.role === 'SuperAdmin') {
      setIsAppReady(true);
      return;
    }
    
    Promise.all([
      fetch('/api/roles').then(r => r.json()),
      fetch('/api/users').then(r => r.json())
    ])
      .then(([rolesData, usersData]) => {
         if (rolesData.success && rolesData.roles) {
             const currentUserRole = rolesData.roles.find(r => r.name === user.role);
             if (currentUserRole && currentUserRole.permissions) {
                 setRolePermissions(currentUserRole.permissions);
                 if (currentUserRole.permissions['candidates'] !== true) {
                     // Fallback orderly based on typical Sidebar order
                     const fallbackKeys = ['chat', 'bot-ia', 'automations', 'vacancies', 'bypass', 'projects', 'post-maker', 'users', 'settings'];
                     const fallback = fallbackKeys.find(k => currentUserRole.permissions[k] === true);
                     if (fallback) {
                         setActiveSection(fallback);
                     }
                 }
             }
         }
         // Refresh user data with user-level assignments (allowed_projects, allowed_crm_projects, allowed_labels)
         if (usersData.success && usersData.users) {
             const freshUser = usersData.users.find(u => u.id === user.id || u.whatsapp === user.whatsapp);
             if (freshUser) {
                 const merged = { ...user, ...freshUser };
                 setUser(merged);
                 localStorage.setItem('candidatic_user_session', JSON.stringify(merged));
             }
         }
         setIsAppReady(true);
      })
      .catch(e => {
         console.error('Failed fetching role perms in App', e);
         setIsAppReady(true);
      });
  }, [user?.id]);

  // Global heartbeat — Web Worker impulsado para que NO se congele al cambiar de pestaña
  useEffect(() => {
    if (!user) return;
    const workerCode = `
      self.onmessage = function(e) {
        if (e.data === 'start') {
          setInterval(() => self.postMessage('tick'), 2000);
        }
      };
    `;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);
    worker.onmessage = () => {
        fetch('/api/bulks?action=status').catch(() => {});
    };
    worker.postMessage('start');
    return () => {
        worker.terminate();
        URL.revokeObjectURL(url);
    };
  }, [user]);

  // Toggle tema
  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    saveTheme(newTheme);
    if (newTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('candidatic_user_session');
    setUser(null);
    showToast('Sesión cerrada... 👋', 'info');
    setTimeout(() => {
      window.location.reload();
    }, 500);
  };



  // AUTH GUARD
  if (isAuthChecking) {
    return <LoadingOverlay />;
  }

  if (!user) {
    return (
      <LandingPage onLoginSuccess={(userData) => {
        localStorage.setItem('candidatic_user_session', JSON.stringify(userData));
        setUser(userData);
        showToast(`Bienvenido, ${userData.name}`, 'success');
      }} />
    );
  }

  // PREVENT GHOSTING: wait until permissions apply routing fix
  if (!isAppReady) {
    return <LoadingOverlay />;
  }

  return (
    <div className="h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 flex overflow-hidden">
      {/* Sidebar */}
      <Sidebar
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        onLogout={handleLogout}
        user={user}
        onUserUpdate={setUser}
        isMobileOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">

        {/* Top Bar — título de sección + saludo + tema */}
        <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-[60] shrink-0" style={{ WebkitBackdropFilter: 'blur(12px)', backdropFilter: 'blur(12px)', backgroundColor: 'rgba(255,255,255,0.9)' }}>
          <div className="px-4 sm:px-8 py-3 sm:py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3 min-w-0">
                {/* Mobile hamburger */}
                <button
                  onClick={() => setSidebarOpen(true)}
                  className="lg:hidden p-2 -ml-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors shrink-0"
                >
                  <Menu className="w-6 h-6 text-gray-700 dark:text-gray-300" />
                </button>
                <div className="min-w-0 flex items-center space-x-4">
                  <h1 className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-white truncate">
                    {activeSection === 'candidates' ? 'Candidatos'
                      : activeSection === 'chat' ? 'Chat Web'
                      : activeSection === 'bulks' ? 'Envíos Masivos'
                      : activeSection === 'ads-stats' ? 'Estadísticas de Ads'
                      : activeSection === 'bot-ia' ? 'Bot IA'
                      : activeSection === 'automations' ? 'Automatizaciones'
                      : activeSection === 'vacancies' ? 'Vacantes'
                      : activeSection === 'bolsa' ? 'Bolsa de Empleo (App)'
                      : activeSection === 'history' ? 'Historial'
                      : activeSection === 'users' ? 'Usuarios'
                      : activeSection === 'post-maker' ? 'Post Maker'
                      : activeSection === 'media-library' ? 'Biblioteca'
                      : activeSection === 'projects' ? 'Proyectos'
                      : activeSection === 'bypass' ? 'ByPass'
                      : 'Configuración'}
                  </h1>

                  {/* Top Bar Presence Facepile (Meta Style) */}
                  {activeSection === 'chat' && onlineUsers && onlineUsers.length > 0 && (
                    <div className="hidden sm:flex items-center">
                      <div className="flex -space-x-2 mr-2">
                        {onlineUsers.slice(0, 4).map((u, i) => (
                          <div key={i} className="relative group">
                            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full border-2 border-white dark:border-gray-800 bg-gradient-to-br from-blue-400 to-indigo-500 text-white flex items-center justify-center text-xs font-bold uppercase shadow-sm">
                              {u.userName ? u.userName.charAt(0) : '?'}
                            </div>
                            <div className="absolute left-1/2 -bottom-8 transform -translate-x-1/2 bg-gray-900 text-white text-[10px] py-1 px-2 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
                              {u.userId === (user?.id || user?.whatsapp) ? 'Tú (en línea)' : `${u.userName} (en línea)`}
                            </div>
                          </div>
                        ))}
                        {onlineUsers.length > 4 && (
                          <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full border-2 border-white dark:border-gray-800 bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 flex items-center justify-center text-xs font-bold shadow-sm z-10">
                            +{onlineUsers.length - 4}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center text-xs text-green-600 dark:text-green-400 font-medium">
                        <span className="relative flex h-2 w-2 mr-1.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                        </span>
                        En línea
                      </div>
                    </div>
                  )}
                  <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 hidden sm:block">
                    {activeSection === 'candidates' ? 'Gestión de candidatos de WhatsApp'
                      : activeSection === 'chat' ? 'Chatea nativamente con tus candidatos'
                      : activeSection === 'bulks' ? 'Manda mensajes en secuencia a múltiples candidatos a la vez'
                      : activeSection === 'ads-stats' ? 'Seguimiento y rendimiento de campañas de Meta Ads'
                      : activeSection === 'bot-ia' ? 'Configuración del comportamiento del Bot'
                      : activeSection === 'automations' ? 'Reglas de extracción inteligente de datos'
                      : activeSection === 'vacancies' ? 'Gestión y publicación de vacantes'
                      : activeSection === 'history' ? 'Historial de conversaciones'
                      : activeSection === 'users' ? 'Gestión de equipo y permisos'
                      : activeSection === 'post-maker' ? 'Creación de posts para Facebook'
                      : activeSection === 'media-library' ? 'Biblioteca de archivos y recursos del Bot'
                      : activeSection === 'projects' ? 'Kanban de reclutamiento'
                      : activeSection === 'bypass' ? 'Enrutamiento automático de candidatos'
                      : 'Credenciales y configuración del sistema'}
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-2 sm:space-x-4 shrink-0">
                {/* Greeting */}
                {user && user.name && (
                  <div className="hidden md:flex items-center space-x-2 animate-in fade-in slide-in-from-right-4 duration-700">
                    <div className="text-right">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        Hola, <span className="text-blue-600 dark:text-blue-400 font-bold">
                          {user.name.split(' ')[0].charAt(0).toUpperCase() + user.name.split(' ')[0].slice(1).toLowerCase()}
                        </span>
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {user.role === 'SuperAdmin' ? 'Super Admin' : 'Recruiter'}
                      </p>
                    </div>
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white font-bold shadow-lg transform hover:scale-105 transition-transform">
                      {user.name.charAt(0).toUpperCase()}
                    </div>
                  </div>
                )}

                {/* Theme Toggle */}
                <button
                  onClick={toggleTheme}
                  className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 smooth-transition"
                >
                  {theme === 'light' ? (
                    <Moon className="w-5 h-5 text-gray-700 dark:text-gray-300" />
                  ) : (
                    <Sun className="w-5 h-5 text-gray-700 dark:text-gray-300" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </header>

        <main className={`flex-1 overflow-y-auto overflow-x-hidden flex flex-col min-h-0 ${activeSection === 'chat' || activeSection === 'bulks' ? 'p-0' : 'px-3 sm:px-8 py-4 sm:py-8'}`}>
          <ErrorBoundary>
          {activeSection === 'candidates' ? (
            <CandidatesSection showToast={showToast} user={user} />
          ) : activeSection === 'chat' ? (
            <ChatSection showToast={showToast} user={user} rolePermissions={rolePermissions} onlineUsers={onlineUsers} />
          ) : activeSection === 'bulks' ? (
            <BulksSection showToast={showToast} />
          ) : activeSection === 'bot-ia' ? (
            <BotIASection showToast={showToast} />
          ) : activeSection === 'ads-stats' ? (
            <AdsStatisticsSection showToast={showToast} />
          ) : activeSection === 'automations' ? (
            <AutomationsSection showToast={showToast} />
          ) : activeSection === 'vacancies' ? (
            <VacanciesSection showToast={showToast} />
          ) : activeSection === 'bolsa' ? (
            <BolsaSection showToast={showToast} />
          ) : activeSection === 'users' ? (
            <UsersSection showToast={showToast} />
          ) : activeSection === 'post-maker' ? (
            <PostMakerSection showToast={showToast} />
          ) : activeSection === 'media-library' ? (
            <MediaLibrarySection showToast={showToast} />
          ) : activeSection === 'projects' ? (
            <CRMProjectsSection showToast={showToast} user={user} />
          ) : activeSection === 'bypass' ? (
            <ByPassSection showToast={showToast} />

          ) : (
            <SettingsSection
              showToast={showToast}
            />
          )}
          </ErrorBoundary>
        </main>

        {/* Footer */}
        <footer className="py-3 sm:py-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shrink-0 sticky bottom-0 z-10" style={{ WebkitBackdropFilter: 'blur(12px)', backdropFilter: 'blur(12px)', backgroundColor: 'rgba(255,255,255,0.9)' }}>
          <div className="px-4 sm:px-8">
            <p className="text-center text-xs sm:text-sm text-gray-500 dark:text-gray-400">
              Candidatic IA v1.0 • Hecho con ❤️
            </p>
          </div>
        </footer>
      </div>

      {/* Toast notifications */}
      {ToastComponent}
    </div>
  );
}

export default App;
