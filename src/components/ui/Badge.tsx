import React from 'react';
import { View, Text, ViewStyle } from 'react-native';
import { theme } from '../../theme';
import { OSStatus } from '../../types';

interface BadgeProps {
    children: React.ReactNode;
    variant?: 'default' | 'success' | 'warning' | 'error' | 'info';
    size?: 'sm' | 'md';
    style?: ViewStyle;
}

export const Badge: React.FC<BadgeProps> = ({
    children,
    variant = 'default',
    size = 'sm',
    style,
}) => {
    const getColors = () => {
        switch (variant) {
            case 'success':
                return { bg: 'rgba(34, 197, 94, 0.15)', text: theme.colors.success, border: theme.colors.success };
            case 'warning':
                return { bg: 'rgba(245, 158, 11, 0.15)', text: theme.colors.warning, border: theme.colors.warning };
            case 'error':
                return { bg: 'rgba(239, 68, 68, 0.15)', text: theme.colors.error, border: theme.colors.error };
            case 'info':
                return { bg: 'rgba(59, 130, 246, 0.15)', text: theme.colors.info, border: theme.colors.info };
            default:
                return { bg: theme.colors.primaryMuted, text: theme.colors.text, border: theme.colors.border };
        }
    };

    const colors = getColors();
    const padding = size === 'sm' ? { paddingVertical: 2, paddingHorizontal: 6 } : { paddingVertical: 4, paddingHorizontal: 10 };
    const fontSize = size === 'sm' ? 9 : 11;

    return (
        <View
            style={[
                {
                    backgroundColor: colors.bg,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: theme.borderRadius.sm,
                    ...padding,
                },
                style,
            ]}
        >
            <Text
                style={{
                    color: colors.text,
                    fontSize,
                    fontWeight: '700',
                    letterSpacing: 1,
                    textTransform: 'uppercase',
                }}
            >
                {children}
            </Text>
        </View>
    );
};

// Helper component specifically for OS Status
interface OSStatusBadgeProps {
    status: OSStatus;
    style?: ViewStyle;
}

export const OSStatusBadge: React.FC<OSStatusBadgeProps> = ({ status, style }) => {
    const getVariant = (): BadgeProps['variant'] => {
        switch (status) {
            case 'ABERTA': return 'info';
            case 'EM_EXECUCAO': return 'warning';
            case 'FINALIZADA': return 'success';
            case 'CANCELADA': return 'error';
            default: return 'default';
        }
    };

    const getLabel = () => {
        switch (status) {
            case 'ABERTA': return 'Aberta';
            case 'EM_EXECUCAO': return 'Em Execução';
            case 'FINALIZADA': return 'Finalizada';
            case 'CANCELADA': return 'Cancelada';
            default: return status;
        }
    };

    return (
        <Badge variant={getVariant()} style={style}>
            {getLabel()}
        </Badge>
    );
};
