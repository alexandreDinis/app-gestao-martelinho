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

    /**
     * Retorna claims do token (userId, empresaId) sem depender de estado React.
     * Fonte da verdade absoluta para Sync e Offline Logic.
     */
    getSessionClaims: async (): Promise<{ userId: number; empresaId: number; role?: string } | null> => {
        try {
            const userStr = await SecureStore.getItemAsync('user');
            if (!userStr) return null;

            const user = JSON.parse(userStr) as UserResponse;
            if (!user.token) return null;

            // Simple JWT Decode (Payload is part 2)
            const parts = user.token.split('.');
            if (parts.length !== 3) return null;

            // Base64Url to Base64
            let start = parts[1].replace(/-/g, '+').replace(/_/g, '/');
            // Pad with =
            const pad = start.length % 4;
            if (pad) {
                if (pad === 1) throw new Error('InvalidLengthError: Input base64url string is the wrong length to determine padding');
                start += new Array(5 - pad).join('=');
            }

            // Decode
            const jsonPayload = atob(start);
            // Note: 'atob' might not be available in all RN envs without polyfill, 
            // but Expo usually supports it or we can use Buffer. 
            // If atob fails, we might need a polyfill.
            // Let's assume standard RN environment or use a safe decoder.

            const payload = JSON.parse(jsonPayload);

            // 🔍 DEBUG: Identify role field names in login response and JWT
            console.log('[authService] 🔍 Session Claims Debug:', JSON.stringify({
                'user.role': user.role,
                'user.roles': user.roles,
                'payload.role': payload.role,
                'payload.roles': payload.roles,
                'payload.authorities': payload.authorities,
                'payload.scope': payload.scope,
                'payloadKeys': Object.keys(payload)
            }));

            // Adjust field mapping based on backend JWT structure
            // Usually: sub (id), empresaId, or custom claims
            const resolvedRole = user.role
                || payload.role
                || (user.roles && user.roles[0])
                || (payload.roles && payload.roles[0])
                || (Array.isArray(payload.authorities) && payload.authorities[0])
                || undefined;

            return {
                userId: Number(payload.sub || payload.id || payload.userId),
                empresaId: Number(payload.tid || payload.empresaId || payload.empresa_id || 0),
                role: resolvedRole
            };
        } catch (error) {
            console.error('[authService] Failed to decode session claims:', error);
            return null;
        }
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
