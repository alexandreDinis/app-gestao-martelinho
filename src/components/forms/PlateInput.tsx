import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { RefreshCw } from 'lucide-react-native';
import { theme } from '../../theme';

type PlateFormat = 'mercosul' | 'legacy';

interface PlateInputProps {
    value: string;
    onChange: (value: string) => void;
    onBlur?: () => void;
}

export const PlateInput: React.FC<PlateInputProps> = ({ value, onChange, onBlur }) => {
    const [format, setFormat] = useState<PlateFormat>('mercosul');

    const isLetter = (char: string) => /^[A-Z]$/.test(char.toUpperCase());
    const isNumber = (char: string) => /^[0-9]$/.test(char);

    const applyMask = (rawValue: string, fmt: PlateFormat): string => {
        const chars = rawValue.toUpperCase().replace(/[^A-Z0-9]/g, '').split('');
        let formatted = '';
        let charIndex = 0;

        if (fmt === 'mercosul') {
            // Pattern: L L L N L N N (7 chars)
            const pattern = ['L', 'L', 'L', 'N', 'L', 'N', 'N'];

            for (let i = 0; i < pattern.length && charIndex < chars.length; i++) {
                const char = chars[charIndex];
                const expected = pattern[i];

                if (expected === 'L') {
                    if (isLetter(char)) {
                        formatted += char;
                        charIndex++;
                    } else {
                        charIndex++;
                        i--;
                    }
                } else if (expected === 'N') {
                    if (isNumber(char)) {
                        formatted += char;
                        charIndex++;
                    } else {
                        charIndex++;
                        i--;
                    }
                }
            }
            return formatted.slice(0, 7);
        } else {
            // Legacy: L L L - N N N N
            for (let i = 0; i < 3 && charIndex < chars.length; i++) {
                if (isLetter(chars[charIndex])) {
                    formatted += chars[charIndex];
                }
                charIndex++;
            }

            if (formatted.length === 3) {
                formatted += '-';
            }

            for (let i = 0; i < 4 && charIndex < chars.length; i++) {
                if (isNumber(chars[charIndex])) {
                    formatted += chars[charIndex];
                }
                charIndex++;
            }

            return formatted.slice(0, 8);
        }
    };

    const handleChange = (text: string) => {
        const newValue = applyMask(text, format);
        onChange(newValue);
    };

    const toggleFormat = () => {
        const newFormat = format === 'mercosul' ? 'legacy' : 'mercosul';
        setFormat(newFormat);
        onChange(applyMask(value, newFormat));
    };

    return (
        <View style={styles.container}>
            {/* Toggle Button */}
            <TouchableOpacity onPress={toggleFormat} style={styles.toggleButton}>
                <RefreshCw size={14} color="#000" />
            </TouchableOpacity>

            {/* Plate Container */}
            <View style={[
                styles.plateContainer,
                format === 'mercosul' ? styles.plateMercosul : styles.plateLegacy
            ]}>
                {/* Mercosul Top Bar */}
                {format === 'mercosul' && (
                    <View style={styles.mercosulBar}>
                        <View style={styles.flagContainer}>
                            <View style={styles.flagBlue} />
                            <View style={styles.flagYellow} />
                        </View>
                        <Text style={styles.brasilText}>BRASIL</Text>
                        <View style={{ width: 30 }} />
                    </View>
                )}

                {/* Legacy Label */}
                {format === 'legacy' && (
                    <Text style={styles.legacyLabel}>BRASIL</Text>
                )}

                {/* Input Field */}
                <View style={[
                    styles.inputContainer,
                    format === 'mercosul' ? { marginTop: 28 } : { marginTop: 12 }
                ]}>
                    <TextInput
                        value={value}
                        onChangeText={handleChange}
                        onBlur={onBlur}
                        placeholder={format === 'mercosul' ? 'ABC1D23' : 'ABC-1234'}
                        placeholderTextColor="rgba(0,0,0,0.2)"
                        autoCapitalize="characters"
                        maxLength={format === 'mercosul' ? 7 : 8}
                        style={[
                            styles.input,
                            format === 'mercosul' ? styles.inputMercosul : styles.inputLegacy
                        ]}
                    />
                </View>

                {/* QR Code indicator for Mercosul */}
                {format === 'mercosul' && (
                    <View style={styles.qrCode}>
                        <Text style={styles.qrText}>QR</Text>
                    </View>
                )}
            </View>

            {/* Format Label */}
            <Text style={styles.formatLabel}>
                {format === 'mercosul' ? 'Padrão Mercosul' : 'Padrão Antigo'}
            </Text>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        alignItems: 'center',
        marginBottom: 16,
    },
    toggleButton: {
        position: 'absolute',
        top: -8,
        right: 20,
        zIndex: 10,
        backgroundColor: theme.colors.primary,
        borderRadius: 20,
        padding: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
        elevation: 5,
    },
    plateContainer: {
        width: 260,
        height: 80,
        borderRadius: 8,
        borderWidth: 3,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 6,
        elevation: 8,
    },
    plateMercosul: {
        backgroundColor: '#FFFFFF',
        borderColor: '#1a1a1a',
    },
    plateLegacy: {
        backgroundColor: '#B0B0B0',
        borderColor: '#666666',
    },
    mercosulBar: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 26,
        backgroundColor: '#1a4d8c',
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
    },
    flagContainer: {
        width: 24,
        height: 16,
        backgroundColor: '#003087',
        borderRadius: 2,
        overflow: 'hidden',
    },
    flagBlue: {
        flex: 1,
        backgroundColor: '#003087',
    },
    flagYellow: {
        position: 'absolute',
        top: '40%',
        left: 0,
        right: 0,
        height: 4,
        backgroundColor: '#FFCC00',
    },
    brasilText: {
        flex: 1,
        color: '#FFFFFF',
        fontSize: 11,
        fontWeight: '900',
        textAlign: 'center',
        letterSpacing: 3,
    },
    legacyLabel: {
        position: 'absolute',
        top: 4,
        alignSelf: 'center',
        fontSize: 8,
        color: 'rgba(0,0,0,0.3)',
        fontWeight: '700',
        letterSpacing: 4,
    },
    inputContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 10,
    },
    input: {
        width: '100%',
        textAlign: 'center',
        fontWeight: '900',
        letterSpacing: 6,
    },
    inputMercosul: {
        fontSize: 34,
        color: '#000000',
        // Default system font (sans-serif)
        fontWeight: '700',
    },
    inputLegacy: {
        fontSize: 32,
        color: '#333333',
        fontFamily: 'monospace',
    },
    qrCode: {
        position: 'absolute',
        bottom: 4,
        left: 6,
        width: 18,
        height: 18,
        backgroundColor: 'rgba(0,0,0,0.1)',
        borderRadius: 2,
        justifyContent: 'center',
        alignItems: 'center',
    },
    qrText: {
        fontSize: 6,
        color: 'rgba(0,0,0,0.4)',
        fontWeight: '700',
    },
    formatLabel: {
        marginTop: 8,
        fontSize: 10,
        color: 'rgba(212, 175, 55, 0.6)',
        letterSpacing: 2,
        textTransform: 'uppercase',
    },
});
