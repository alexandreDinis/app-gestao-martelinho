import { UserModel } from './database/models/UserModel';
import { OfflineDebug } from '../utils/OfflineDebug';
import { Logger } from './Logger';
import api, { safeRequest } from './api';
import { User } from '../types';
import { authService } from './authService';

export const userService = {
    getUsers: async (): Promise<User[]> => {
        const { isConnected, isInternetReachable } = await OfflineDebug.checkConnectivity();
        const isOnline = isConnected && isInternetReachable && !OfflineDebug.isForceOffline();
        const session = await authService.getSessionClaims();
        const empresaId = session?.empresaId || 0;

        const fetchLocal = async () => {
            Logger.info(`[UserService] Fetching users from Local DB for Empresa ${empresaId}`);
            if (empresaId > 0) {
                return await UserModel.getAllByEmpresa(empresaId);
            }
            return await UserModel.getAll();
        };

        if (isOnline) {
            return await safeRequest(
                async () => {
                    Logger.info('[UserService] Fetching technicians from API');
                    const response = await api.get<User[]>('/users/equipe');

                    // Upsert side-effect
                    if (response.data && response.data.length > 0) {
                        await UserModel.upsertBatch(response.data, empresaId);
                    }
                    return response;
                },
                fetchLocal,
                'UserService.getUsers'
            );
        }

        return await fetchLocal();
    },

    getMe: async (): Promise<User> => {
        const response = await api.get<User>('/users/me');
        return response.data;
    }
};
