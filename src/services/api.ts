import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

// Request Interceptor
api.interceptors.request.use(
    async (config) => {
        try {
            const userStr = await AsyncStorage.getItem('user');
            if (userStr) {
                const user = JSON.parse(userStr);
                if (user && user.token) {
                    config.headers['Authorization'] = 'Bearer ' + user.token;
                }
            }
        } catch (error) {
            console.error("Error retrieving token:", error);
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

// Response Interceptor
api.interceptors.response.use(
    (response) => response,
    async (error) => {
        if (error.response) {
            if (error.response.status === 401) {
                console.warn("[API] 401 Unauthorized - Token invalid/expired");
                // In React Native, we can't just redirect via window.location.
                // We should clear storage so the App's AuthState updates on next check.
                await AsyncStorage.removeItem('user');
            }
        }
        return Promise.reject(error);
    }
);

export default api;
