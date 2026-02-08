import { UserModel } from './database/models/UserModel';
import { OfflineDebug } from '../utils/OfflineDebug';
import { Logger } from './Logger';
import api from './api';
import { User } from '../types';
import { authService } from './authService';

export const userService = {
    getUsers: async (): Promise<User[]> => {
        const { isConnected, isInternetReachable } = await OfflineDebug.checkConnectivity();
        const isOnline = isConnected && isInternetReachable && !OfflineDebug.isForceOffline();
        const session = await authService.getSessionClaims();
        const empresaId = session?.empresaId || 0;

        if (isOnline) {
            try {
                Logger.info('[UserService] Fetching technicians from API');
                const response = await api.get<User[]>('/users/equipe');

                // Cache local with empresaId context
                if (response.data.length > 0) {
                    await UserModel.upsertBatch(response.data, empresaId);
                }

                return response.data;
            } catch (error) {
                Logger.error('[UserService] API fetch failed, falling back to local', error);
            }
        }

        Logger.info(`[UserService] Fetching users from Local DB for Empresa ${empresaId}`);
        if (empresaId > 0) {
            return await UserModel.getAllByEmpresa(empresaId);
        }
        return await UserModel.getAll();
    },

    getMe: async (): Promise<User> => {
        const response = await api.get<User>('/users/me');
        return response.data;
    }
};
