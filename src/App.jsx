import React, { useState, useEffect } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useToast } from './hooks/useToast';
import Button from './components/ui/Button';
import Sidebar from './components/Sidebar';
import CandidatesSection from './components/CandidatesSection';
import ChatSection from './components/ChatSection';
import BulksSection from './components/BulksSection';

import SettingsSection from './components/SettingsSection';
import AutomationsSection from './components/AutomationsSection';
import VacanciesSection from './components/VacanciesSection';
import UsersSection from './components/UsersSection';
import PostMakerSection from './components/PostMakerSection';
import BotIASection from './components/BotIASection';
import SimulatorSection from './components/SimulatorSection';
import MediaLibrarySection from './components/MediaLibrarySection';
import ProjectsSection from './components/ProjectsSection';
import ByPassSection from './components/ByPassSection';
import InstancesSection from './components/InstancesSection';
import LoadingOverlay from './components/ui/LoadingOverlay';
import LoginPage from './components/LoginPage';
import LandingPage from './components/LandingPage';
import { getTheme, saveTheme } from './utils/storage';

function App() {
  const [user, setUser] = useState(null);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [showLogin, setShowLogin] = useState(false);
  const [instanceId, setInstanceId] = useState('');
  const [token, setToken] = useState('');
  const [theme, setTheme] = useState('light');
  const [activeSection, setActiveSection] = useState('candidates');
  const [isAppReady, setIsAppReady] = useState(false);
  const [rolePermissions, setRolePermissions] = useState({});
  const { toast, showToast, hideToast, ToastComponent } = useToast();

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
    
    fetch('/api/roles')
      .then(res => res.json())
      .then(data => {
         if (data.success && data.roles) {
             const currentUserRole = data.roles.find(r => r.name === user.role);
             if (currentUserRole && currentUserRole.permissions) {
                 setRolePermissions(currentUserRole.permissions);
                 if (currentUserRole.permissions['candidates'] !== true) {
                     // Fallback orderly based on typical Sidebar order
                     const fallbackKeys = ['chat', 'instances', 'bot-ia', 'simulator', 'automations', 'vacancies', 'bypass', 'projects', 'post-maker', 'users', 'settings'];
                     const fallback = fallbackKeys.find(k => currentUserRole.permissions[k] === true);
                     if (fallback) {
                         setActiveSection(fallback);
                     }
                 }
             }
         }
         setIsAppReady(true);
      })
      .catch(e => {
         console.error('Failed fetching role perms in App', e);
         setIsAppReady(true);
      });
  }, [user]);

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

  const handleCredentialsChange = (newInstanceId, newToken) => {
    setInstanceId(newInstanceId);
    setToken(newToken);
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
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">

        {/* Top Bar — título de sección + saludo + tema */}
        <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10 backdrop-blur-lg bg-opacity-90 dark:bg-opacity-90 shrink-0">
          <div className="px-8 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                  {activeSection === 'candidates' ? 'Candidatos'
                    : activeSection === 'chat' ? 'Chat Web'
                    : activeSection === 'bulks' ? 'Envíos Masivos (Bulks)'
                    : activeSection === 'bot-ia' ? 'Bot IA'
                    : activeSection === 'simulator' ? 'Simulador'
                    : activeSection === 'automations' ? 'Automatizaciones'
                    : activeSection === 'vacancies' ? 'Vacantes'
                    : activeSection === 'history' ? 'Historial'
                    : activeSection === 'users' ? 'Usuarios'
                    : activeSection === 'post-maker' ? 'Post Maker'
                    : activeSection === 'media-library' ? 'Biblioteca Multimedia'
                    : activeSection === 'projects' ? 'Proyectos'
                    : activeSection === 'bypass' ? 'ByPass Intelligence'
                    : activeSection === 'instances' ? 'Instancias de Envío'
                    : 'Configuración'}
                </h1>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {activeSection === 'candidates' ? 'Gestión de candidatos de WhatsApp'
                    : activeSection === 'chat' ? 'Chatea nativamente con tus candidatos'
                    : activeSection === 'bulks' ? 'Manda mensajes en secuencia a múltiples candidatos a la vez'
                    : activeSection === 'bot-ia' ? 'Configuración del comportamiento del Bot'
                    : activeSection === 'simulator' ? 'Chatea con Brenda en tiempo real'
                    : activeSection === 'automations' ? 'Reglas de extracción inteligente de datos'
                    : activeSection === 'vacancies' ? 'Gestión y publicación de vacantes'
                    : activeSection === 'history' ? 'Historial de conversaciones'
                    : activeSection === 'users' ? 'Gestión de equipo y permisos'
                    : activeSection === 'post-maker' ? 'Creación de posts para Facebook'
                    : activeSection === 'media-library' ? 'Biblioteca de archivos y recursos del Bot'
                    : activeSection === 'projects' ? 'Gestión y organización de proyectos'
                    : activeSection === 'bypass' ? 'Enrutamiento automático de candidatos'
                    : activeSection === 'instances' ? 'Gestión de conexiones WhatsApp'
                    : 'Credenciales y configuración del sistema'}
                </p>
              </div>

              <div className="flex items-center space-x-4">
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

        <main className={`flex-1 overflow-y-auto overflow-x-hidden flex flex-col min-h-0 ${activeSection === 'chat' || activeSection === 'bulks' ? 'p-0' : 'px-8 py-8'}`}>
          {activeSection === 'candidates' ? (
            <CandidatesSection showToast={showToast} />
          ) : activeSection === 'chat' ? (
            <ChatSection showToast={showToast} user={user} rolePermissions={rolePermissions} />
          ) : activeSection === 'bulks' ? (
            <BulksSection showToast={showToast} />
          ) : activeSection === 'bot-ia' ? (
            <BotIASection showToast={showToast} />
          ) : activeSection === 'simulator' ? (
            <SimulatorSection showToast={showToast} />
          ) : activeSection === 'automations' ? (
            <AutomationsSection showToast={showToast} />
          ) : activeSection === 'vacancies' ? (
            <VacanciesSection showToast={showToast} />
          ) : activeSection === 'users' ? (
            <UsersSection showToast={showToast} />
          ) : activeSection === 'post-maker' ? (
            <PostMakerSection showToast={showToast} />
          ) : activeSection === 'media-library' ? (
            <MediaLibrarySection showToast={showToast} />
          ) : activeSection === 'projects' ? (
            <ProjectsSection showToast={showToast} />
          ) : activeSection === 'bypass' ? (
            <ByPassSection showToast={showToast} />
          ) : activeSection === 'instances' ? (
            <InstancesSection showToast={showToast} />
          ) : (
            <SettingsSection
              instanceId={instanceId}
              token={token}
              onCredentialsChange={handleCredentialsChange}
              showToast={showToast}
            />
          )}
        </main>

        {/* Footer */}
        <footer className="py-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shrink-0 sticky bottom-0 z-10 backdrop-blur-lg bg-opacity-90 dark:bg-opacity-90">
          <div className="px-8">
            <p className="text-center text-sm text-gray-500 dark:text-gray-400">
              Candidatic IA v1.0 • Desarrollado con ❤️ para Candidatic
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
