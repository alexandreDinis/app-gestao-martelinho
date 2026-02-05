// src/components/ui/SyncStatusBadge.tsx
// Badge para indicar status de sincronização de um item individual

import React from 'react';
import { View, Text } from 'react-native';
import { Check, Clock, AlertTriangle, RefreshCw, CloudOff } from 'lucide-react-native';
import { theme } from '../../theme';
import type { SyncStatus } from '../../services/database/models/types';

interface SyncStatusBadgeProps {
    status: SyncStatus;
    size?: 'sm' | 'md';
    showLabel?: boolean;
}

export const SyncStatusBadge: React.FC<SyncStatusBadgeProps> = ({
    status,
    size = 'sm',
    showLabel = false
}) => {
    const iconSize = size === 'sm' ? 10 : 14;
    const fontSize = size === 'sm' ? 8 : 10;
    const padding = size === 'sm' ? 3 : 5;

    const getConfig = () => {
        switch (status) {
            case 'SYNCED':
                return {
                    icon: Check,
                    color: theme.colors.success,
                    bgColor: 'rgba(34, 197, 94, 0.15)',
                    label: 'Sincronizado'
                };
            case 'PENDING_CREATE':
            case 'PENDING_UPDATE':
                return {
                    icon: Clock,
                    color: theme.colors.warning,
                    bgColor: 'rgba(245, 158, 11, 0.15)',
                    label: 'Pendente'
                };
            case 'PENDING_DELETE':
                return {
                    icon: CloudOff,
                    color: theme.colors.textMuted,
                    bgColor: 'rgba(100, 100, 100, 0.15)',
                    label: 'Deletando'
                };
            case 'SYNCING':
                return {
                    icon: RefreshCw,
                    color: theme.colors.info,
                    bgColor: 'rgba(59, 130, 246, 0.15)',
                    label: 'Sincronizando'
                };
            case 'ERROR':
                return {
                    icon: AlertTriangle,
                    color: theme.colors.error,
                    bgColor: 'rgba(239, 68, 68, 0.15)',
                    label: 'Erro'
                };
            default:
                return {
                    icon: Clock,
                    color: theme.colors.textMuted,
                    bgColor: 'rgba(100, 100, 100, 0.15)',
                    label: 'Desconhecido'
                };
        }
    };

    const config = getConfig();
    const Icon = config.icon;

    // Não mostrar badge para items sincronizados (a menos que showLabel)
    if (status === 'SYNCED' && !showLabel) {
        return null;
    }

    return (
        <View
            style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: config.bgColor,
                borderRadius: 4,
                padding,
            }}
        >
            <Icon size={iconSize} color={config.color} />
            {showLabel && (
                <Text
                    style={{
                        color: config.color,
                        fontSize,
                        fontWeight: '600',
                        marginLeft: 4,
                    }}
                >
                    {config.label}
                </Text>
            )}
        </View>
    );
};
