import React from 'react';
import { View, TextInput, Text, TextInputProps, ViewStyle } from 'react-native';
import { theme } from '../../theme';

interface InputProps extends TextInputProps {
    label?: string;
    error?: string;
    icon?: React.ReactNode;
    containerStyle?: ViewStyle;
}

export const Input: React.FC<InputProps> = ({
    label,
    error,
    icon,
    containerStyle,
    style,
    ...props
}) => {
    const [isFocused, setIsFocused] = React.useState(false);

    return (
        <View style={containerStyle}>
            {label && (
                <Text
                    style={{
                        color: isFocused ? theme.colors.text : theme.colors.textSecondary,
                        fontSize: 10,
                        fontWeight: '700',
                        letterSpacing: 2,
                        textTransform: 'uppercase',
                        marginBottom: 8,
                        marginLeft: 4,
                    }}
                >
                    {label}
                </Text>
            )}
            <View
                style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: 'rgba(0, 0, 0, 0.4)',
                    borderWidth: 1,
                    borderColor: error
                        ? theme.colors.error
                        : isFocused
                            ? theme.colors.borderFocus
                            : theme.colors.border,
                    borderRadius: theme.borderRadius.sm,
                    paddingHorizontal: 12,
                    minHeight: 48,
                }}
            >
                {icon && (
                    <View style={{ marginRight: 12 }}>
                        {icon}
                    </View>
                )}
                <TextInput
                    {...props}
                    onFocus={(e) => {
                        setIsFocused(true);
                        props.onFocus?.(e);
                    }}
                    onBlur={(e) => {
                        setIsFocused(false);
                        props.onBlur?.(e);
                    }}
                    placeholderTextColor={theme.colors.textMuted}
                    style={[
                        {
                            flex: 1,
                            color: theme.colors.text,
                            fontSize: 14,
                            fontFamily: 'monospace',
                            paddingVertical: 12,
                        },
                        style,
                    ]}
                />
            </View>
            {error && (
                <Text
                    style={{
                        color: theme.colors.error,
                        fontSize: 11,
                        marginTop: 4,
                        marginLeft: 4,
                    }}
                >
                    {error}
                </Text>
            )}
        </View>
    );
};
