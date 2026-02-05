// src/components/ui/OfflineIndicator.tsx
// Componente para indicar estado offline e pendências de sincronização

import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { WifiOff, CloudOff, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react-native';
import { theme } from '../../theme';
import { useOffline } from '../../contexts/OfflineContext';

interface OfflineIndicatorProps {
    compact?: boolean;
    showSyncButton?: boolean;
}

export const OfflineIndicator: React.FC<OfflineIndicatorProps> = ({
    compact = false,
    showSyncButton = true
}) => {
    const { isOnline, isSyncing, pendingCount, errorCount, forceSync, lastSyncTime } = useOffline();

    // Se online, sem pendências e não compacto, não mostrar nada
    if (isOnline && pendingCount === 0 && errorCount === 0 && !compact) {
        return null;
    }

    const formatLastSync = (date: Date | null): string => {
        if (!date) return 'Nunca';
        const diff = Date.now() - date.getTime();
        const minutes = Math.floor(diff / 60000);
        if (minutes < 1) return 'Agora';
        if (minutes < 60) return `há ${minutes}min`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `há ${hours}h`;
        return `há ${Math.floor(hours / 24)}d`;
    };

    // Modo compacto (para header)
    if (compact) {
        if (isOnline && pendingCount === 0) {
            return null;
        }

        return (
            <TouchableOpacity
                onPress={isOnline && !isSyncing ? forceSync : undefined}
                style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: isOnline
                        ? pendingCount > 0
                            ? 'rgba(245, 158, 11, 0.2)'
                            : 'rgba(34, 197, 94, 0.2)'
                        : 'rgba(239, 68, 68, 0.2)',
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    borderRadius: 12,
                }}
            >
                {isSyncing ? (
                    <ActivityIndicator size="small" color={theme.colors.primary} />
                ) : isOnline ? (
                    pendingCount > 0 ? (
                        <>
                            <RefreshCw size={12} color={theme.colors.warning} />
                            <Text style={{ color: theme.colors.warning, fontSize: 10, marginLeft: 4, fontWeight: '700' }}>
                                {pendingCount}
                            </Text>
                        </>
                    ) : (
                        <CheckCircle size={12} color={theme.colors.success} />
                    )
                ) : (
                    <>
                        <WifiOff size={12} color={theme.colors.error} />
                        {pendingCount > 0 && (
                            <Text style={{ color: theme.colors.error, fontSize: 10, marginLeft: 4, fontWeight: '700' }}>
                                {pendingCount}
                            </Text>
                        )}
                    </>
                )}
            </TouchableOpacity>
        );
    }

    // Modo banner completo
    return (
        <View
            style={{
                backgroundColor: isOnline
                    ? pendingCount > 0 || errorCount > 0
                        ? 'rgba(245, 158, 11, 0.15)'
                        : 'rgba(34, 197, 94, 0.15)'
                    : 'rgba(239, 68, 68, 0.15)',
                borderWidth: 1,
                borderColor: isOnline
                    ? pendingCount > 0 || errorCount > 0
                        ? theme.colors.warning
                        : theme.colors.success
                    : theme.colors.error,
                borderRadius: theme.borderRadius.md,
                padding: 12,
                marginHorizontal: 16,
                marginVertical: 8,
            }}
        >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                    {isOnline ? (
                        pendingCount > 0 || errorCount > 0 ? (
                            <CloudOff size={20} color={theme.colors.warning} />
                        ) : (
                            <CheckCircle size={20} color={theme.colors.success} />
                        )
                    ) : (
                        <WifiOff size={20} color={theme.colors.error} />
                    )}

                    <View style={{ marginLeft: 12, flex: 1 }}>
                        <Text style={{
                            color: isOnline
                                ? pendingCount > 0 || errorCount > 0
                                    ? theme.colors.warning
                                    : theme.colors.success
                                : theme.colors.error,
                            fontSize: 12,
                            fontWeight: '700',
                        }}>
                            {isOnline
                                ? pendingCount > 0
                                    ? `${pendingCount} pendência${pendingCount > 1 ? 's' : ''}`
                                    : errorCount > 0
                                        ? `${errorCount} erro${errorCount > 1 ? 's' : ''}`
                                        : 'Sincronizado'
                                : 'Modo Offline'}
                        </Text>

                        <Text style={{
                            color: theme.colors.textMuted,
                            fontSize: 10,
                            marginTop: 2,
                        }}>
                            {isOnline
                                ? pendingCount > 0 || errorCount > 0
                                    ? isSyncing ? 'Sincronizando...' : 'Toque para sincronizar'
                                    : `Última sync: ${formatLastSync(lastSyncTime)}`
                                : 'Dados salvos localmente'}
                        </Text>
                    </View>
                </View>

                {showSyncButton && isOnline && (pendingCount > 0 || errorCount > 0) && (
                    <TouchableOpacity
                        onPress={forceSync}
                        disabled={isSyncing}
                        style={{
                            backgroundColor: theme.colors.primary,
                            paddingHorizontal: 12,
                            paddingVertical: 8,
                            borderRadius: theme.borderRadius.sm,
                            opacity: isSyncing ? 0.5 : 1,
                        }}
                    >
                        {isSyncing ? (
                            <ActivityIndicator size="small" color="#000" />
                        ) : (
                            <RefreshCw size={16} color="#000" />
                        )}
                    </TouchableOpacity>
                )}
            </View>

            {errorCount > 0 && (
                <View style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    marginTop: 8,
                    paddingTop: 8,
                    borderTopWidth: 1,
                    borderTopColor: 'rgba(239, 68, 68, 0.3)',
                }}>
                    <AlertCircle size={14} color={theme.colors.error} />
                    <Text style={{ color: theme.colors.error, fontSize: 10, marginLeft: 6 }}>
                        {errorCount} item(ns) com erro de sincronização
                    </Text>
                </View>
            )}
        </View>
    );
};
