import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);

/**
 * Global auth context — provides user, rolePermissions, login/logout across the app.
 * Eliminates prop drilling of `user` and `rolePermissions`.
 */
export const useAuthContext = () => {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuthContext must be used within AuthProvider');
    return ctx;
};

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [isAuthChecking, setIsAuthChecking] = useState(true);
    const [isAppReady, setIsAppReady] = useState(false);
    const [rolePermissions, setRolePermissions] = useState({});

    // Check LocalStorage for session
    useEffect(() => {
        const savedUser = localStorage.getItem('candidatic_user_session');
        if (savedUser) {
            try {
                const parsed = JSON.parse(savedUser);
                if (!parsed?.sessionToken) {
                    // Legacy session without token — force re-login
                    localStorage.removeItem('candidatic_user_session');
                } else {
                    setUser(parsed);
                }
            } catch (e) {
                console.error('Invalid session', e);
                localStorage.removeItem('candidatic_user_session');
            }
        }
        setTimeout(() => {
            setIsAuthChecking(false);
        }, 600);
    }, []);

    // Validate permissions
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
                    }
                }
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
                console.error('Failed fetching role perms', e);
                setIsAppReady(true);
            });
    }, [user?.id]);

    const login = useCallback((userData) => {
        localStorage.setItem('candidatic_user_session', JSON.stringify(userData));
        setUser(userData);
    }, []);

    const logout = useCallback(() => {
        localStorage.removeItem('candidatic_user_session');
        setUser(null);
    }, []);

    const updateUser = useCallback((updater) => {
        setUser(prev => {
            const next = typeof updater === 'function' ? updater(prev) : updater;
            localStorage.setItem('candidatic_user_session', JSON.stringify(next));
            return next;
        });
    }, []);

    return (
        <AuthContext.Provider value={{ user, setUser: updateUser, isAuthChecking, isAppReady, rolePermissions, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
};
