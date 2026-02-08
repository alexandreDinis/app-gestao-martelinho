import React, { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet, ActivityIndicator } from 'react-native';
import { Search } from 'lucide-react-native';
import { theme } from '../../theme';

type PlateFormat = 'MERC' | 'ANTIGA';

interface SimplePlateInputProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    onSearch?: () => void;
    isSearching?: boolean;
    buttonLabel?: string;
}

export const SimplePlateInput: React.FC<SimplePlateInputProps> = ({
    value,
    onChange,
    placeholder,
    onSearch,
    isSearching,
    buttonLabel = 'PESQUISAR'
}) => {
    const [format, setFormat] = useState<PlateFormat>('MERC');

    const handleTextChange = (text: string) => {
        // Remove non-alphanumeric chars
        const cleaned = text.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
        let formatted = '';
        const limit = 7;

        for (let i = 0; i < cleaned.length && i < limit; i++) {
            const char = cleaned[i];
            if (format === 'ANTIGA') {
                if (i < 3) {
                    if (/[A-Z]/.test(char)) formatted += char;
                } else {
                    if (/[0-9]/.test(char)) formatted += char;
                }
            } else {
                if (i < 3) {
                    if (/[A-Z]/.test(char)) formatted += char;
                } else if (i === 3) {
                    if (/[0-9]/.test(char)) formatted += char;
                } else if (i === 4) {
                    if (/[A-Z]/.test(char)) formatted += char;
                } else {
                    if (/[0-9]/.test(char)) formatted += char;
                }
            }
        }

        // Apply visual mask for legacy format
        if (format === 'ANTIGA' && formatted.length > 3) {
            onChange(formatted.slice(0, 3) + '-' + formatted.slice(3));
        } else {
            onChange(formatted);
        }
    };

    const getKeyboardType = () => {
        const cleanLength = value.replace(/[^a-zA-Z0-9]/g, '').length;
        if (format === 'ANTIGA') {
            return cleanLength >= 3 ? 'numeric' : 'default';
        } else {
            if (cleanLength < 3) return 'default';
            if (cleanLength === 3) return 'numeric';
            if (cleanLength === 4) return 'default';
            return 'numeric';
        }
    };

    return (
        <View style={styles.container}>
            {/* Format Toggle */}
            <View style={styles.toggleContainer}>
                <TouchableOpacity
                    onPress={() => { setFormat('MERC'); onChange(''); }}
                    style={[styles.toggleButton, format === 'MERC' && styles.toggleActive]}
                >
                    <Text style={[styles.toggleText, format === 'MERC' && styles.toggleTextActive]}>MERCOSUL</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    onPress={() => { setFormat('ANTIGA'); onChange(''); }}
                    style={[styles.toggleButton, format === 'ANTIGA' && styles.toggleActive]}
                >
                    <Text style={[styles.toggleText, format === 'ANTIGA' && styles.toggleTextActive]}>ANTIGA</Text>
                </TouchableOpacity>
            </View>

            <View style={styles.inputWrapper}>
                <TextInput
                    placeholder={placeholder || (format === 'MERC' ? "ABC1D23" : "ABC-1234")}
                    placeholderTextColor={theme.colors.textMuted}
                    value={value}
                    onChangeText={handleTextChange}
                    keyboardType={getKeyboardType()}
                    autoCapitalize="characters"
                    style={styles.input}
                />
            </View>

            {onSearch && (
                <TouchableOpacity
                    onPress={onSearch}
                    disabled={isSearching}
                    style={styles.searchButton}
                >
                    {isSearching ? (
                        <ActivityIndicator size="small" color={theme.colors.primary} />
                    ) : (
                        <>
                            <Search size={16} color={theme.colors.primary} />
                            <View style={{ width: 8 }} />
                            <Text style={styles.searchButtonText}>
                                {buttonLabel}
                            </Text>
                        </>
                    )}
                </TouchableOpacity>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        width: '100%',
    },
    toggleContainer: {
        flexDirection: 'row',
        marginBottom: 12,
        backgroundColor: 'rgba(0,0,0,0.2)',
        padding: 2,
        borderRadius: 6,
    },
    toggleButton: {
        flex: 1,
        paddingVertical: 6,
        alignItems: 'center',
        borderRadius: 4,
    },
    toggleActive: {
        backgroundColor: theme.colors.primary,
    },
    toggleText: {
        fontSize: 10,
        fontWeight: '700',
        color: theme.colors.textMuted,
    },
    toggleTextActive: {
        color: '#000',
    },
    inputWrapper: {
        width: '100%',
        marginBottom: 10,
    },
    input: {
        backgroundColor: 'rgba(0,0,0,0.4)',
        borderWidth: 1,
        borderColor: theme.colors.border,
        color: theme.colors.text,
        paddingHorizontal: 12,
        paddingVertical: 12,
        fontSize: 14,
        fontWeight: '700',
        letterSpacing: 2,
        borderRadius: 4,
    },
    searchButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.primaryMuted,
        borderWidth: 1,
        borderColor: 'rgba(212, 175, 55, 0.3)',
        paddingVertical: 12,
        borderRadius: 4,
    },
    searchButtonText: {
        color: theme.colors.primary,
        fontWeight: '900',
        fontSize: 12,
        letterSpacing: 1,
    }
});
