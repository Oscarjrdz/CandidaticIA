import React, { useState, useEffect, useRef, Suspense, useCallback } from 'react';
import { Moon, Sun, Menu } from 'lucide-react';
import Sidebar from './components/Sidebar';
import LoadingOverlay from './components/ui/LoadingOverlay';
import ErrorBoundary from './components/ui/ErrorBoundary';
import SectionSkeleton from './components/ui/SectionSkeleton';
import LandingPage from './components/LandingPage';
import MobileLandingPage from './components/MobileLandingPage';
import { ToastProvider, useToastContext } from './contexts/ToastContext';
import { AuthProvider, useAuthContext } from './contexts/AuthContext';
import { getTheme, saveTheme } from './utils/storage';
import { usePresence } from './hooks/usePresence';
import InternalChat from './components/InternalChat';
import { useCandidatesSSE } from './hooks/useCandidatesSSE';

// ⚡ React.lazy with auto-retry on stale chunk errors (post-deploy cache mismatch)
// If a dynamic import fails (e.g. old chunk hash no longer exists), reload the page ONCE
// to fetch the new HTML manifest. A sessionStorage flag prevents infinite reload loops.
function lazyWithRetry(importFn, chunkName) {
  return React.lazy(() =>
    importFn().catch((error) => {
      const key = `chunk_reload_${chunkName}`;
      const hasReloaded = sessionStorage.getItem(key);
      if (!hasReloaded) {
        console.warn(`[LazyRetry] Chunk "${chunkName}" failed to load. Reloading page to fetch new build…`, error);
        sessionStorage.setItem(key, '1');
        window.location.reload();
        // Return a never-resolving promise so the reload takes effect cleanly
        return new Promise(() => {});
      }
      // Already reloaded once — clear the flag and surface the error
      sessionStorage.removeItem(key);
      throw error;
    })
  );
}

const CandidatesSection = lazyWithRetry(() => import('./components/CandidatesSection'), 'CandidatesSection');
const ChatSection = lazyWithRetry(() => import('./components/ChatSection'), 'ChatSection');
const BulksSection = lazyWithRetry(() => import('./components/BulksSection'), 'BulksSection');
const SettingsSection = lazyWithRetry(() => import('./components/SettingsSection'), 'SettingsSection');
const AutomationsSection = lazyWithRetry(() => import('./components/AutomationsSection'), 'AutomationsSection');
const VacanciesSection = lazyWithRetry(() => import('./components/VacanciesSection'), 'VacanciesSection');
const BolsaSection = lazyWithRetry(() => import('./components/BolsaSection'), 'BolsaSection');
const NotificacionesSection = lazyWithRetry(() => import('./components/NotificacionesSection'), 'NotificacionesSection');
const UsersSection = lazyWithRetry(() => import('./components/UsersSection'), 'UsersSection');
const BotIASection = lazyWithRetry(() => import('./components/BotIASection'), 'BotIASection');
const MediaLibrarySection = lazyWithRetry(() => import('./components/MediaLibrarySection'), 'MediaLibrarySection');
const CRMProjectsSection = lazyWithRetry(() => import('./components/CRMProjectsSection'), 'CRMProjectsSection');
const AdsStatisticsSection = lazyWithRetry(() => import('./components/AdsStatisticsSection'), 'AdsStatisticsSection');

/**
 * Inner app shell — consumes both contexts.
 * Separated from providers to avoid re-rendering providers on state change.
 */
