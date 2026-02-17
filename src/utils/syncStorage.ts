import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY_PREFIX = 'sync:lastTenantVersion';

/**
 * Obtém a chave de armazenamento específica para a empresa atual.
 * @param empresaId ID da empresa atual
 */
const getKey = (empresaId?: number) => {
    return empresaId ? `${STORAGE_KEY_PREFIX}:${empresaId}` : STORAGE_KEY_PREFIX;
};

export const syncStorage = {
    /**
     * Obtém a última versão do tenant sincronizada com sucesso.
     * @param empresaId Opcional, para suporte multi-tenant
     */
    getLastTenantVersion: async (empresaId?: number): Promise<number> => {
        try {
            const key = getKey(empresaId);
            const value = await AsyncStorage.getItem(key);
            return value ? parseInt(value, 10) : 0;
        } catch (error) {
            console.error('[SyncStorage] Failed to get last version', error);
            return 0;
        }
    },

    /**
     * Salva a nova versão do tenant após sync bem-sucedido.
     */
    setLastTenantVersion: async (version: number, empresaId?: number): Promise<void> => {
        try {
            const key = getKey(empresaId);
            await AsyncStorage.setItem(key, version.toString());
            // console.log(`[SyncStorage] Updated local version to ${version} (Key: ${key})`);
        } catch (error) {
            console.error('[SyncStorage] Failed to set last version', error);
        }
    },

    /**
     * Reseta a versão (útil no logout ou limpeza de dados).
     */
    clearLastTenantVersion: async (empresaId?: number): Promise<void> => {
        try {
            const key = getKey(empresaId);
            await AsyncStorage.removeItem(key);
            if (!empresaId) {
                // Tenta limpar a genérica também se não especificou
                await AsyncStorage.removeItem(STORAGE_KEY_PREFIX);
            }
        } catch (error) {
            console.error('[SyncStorage] Failed to clear last version', error);
        }
    }
};
