import api from './api';
import * as SecureStore from 'expo-secure-store';
import { LoginRequest, UserResponse } from '../types';
import { BiometricService, BiometricCredentials } from './BiometricService';

/**
 * Authentication Service
 * 
 * Security improvements applied:
 * - User tokens (JWT) are now stored in SecureStore (encrypted) instead of AsyncStorage
 * - Biometric credentials are stored in SecureStore
 * 
 * Note: Biometric authentication stores passwords locally for convenience.
 * This is a trade-off between security and UX. For better security, consider
 * implementing refresh tokens on the backend.
 */

export const authService = {
    login: async (credentials: LoginRequest): Promise<UserResponse> => {
        // Use the configured api instance but override baseURL if needed, 
        // or just append /auth/login relative to the interceptor base.
        // Assuming api.ts has baseURL ending in /api/v1

        const response = await api.post<UserResponse>('/auth/login', credentials);

        if (response.data.token) {
            await SecureStore.setItemAsync('user', JSON.stringify(response.data));

            // In a full implementation, we would fetch the user profile here similar to web.
            // For this PoC, we will trust the login response or implement getMe later.
        }
        return response.data;
    },

    logout: async () => {
        await SecureStore.deleteItemAsync('user');
        // Não remove credenciais biométricas aqui - usuário deve fazer isso manualmente nas configurações
    },

    getCurrentUser: async (): Promise<UserResponse | null> => {
        try {
            const userStr = await SecureStore.getItemAsync('user');
            if (userStr) {
                return JSON.parse(userStr);
            }
        } catch (e) {
            console.error("Failed to get current user", e);
        }
        return null;
    },

    // ========== BIOMETRIC METHODS ==========

    /**
     * Habilita autenticação biométrica salvando credenciais
     */
    enableBiometric: async (credentials: BiometricCredentials): Promise<boolean> => {
        const isAvailable = await BiometricService.isAvailable();
        if (!isAvailable) {
            throw new Error('Autenticação biométrica não disponível neste dispositivo');
        }

        return await BiometricService.saveCredentials(credentials);
    },

    /**
     * Desabilita autenticação biométrica removendo credenciais
     */
    disableBiometric: async (): Promise<boolean> => {
        return await BiometricService.removeCredentials();
    },

    /**
     * Verifica se biometria está habilitada
     */
    isBiometricEnabled: async (): Promise<boolean> => {
        return await BiometricService.isEnabled();
    },

    /**
     * Login usando autenticação biométrica
     */
    loginWithBiometric: async (): Promise<UserResponse> => {
        console.log('🔐 [authService] Starting biometric login...');

        const credentials = await BiometricService.authenticateAndGetCredentials(
            'Autentique-se para fazer login'
        );

        console.log('🔐 [authService] Credentials retrieved:', credentials ? 'YES' : 'NO');

        if (!credentials) {
            console.error('🔐 [authService] No credentials returned from BiometricService');
            throw new Error('Autenticação biométrica cancelada ou falhou');
        }

        console.log('🔐 [authService] Attempting login with email:', credentials.email);

        try {
            const result = await authService.login(credentials);
            console.log('🔐 [authService] Login successful!');
            return result;
        } catch (error) {
            console.error('🔐 [authService] Login failed with error:', error);
            throw error;
        }
    }
};
