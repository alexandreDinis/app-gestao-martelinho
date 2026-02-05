import React, { createContext, useState, useEffect, useContext } from 'react';
import { View, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authService } from '../services/authService';
import { LoginRequest, UserResponse } from '../types';
import { Logger } from '../services/Logger';

interface AuthContextData {
    user: UserResponse | null;
    loading: boolean;
    signIn: (credentials: LoginRequest) => Promise<UserResponse>;
    signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextData>({} as AuthContextData);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<UserResponse | null>(null);
    const [loading, setLoading] = useState(true);



    useEffect(() => {
        const loadStorageData = async () => {
            try {
                const storedUser = await authService.getCurrentUser();
                if (storedUser) {
                    Logger.info('Auth: Session restored', { userId: storedUser.id, username: storedUser.username });
                    setUser(storedUser);
                } else {
                    Logger.debug('Auth: No session found');
                }
            } catch (error) {
                Logger.error('Auth: Failed to restore session', error);
            } finally {
                setLoading(false);
            }
        };
        loadStorageData();
    }, []);

    const signIn = async (credentials: LoginRequest) => {
        try {
            Logger.info('Auth: Attempting login', { username: credentials.username });
            const userData = await authService.login(credentials);
            Logger.info('Auth: Login successful', { userId: userData.id });
            setUser(userData);
            return userData;
        } catch (error) {
            Logger.error('Auth: Login failed', error);
            throw error;
        }
    };

    const signOut = async () => {
        Logger.info('Auth: Signing out', { userId: user?.id });
        await authService.logout();
        setUser(null);
    };

    if (loading) {
        return (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f172a' }}>
                <ActivityIndicator size="large" color="#3b82f6" />
            </View>
        );
    }

    return (
        <AuthContext.Provider value={{ user, loading, signIn, signOut }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
