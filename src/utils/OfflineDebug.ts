import NetInfo from '@react-native-community/netinfo';

/**
 * Utilitário para forçar modo offline durante desenvolvimento/debug
 * 
 * USO:
 * import { OfflineDebug } from './OfflineDebug';
 * 
 * // Ativar modo offline
 * OfflineDebug.setForceOffline(true);
 * 
 * // Desativar
 * OfflineDebug.setForceOffline(false);
 */
class OfflineDebugger {
    private forceOffline = false;

    /**
     * Ativa/desativa modo offline forçado
     */
    setForceOffline(value: boolean): void {
        this.forceOffline = value;
        console.log(`🔧 [OfflineDebug] Modo offline ${value ? 'ATIVADO' : 'DESATIVADO'}`);
    }

    /**
     * Verifica se está forçando offline
     */
    isForceOffline(): boolean {
        return this.forceOffline;
    }

    /**
     * Wrapper para NetInfo.fetch() que respeita modo debug
     */
    async checkConnectivity(): Promise<{ isConnected: boolean; isInternetReachable: boolean }> {
        if (this.forceOffline) {
            console.log('🔧 [OfflineDebug] Simulando offline (forceOffline=true)');
            return { isConnected: false, isInternetReachable: false };
        }

        const netState = await NetInfo.fetch();
        const isOnline = netState.isConnected && netState.isInternetReachable !== false;

        console.log(`🌐 [OfflineDebug] Status real:`, {
            isConnected: netState.isConnected,
            isInternetReachable: netState.isInternetReachable,
            type: netState.type,
            online: isOnline
        });

        return {
            isConnected: netState.isConnected ?? false,
            isInternetReachable: netState.isInternetReachable ?? false
        };
    }
}

export const OfflineDebug = new OfflineDebugger();
