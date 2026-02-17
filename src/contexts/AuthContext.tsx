import React, { createContext, useState, useEffect, useContext } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { authService } from '../services/authService';
import { LoginRequest, UserResponse } from '../types';
import { Logger } from '../services/Logger';
import { BiometricService } from '../services/BiometricService';
import NetInfo from '@react-native-community/netinfo';
import { SyncService } from '../services/SyncService';

interface AuthContextData {
    user: UserResponse | null;
    loading: boolean;
    biometricAvailable: boolean;
    biometricEnabled: boolean;
    signIn: (credentials: LoginRequest) => Promise<UserResponse>;
    signOut: () => Promise<void>;
    signInWithBiometric: () => Promise<void>;
    toggleBiometric: (enabled: boolean, credentials?: LoginRequest) => Promise<void>;
    completeSignIn: (userData: UserResponse) => void;
}

const AuthContext = createContext<AuthContextData>({} as AuthContextData);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<UserResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [biometricAvailable, setBiometricAvailable] = useState(false);
    const [biometricEnabled, setBiometricEnabled] = useState(false);

    useEffect(() => {
        const loadStorageData = async () => {
            try {
                // Carregar usuário do storage
                const storedUser = await authService.getCurrentUser();
                if (storedUser) {
                    Logger.info('Auth: Session restored', { email: storedUser.email, name: storedUser.name });
                    setUser(storedUser);

                    // 🚀 BOOT SYNC CHECK (Auto-Login)
                    NetInfo.fetch().then(async state => {
                        if (state.isConnected && state.isInternetReachable !== false) {
                            await SyncService.tryBootSync(true);
                        }
                    });
                } else {
                    Logger.debug('Auth: No session found');
                }

                // Verificar disponibilidade de biometria
                const available = await BiometricService.isAvailable();
                setBiometricAvailable(available);
                Logger.debug('Auth: Biometric available', { available });

                // Verificar se biometria está habilitada
                if (available) {
                    const enabled = await authService.isBiometricEnabled();
                    setBiometricEnabled(enabled);
                    Logger.debug('Auth: Biometric enabled', { enabled });
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
            Logger.info('Auth: Attempting login', { username: credentials.email });
            const userData = await authService.login(credentials);
            Logger.info('Auth: Login successful', { email: userData.email });

            // NÃO chama setUser aqui - deixa o LoginScreen controlar quando o usuário é autenticado
            // Isso permite exibir o dialog de biometria antes de navegar
            console.log('🔐 [AuthContext] Login API successful, returning userData WITHOUT setting user state yet');

            return userData;
        } catch (error) {
            Logger.error('Auth: Login failed', error);
            throw error;
        }
    };

    // Nova função para completar o login após dialogs
    const completeSignIn = (userData: UserResponse) => {
        console.log('🔐 [AuthContext] Completing sign-in, now setUser will be called');
        setUser(userData);
    };

    const signInWithBiometric = async () => {
        try {
            Logger.info('Auth: Attempting biometric login');
            const userData = await authService.loginWithBiometric();
            Logger.info('Auth: Biometric login successful', { email: userData.email });
            setUser(userData);
        } catch (error) {
            Logger.error('Auth: Biometric login failed', error);
            throw error;
        }
    };

    const toggleBiometric = async (enabled: boolean, credentials?: LoginRequest) => {
        try {
            if (enabled) {
                if (!credentials) {
                    throw new Error('Credenciais necessárias para habilitar biometria');
                }
                Logger.info('Auth: Enabling biometric');
                await authService.enableBiometric(credentials);
                setBiometricEnabled(true);
            } else {
                Logger.info('Auth: Disabling biometric');
                await authService.disableBiometric();
                setBiometricEnabled(false);
            }
        } catch (error) {
            Logger.error('Auth: Failed to toggle biometric', error);
            throw error;
        }
    };

    const signOut = async () => {
        Logger.info('Auth: Signing out', { email: user?.email });
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
        <AuthContext.Provider
            value={{
                user,
                loading,
                biometricAvailable,
                biometricEnabled,
                signIn,
                signOut,
                signInWithBiometric,
                toggleBiometric,
                completeSignIn
            }}
        >
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