function AppShell() {
  const { user, setUser, isAuthChecking, isAppReady, rolePermissions, login, logout } = useAuthContext();
  const { showToast } = useToastContext();

  const [theme, setTheme] = useState('light');
  const [activeSection, setActiveSection] = useState('candidates');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Conteo de no-leídos — fuente única de verdad para el badge de Chat Web
  const [chatUnreadCount, setChatUnreadCount] = useState(() => {
    const saved = localStorage.getItem('chat_unread_rbac_v2');
    return saved !== null ? Number(saved) : 0;
  });
  const { newCandidate } = useCandidatesSSE();

  // Cuando Chat Web está abierto, recibe el conteo RBAC exacto directo de ChatSection
  const handleUnreadCountChange = useCallback((count) => {
    setChatUnreadCount(count);
    localStorage.setItem('chat_unread_rbac_v2', String(count));
  }, []);

  // Candidato nuevo = siempre no-leído: incrementar badge si estamos fuera de Chat Web
  const prevNewCandidateId = useRef(null);
  useEffect(() => {
    if (!newCandidate?.id) return;
    if (newCandidate.id === prevNewCandidateId.current) return;
    prevNewCandidateId.current = newCandidate.id;
    if (activeSection !== 'chat') {
      setChatUnreadCount(prev => {
        const next = prev + 1;
        localStorage.setItem('chat_unread_rbac_v2', String(next));
        return next;
      });
    }
  }, [newCandidate, activeSection]);

  // Resize listener for mobile viewport detection
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const { onlineUsers } = usePresence(user, activeSection);

  // Cargar tema al iniciar
  useEffect(() => {
    const savedTheme = getTheme();
    setTheme(savedTheme);
    if (savedTheme === 'dark') {
      document.documentElement.classList.add('dark');
    }
  }, []);

  // Permission-based initial section routing
  const isViewer = user?.role === 'Viewer';
  useEffect(() => {
    // Force chat on mobile regardless of other rules
    if (isMobile) {
      setActiveSection('chat');
      return;
    }
    // Viewer role: force chat-only access
    if (isViewer) { setActiveSection('chat'); return; }
    if (!user || user.role === 'SuperAdmin' || !rolePermissions) return;
    if (rolePermissions['candidates'] !== true) {
      const fallbackKeys = ['chat', 'bot-ia', 'automations', 'vacancies', 'projects', 'users', 'settings'];
      const fallback = fallbackKeys.find(k => rolePermissions[k] === true);
      if (fallback) setActiveSection(fallback);
    }
  }, [user, rolePermissions, isViewer, isMobile]);

  // Bulk engine heartbeat — adaptive interval: 5s while running, 30s idle
  // Only runs for users who have explicit bulk access (avoids polling for every session)
  useEffect(() => {
    if (!user) return;
    // Skip polling if rolePermissions is loaded and bulks is explicitly disabled for this role
    if (rolePermissions && rolePermissions['bulks'] === false) return;
    let timer;
    const poll = () => {
        fetch('/api/bulks?action=status')
            .then(r => r.json())
            .then(d => {
                const isRunning = d?.state?.isRunning === true;
                timer = setTimeout(poll, isRunning ? 5000 : 30000);
            })
            .catch(() => { timer = setTimeout(poll, 30000); });
    };
    timer = setTimeout(poll, 5000); // first check after 5s
    return () => clearTimeout(timer);
  }, [user, rolePermissions]);

  // Toggle tema
  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const newTheme = prev === 'light' ? 'dark' : 'light';
      saveTheme(newTheme);
      if (newTheme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      return newTheme;
    });
  }, []);

  const handleLogout = useCallback(() => {
    logout();
    showToast('Sesión cerrada... 👋', 'info');
    setTimeout(() => {
      window.location.reload();
    }, 500);
  }, [logout, showToast]);

  // AUTH GUARD
  if (isAuthChecking) {
    return <LoadingOverlay />;
  }

  if (!user) {
    const isMobileLanding = window.innerWidth < 768;
    const loginSuccess = (userData) => {
      login(userData);
      showToast(`Bienvenido, ${userData.name}`, 'success');
    };
    return isMobileLanding
      ? <MobileLandingPage onLoginSuccess={loginSuccess} />
      : <LandingPage onLoginSuccess={loginSuccess} />;
  }

  // PREVENT GHOSTING: wait until permissions apply routing fix
  if (!isAppReady) {
    return <LoadingOverlay />;
  }

  if (isMobile) {
    return (
      <div className="h-screen w-screen bg-[#f0f2f5] dark:bg-[#111b21] flex overflow-hidden">
        <main className="flex-1 h-full w-full p-0 overflow-hidden">
          <ErrorBoundary>
            <Suspense fallback={<SectionSkeleton />}>
              <ChatSection rolePermissions={rolePermissions} onlineUsers={onlineUsers} onUnreadCountChange={handleUnreadCountChange} />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 flex overflow-hidden">
      {/* Sidebar */}
      <Sidebar
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        onLogout={handleLogout}
        isMobileOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        chatUnreadCount={chatUnreadCount}
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
                      : activeSection === 'media-library' ? 'Biblioteca'
                      : activeSection === 'projects' ? 'Proyectos'
                      : 'Configuración'}
                  </h1>

                  {/* Top Bar Presence Facepile (Meta Style) */}
                  {activeSection === 'chat' && onlineUsers && onlineUsers.length > 0 && (
                    <div className="hidden sm:flex items-center">
                      <div className="flex -space-x-2 mr-2">
                        {onlineUsers.slice(0, 4).map((u, i) => (
                          <div key={u.userId || i} className="relative group">
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
                      : activeSection === 'media-library' ? 'Biblioteca de archivos y recursos del Bot'
                      : activeSection === 'projects' ? 'Kanban de reclutamiento'
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
          <Suspense fallback={<SectionSkeleton />}>
          {activeSection === 'candidates' ? (
            <CandidatesSection />
          ) : activeSection === 'chat' ? (
            <ChatSection rolePermissions={rolePermissions} onlineUsers={onlineUsers} onUnreadCountChange={handleUnreadCountChange} />
          ) : activeSection === 'bulks' ? (
            <BulksSection />
          ) : activeSection === 'bot-ia' ? (
            <BotIASection />
          ) : activeSection === 'ads-stats' ? (
            <AdsStatisticsSection />
          ) : activeSection === 'automations' ? (
            <AutomationsSection />
          ) : activeSection === 'vacancies' ? (
            <VacanciesSection />
          ) : activeSection === 'bolsa' ? (
            <BolsaSection />
          ) : activeSection === 'notificaciones' ? (
            <NotificacionesSection />
          ) : activeSection === 'users' ? (
            <UsersSection />
          ) : activeSection === 'media-library' ? (
            <MediaLibrarySection />
          ) : activeSection === 'projects' ? (
            <CRMProjectsSection />
          ) : (
            <SettingsSection />
          )}
          </Suspense>
          </ErrorBoundary>
        </main>

        <InternalChat onlineUsers={onlineUsers} />
        {/* Footer */}
        <footer className="py-3 sm:py-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shrink-0 sticky bottom-0 z-10" style={{ WebkitBackdropFilter: 'blur(12px)', backdropFilter: 'blur(12px)', backgroundColor: 'rgba(255,255,255,0.9)' }}>
          <div className="px-4 sm:px-8">
            <p className="text-center text-xs sm:text-sm text-gray-500 dark:text-gray-400">
              Candidatic IA v1.0 • Hecho con ❤️
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}

/**
 * Root App — wraps providers around the shell.
 * Providers never re-render on internal state changes.
 */
function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <AppShell />
      </ToastProvider>
    </AuthProvider>
  );
}

export default App;
