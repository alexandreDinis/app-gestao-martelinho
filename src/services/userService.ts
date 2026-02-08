import { UserModel } from './database/models/UserModel';
import { OfflineDebug } from '../utils/OfflineDebug';
import { Logger } from './Logger';
import api from './api';
import { User } from '../types';

export const userService = {
    getUsers: async (): Promise<User[]> => {
        const { isConnected, isInternetReachable } = await OfflineDebug.checkConnectivity();
        const isOnline = isConnected && isInternetReachable && !OfflineDebug.isForceOffline();

        if (isOnline) {
            try {
                Logger.info('[UserService] Fetching technicians from API');
                const response = await api.get<User[]>('/users/equipe');

                // Cache local
                await UserModel.upsertBatch(response.data);

                return response.data;
            } catch (error) {
                Logger.error('[UserService] API fetch failed, falling back to local', error);
            }
        }

        Logger.info('[UserService] Fetching users from Local DB');
        return await UserModel.getAll();
    },

    getMe: async (): Promise<User> => {
        const response = await api.get<User>('/users/me');
        return response.data;
    }
};
