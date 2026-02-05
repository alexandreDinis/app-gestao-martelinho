import React from 'react';
import { TouchableOpacity, Text, ActivityIndicator, ViewStyle, TextStyle } from 'react-native';
import { theme } from '../../theme';

interface ButtonProps {
    children: React.ReactNode;
    onPress: () => void;
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    size?: 'sm' | 'md' | 'lg';
    disabled?: boolean;
    loading?: boolean;
    style?: ViewStyle;
    textStyle?: TextStyle;
    fullWidth?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
    children,
    onPress,
    variant = 'primary',
    size = 'md',
    disabled = false,
    loading = false,
    style,
    textStyle,
    fullWidth = true,
}) => {
    const getBackgroundColor = () => {
        if (disabled) return 'rgba(212, 175, 55, 0.2)';
        switch (variant) {
            case 'primary': return theme.colors.primary;
            case 'secondary': return 'transparent';
            case 'ghost': return 'transparent';
            case 'danger': return theme.colors.error;
            default: return theme.colors.primary;
        }
    };

    const getBorderColor = () => {
        switch (variant) {
            case 'secondary': return theme.colors.border;
            case 'ghost': return 'transparent';
            default: return 'transparent';
        }
    };

    const getTextColor = () => {
        if (disabled) return theme.colors.textMuted;
        switch (variant) {
            case 'primary': return '#000000';
            case 'secondary': return theme.colors.text;
            case 'ghost': return theme.colors.text;
            case 'danger': return '#ffffff';
            default: return '#000000';
        }
    };

    const getPadding = () => {
        switch (size) {
            case 'sm': return { paddingVertical: 8, paddingHorizontal: 12 };
            case 'md': return { paddingVertical: 12, paddingHorizontal: 16 };
            case 'lg': return { paddingVertical: 16, paddingHorizontal: 24 };
        }
    };

    const getFontSize = () => {
        switch (size) {
            case 'sm': return 12;
            case 'md': return 14;
            case 'lg': return 16;
        }
    };

    return (
        <TouchableOpacity
            onPress={onPress}
            disabled={disabled || loading}
            activeOpacity={0.8}
            style={[
                {
                    backgroundColor: getBackgroundColor(),
                    borderWidth: variant === 'secondary' ? 1 : 0,
                    borderColor: getBorderColor(),
                    borderRadius: theme.borderRadius.md,
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexDirection: 'row',
                    width: fullWidth ? '100%' : undefined,
                    ...getPadding(),
                },
                style,
            ]}
        >
            {loading ? (
                <ActivityIndicator size="small" color={getTextColor()} />
            ) : (
                <Text
                    style={[
                        {
                            color: getTextColor(),
                            fontSize: getFontSize(),
                            fontWeight: '700',
                            letterSpacing: 1,
                            textTransform: 'uppercase',
                        },
                        textStyle,
                    ]}
                >
                    {children}
                </Text>
            )}
        </TouchableOpacity>
    );
};
