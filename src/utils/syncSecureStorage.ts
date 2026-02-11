import * as SecureStore from 'expo-secure-store';

const PREFIX = 'sync_lastTenantVersion';

const buildKey = (baseHash: string, empresaId: number) =>
    `${PREFIX}_${baseHash}_${empresaId}`;

export const syncSecureStorage = {
    async getLastTenantVersion(baseHash: string, empresaId: number): Promise<number> {
        try {
            const key = buildKey(baseHash, empresaId);
            const value = await SecureStore.getItemAsync(key);
            const n = value ? Number(value) : 0;
            return Number.isFinite(n) ? n : 0;
        } catch (e) {
            console.error('[syncSecureStorage] getLastTenantVersion failed', e);
            return 0;
        }
    },

    async setLastTenantVersion(baseHash: string, empresaId: number, version: number): Promise<void> {
        try {
            const key = buildKey(baseHash, empresaId);
            await SecureStore.setItemAsync(key, String(version));
        } catch (e) {
            console.error('[syncSecureStorage] setLastTenantVersion failed', e);
        }
    },

    async clearLastTenantVersion(baseHash: string, empresaId: number): Promise<void> {
        try {
            const key = buildKey(baseHash, empresaId);
            await SecureStore.deleteItemAsync(key);
        } catch (e) {
            console.error('[syncSecureStorage] clearLastTenantVersion failed', e);
        }
    },
};
