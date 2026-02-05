// src/contexts/OfflineContext.tsx
// Contexto global para gerenciamento de estado offline

import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { syncEngine, SyncStatus } from '../services/sync';

interface OfflineContextValue {
    // Estado
    isOnline: boolean;
    isSyncing: boolean;
    pendingCount: number;
    errorCount: number;
    lastSyncTime: Date | null;
    isInitialized: boolean;

    // Ações
    forceSync: () => Promise<void>;
    refresh: () => Promise<void>;
}

const OfflineContext = createContext<OfflineContextValue | null>(null);

interface OfflineProviderProps {
    children: ReactNode;
}

export const OfflineProvider: React.FC<OfflineProviderProps> = ({ children }) => {
    const [status, setStatus] = useState<SyncStatus>({
        isOnline: false,
        isSyncing: false,
        pendingCount: 0,
        errorCount: 0,
        lastSyncTime: null
    });
    const [isInitialized, setIsInitialized] = useState(false);

    useEffect(() => {
        let unsubscribe: (() => void) | null = null;

        const init = async () => {
            try {
                console.log('[OfflineContext] Initializing...');
                await syncEngine.initialize();

                // Subscrever para atualizações de status
                unsubscribe = syncEngine.subscribe((newStatus) => {
                    setStatus(newStatus);
                });

                setIsInitialized(true);
                console.log('[OfflineContext] Initialized');
            } catch (error) {
                console.error('[OfflineContext] Failed to initialize:', error);
                // Continuar sem offline, mas logado
                setIsInitialized(true);
            }
        };

        init();

        return () => {
            if (unsubscribe) {
                unsubscribe();
            }
        };
    }, []);

    const forceSync = useCallback(async () => {
        try {
            const result = await syncEngine.forceSync();
            if (result.failed > 0) {
                console.warn('[OfflineContext] Sync completed with errors:', result.errors);
            }
        } catch (error) {
            console.error('[OfflineContext] Force sync failed:', error);
        }
    }, []);

    const refresh = useCallback(async () => {
        const newStatus = await syncEngine.getStatusAsync();
        setStatus(newStatus);
    }, []);

    const value: OfflineContextValue = {
        isOnline: status.isOnline,
        isSyncing: status.isSyncing,
        pendingCount: status.pendingCount,
        errorCount: status.errorCount,
        lastSyncTime: status.lastSyncTime,
        isInitialized,
        forceSync,
        refresh
    };

    return (
        <OfflineContext.Provider value={value}>
            {children}
        </OfflineContext.Provider>
    );
};

export const useOffline = (): OfflineContextValue => {
    const context = useContext(OfflineContext);
    if (!context) {
        throw new Error('useOffline must be used within an OfflineProvider');
    }
    return context;
};

// Hook simplificado para verificar apenas se está online
export const useIsOnline = (): boolean => {
    const { isOnline } = useOffline();
    return isOnline;
};
