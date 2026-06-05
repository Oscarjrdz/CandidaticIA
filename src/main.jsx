import React from 'react';
import ReactDOM from 'react-dom/client';
import { SpeedInsights } from '@vercel/speed-insights/react';
import App from './App.jsx';
import './index.css';

// Interceptor global: agrega Authorization header a todas las llamadas /api/
// usando el sessionToken almacenado en la sesión del usuario.
(function installAuthInterceptor() {
    const _fetch = window.fetch.bind(window);
    window.fetch = function (url, options = {}) {
        const urlStr = typeof url === 'string' ? url : url?.url ?? '';
        if (urlStr.startsWith('/api/')) {
            try {
                const raw = localStorage.getItem('candidatic_user_session');
                const session = raw ? JSON.parse(raw) : null;
                if (session?.sessionToken && !(options.headers?.['Authorization'])) {
                    options = {
                        ...options,
                        headers: {
                            ...options.headers,
                            Authorization: `Bearer ${session.sessionToken}`,
                        },
                    };
                }
            } catch { /* si localStorage falla, continuar sin header */ }
        }
        return _fetch(url, options);
    };
})();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
    <SpeedInsights />
  </React.StrictMode>,
);
