import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Cloud, CloudOff, AlertCircle, Clock } from 'lucide-react-native';

interface SyncStatusIconProps {
    syncStatus: 'SYNCED' | 'PENDING_CREATE' | 'PENDING_UPDATE' | 'PENDING_DELETE' | 'ERROR' | null;
    size?: number;
    showSynced?: boolean; // Se true, mostra ícone verde quando synced
}

/**
 * Componente de feedback visual do status de sincronização
 * 
 * - PENDING: Relógio cinza (aguardando sync)
 * - ERROR: Alerta vermelho (erro permanente)
 * - SYNCED: Nuvem verde (opcional, via showSynced)
 */
export const SyncStatusIcon: React.FC<SyncStatusIconProps> = ({
    syncStatus,
    size = 16,
    showSynced = false
}) => {
    if (!syncStatus) return null;

    // Se está sincronizado e não quer mostrar ícone, retorna nulo
    if (syncStatus === 'SYNCED' && !showSynced) {
        return null;
    }

    const renderIcon = () => {
        switch (syncStatus) {
            case 'PENDING_CREATE':
            case 'PENDING_UPDATE':
            case 'PENDING_DELETE':
                return (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <Clock size={size} color="#6B7280" />
                    </View>
                );

            case 'ERROR':
                return <AlertCircle size={size} color="#EF4444" />;

            case 'SYNCED':
                return showSynced ? <Cloud size={size} color="#10B981" /> : null;

            default:
                return null;
        }
    };

    return (
        <View style={{ marginLeft: 8 }}>
            {renderIcon()}
        </View>
    );
};
