import { useEffect, useRef, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { SyncService } from '../services/SyncService';
import { OfflineDebug } from '../utils/OfflineDebug';

// Configuração Perfil "Oficina/Campo"
const POLLING_INTERVAL_MS = 90 * 1000; // 90 segundos
const FOCUS_DEBOUNCE_MS = 60 * 1000;   // 60 segundos

export const useSmartPolling = (onStatusChange?: (status: any) => void) => {
    const appState = useRef(AppState.currentState);
    const lastCheckRef = useRef<number>(0);

    // 💡 Fix Infinite Loop: Store callback in ref to keep checkNow stable
    const onStatusChangeRef = useRef(onStatusChange);

    useEffect(() => {
        onStatusChangeRef.current = onStatusChange;
    }, [onStatusChange]);

    /**
     * Função central de check com debounce manual
     * Dependências vazias [] para garantir identidade estável
     */
    const checkNow = useCallback(async (caller: string, force = false, debounceMs = 0) => {
        // 1. Verificar conectividade global (respeita modo Force Offline)
        if (OfflineDebug.isForceOffline()) {
            console.log(`[SmartPolling] Skipped (${caller}): Force Offline enabled.`);
            return;
        }

        const now = Date.now();
        const timeSinceLast = now - lastCheckRef.current;

        // 2. Debounce Check
        if (!force && debounceMs > 0 && timeSinceLast < debounceMs) {
            console.log(`[SmartPolling] Debounced (${caller}): ${(timeSinceLast / 1000).toFixed(0)}s < ${debounceMs / 1000}s`);
            return;
        }

        try {
            // 3. Call Service (Service has its own 30s throttle too)
            const result = await SyncService.checkForUpdates(force, caller);

            lastCheckRef.current = Date.now();

            if (onStatusChangeRef.current) {
                onStatusChangeRef.current(result);
            }
            return result;
        } catch (error) {
            console.error(`[SmartPolling] Error in ${caller}:`, error);
        }
    }, []); // [] garante que esta função não seja recriada

    useEffect(() => {
        // 1. Setup Interval (Foreground Polling)
        const intervalId = setInterval(() => {
            if (AppState.currentState === 'active') {
                checkNow('Polling.Interval', false, 0);
            }
        }, POLLING_INTERVAL_MS);

        // 2. Setup AppState Listener (Background -> Foreground)
        const subscription = AppState.addEventListener('change', nextAppState => {
            if (
                appState.current.match(/inactive|background/) &&
                nextAppState === 'active'
            ) {
                console.log('[SmartPolling] App has come to the foreground!');
                checkNow('App.Resume', false, 0); // Check imediato no resume
            }

            appState.current = nextAppState;
        });

        return () => {
            clearInterval(intervalId);
            subscription.remove();
        };
    }, [checkNow]);

    return {
        checkNow, // Agora estável, seguro para usar em dependências de useEffect
        FOCUS_DEBOUNCE_MS
    };
};
