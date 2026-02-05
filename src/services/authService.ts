import api from './api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LoginRequest, UserResponse } from '../types';

export const authService = {
    login: async (credentials: LoginRequest): Promise<UserResponse> => {
        // Use the configured api instance but override baseURL if needed, 
        // or just append /auth/login relative to the interceptor base.
        // Assuming api.ts has baseURL ending in /api/v1

        const response = await api.post<UserResponse>('/auth/login', credentials);

        if (response.data.token) {
            await AsyncStorage.setItem('user', JSON.stringify(response.data));

            // In a full implementation, we would fetch the user profile here similar to web.
            // For this PoC, we will trust the login response or implement getMe later.
        }
        return response.data;
    },

    logout: async () => {
        await AsyncStorage.removeItem('user');
    },

    getCurrentUser: async (): Promise<UserResponse | null> => {
        try {
            const userStr = await AsyncStorage.getItem('user');
            if (userStr) {
                return JSON.parse(userStr);
            }
        } catch (e) {
            console.error("Failed to get current user", e);
        }
        return null;
    }
};
