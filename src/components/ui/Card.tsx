import React from 'react';
import { View, ViewStyle } from 'react-native';
import { theme } from '../../theme';

interface CardProps {
    children: React.ReactNode;
    style?: ViewStyle;
    variant?: 'default' | 'elevated' | 'outlined';
    padding?: 'none' | 'sm' | 'md' | 'lg';
}

export const Card: React.FC<CardProps> = ({
    children,
    style,
    variant = 'default',
    padding = 'md',
}) => {
    const getBackgroundColor = () => {
        switch (variant) {
            case 'elevated': return theme.colors.surfaceElevated;
            case 'outlined': return 'transparent';
            default: return theme.colors.backgroundCard;
        }
    };

    const getBorderWidth = () => {
        return variant === 'outlined' ? 1 : 1;
    };

    const getPadding = () => {
        switch (padding) {
            case 'none': return 0;
            case 'sm': return 8;
            case 'md': return 16;
            case 'lg': return 24;
        }
    };

    return (
        <View
            style={[
                {
                    backgroundColor: getBackgroundColor(),
                    borderWidth: getBorderWidth(),
                    borderColor: theme.colors.border,
                    borderRadius: theme.borderRadius.md,
                    padding: getPadding(),
                    overflow: 'hidden',
                },
                style,
            ]}
        >
            {children}
        </View>
    );
};
