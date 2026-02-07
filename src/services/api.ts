import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

// In Emulator (Android), localhost is 10.0.2.2.
// Replace with your text machine IP if testing on physical device (e.g., http://192.168.1.15:8080/api/v1)
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://192.168.15.46:8080/api/v1';

const api = axios.create({
    baseURL: API_BASE_URL,
    timeout: 15000,
    headers: {
        'Content-Type': 'application/json',
    },
});

console.log(`[API] Base URL configured: ${API_BASE_URL}`);

import { Logger } from './Logger';

// Request Interceptor
api.interceptors.request.use(
    async (config) => {
        try {
            // Log Request URL for debugging
            console.log(`[API] Requesting: ${config.method?.toUpperCase()} ${config.baseURL}${config.url}`);

            const userStr = await SecureStore.getItemAsync('user');
            if (userStr) {
                const user = JSON.parse(userStr);
                if (user && user.token) {
                    config.headers['Authorization'] = 'Bearer ' + user.token;
                }
            }
        } catch (error) {
            Logger.error("Error retrieving token:", error);
        }
        return config;
    },
    (error) => {
        Logger.error("API Request Error:", error);
        return Promise.reject(error);
    }
);

// Response Interceptor
api.interceptors.response.use(
    (response) => {
        // Logger.info(`API Response: ${response.status} ${response.config.url}`, response.data);
        return response;
    },
    async (error) => {
        if (error.response) {
            Logger.error(`API Error: ${error.response.status} ${error.config?.url}`, error.response.data);
            if (error.response.status === 401 || error.response.status === 403) {
                Logger.warn(`[API] ${error.response.status} - Token invalid/expired or Forbidden`);
                // In React Native, we can't just redirect via window.location.
                // We should clear storage so the App's AuthState updates on next check.
                await SecureStore.deleteItemAsync('user');

                // Opcional: Disparar evento para a UI redirecionar para Login se estiver ouvindo
            }
        } else {
            const fullURL = `${error.config?.baseURL || ''}${error.config?.url || ''}`;
            Logger.error(`API Network Error: ${error.message} [URL: ${fullURL}]`);
        }
        return Promise.reject(error);
    }
);

export default api;
