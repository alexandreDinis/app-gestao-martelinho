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

// Response Interceptor - Refresh Token Logic
let isRefreshing = false;
let failedQueue: Array<{
    resolve: (token: string) => void;
    reject: (error: any) => void;
}> = [];

const processQueue = (error: any, token: string | null = null) => {
    failedQueue.forEach(prom => {
        if (error) {
            prom.reject(error);
        } else {
            prom.resolve(token as string);
        }
    });
    failedQueue = [];
};

api.interceptors.response.use(
    (response) => {
        // Logger.info(`API Response: ${response.status} ${response.config.url}`, response.data);
        return response;
    },
    async (error) => {
        const originalRequest = error.config;

        // Handle 401 Auth Version Mismatch
        if (error.response?.status === 401 && !originalRequest._retry && !originalRequest.url?.endsWith('/auth/login') && !originalRequest.url?.endsWith('/auth/refresh')) {
            const errorMsg = error.response.data?.error || "";

            // Backend sends: "Plano/status alterado. Faça login novamente." OR "Permissões alteradas. Faça login novamente."
            if (errorMsg.includes("Plano/status alterado") || errorMsg.includes("Permissões alteradas")) {

                if (isRefreshing) {
                    return new Promise(function (resolve, reject) {
                        failedQueue.push({ resolve, reject });
                    }).then(token => {
                        originalRequest.headers['Authorization'] = 'Bearer ' + token;
                        return api(originalRequest);
                    }).catch(err => {
                        return Promise.reject(err);
                    });
                }

                originalRequest._retry = true;
                isRefreshing = true;

                try {
                    console.log("[API] Auth Version Mismatch detected. Attempting Auto-Refresh...");

                    // Use api instance to include stale token in headers (validated by signature only at /refresh endpoint)
                    const refreshResponse = await api.post('/auth/refresh');
                    const newUserFields = refreshResponse.data;

                    const userStr = await SecureStore.getItemAsync('user');
                    const oldUser = userStr ? JSON.parse(userStr) : {};

                    // Merge updated fields (token, roles, features, etc.)
                    const updatedUser = { ...oldUser, ...newUserFields };

                    await SecureStore.setItemAsync('user', JSON.stringify(updatedUser));
                    console.log("[API] Token refreshed successfully!");

                    // Update defaults and original request
                    api.defaults.headers.common['Authorization'] = 'Bearer ' + updatedUser.token;
                    originalRequest.headers['Authorization'] = 'Bearer ' + updatedUser.token;

                    processQueue(null, updatedUser.token);

                    return api(originalRequest);
                } catch (refreshError) {
                    processQueue(refreshError, null);
                    Logger.error("[API] Failed to refresh token", refreshError);
                    await SecureStore.deleteItemAsync('user');
                    return Promise.reject(refreshError);
                } finally {
                    isRefreshing = false;
                }
            }
        }

        if (error.response) {
            Logger.error(`API Error: ${error.response.status} ${error.config?.url}`, error.response.data);
            if (error.response.status === 401 || error.response.status === 403) {
                // If we are here, it means it wasn't a handled version mismatch refresh
                // or the refresh itself failed (prevent loop)
                if (!originalRequest._retry && !originalRequest.url?.endsWith('/auth/refresh')) {
                    Logger.warn(`[API] ${error.response.status} - Token invalid/expired or Forbidden (Logged Out)`);
                    await SecureStore.deleteItemAsync('user');
                }
            }
        } else {
            const fullURL = `${error.config?.baseURL || ''}${error.config?.url || ''}`;
            Logger.error(`API Network Error: ${error.message} [URL: ${fullURL}]`);
        }
        return Promise.reject(error);
    }
);

export default api;

/**
 * Standard helper for robust offline-first requests.
 * 1. Tenta API
 * 2. Verifica se a resposta é válida
 * 3. Se falhar ou for inválida, executa fallback (Geralmente ler do banco local)
 */
export async function safeRequest<T>(
    apiCall: () => Promise<{ data: T }>,
    fallback: () => Promise<T>,
    context: string = 'API'
): Promise<T> {
    try {
        const response = await apiCall();
        if (response && response.data !== undefined && response.data !== null) {
            return response.data;
        }
        throw new Error(`[${context}] Invalid or empty response data`);
    } catch (error) {
        // console.log(`[${context}] Falling back to local/manual logic due to:`, error instanceof Error ? error.message : error);
        return await fallback();
    }
}
