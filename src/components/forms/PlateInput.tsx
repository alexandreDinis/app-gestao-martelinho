import React, { useState, useRef, useEffect } from 'react';
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
    const inputs = useRef<Array<TextInput | null>>([]);

    const cleanValue = value ? value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() : '';

    // Initialize array of 7 chars
    const chars = Array(7).fill('');
    for (let i = 0; i < 7; i++) {
        if (cleanValue[i]) chars[i] = cleanValue[i];
    }

    const isLetter = (char: string) => /^[A-Z]$/.test(char);
    const isNumber = (char: string) => /^[0-9]$/.test(char);

    // Determine keyboard type for each position
    const getKeyboardType = (index: number): 'default' | 'number-pad' => {
        if (format === 'mercosul') {
            // L L L N L N N
            if (index < 3) return 'default';      // LLL
            if (index === 3) return 'number-pad'; // N
            if (index === 4) return 'default';    // L
            return 'number-pad';                  // NN
        } else {
            // L L L N N N N
            if (index < 3) return 'default';
            return 'number-pad';
        }
    };

    const handleTextChange = (text: string, index: number) => {
        const val = text.toUpperCase();

        // Handle paste
        if (val.length > 1) {
            const pasted = val.slice(0, 7).replace(/[^A-Z0-9]/g, '');
            onChange(pasted);
            const nextIdx = Math.min(pasted.length, 6);
            setTimeout(() => inputs.current[nextIdx]?.focus(), 50);
            return;
        }

        const newChars = [...chars];

        if (val.length === 0) {
            // Deletion
            newChars[index] = '';
        } else {
            // Validate based on expected type
            const expectedType = getKeyboardType(index);
            if (expectedType === 'number-pad' && !isNumber(val)) return;
            if (expectedType === 'default' && isNumber(val)) return;

            newChars[index] = val;
        }

        const newValue = newChars.join('');
        onChange(newValue);

        // Auto advance
        if (val.length > 0 && index < 6) {
            setTimeout(() => inputs.current[index + 1]?.focus(), 50);
        }
    };

    const handleKeyPress = (e: any, index: number) => {
        if (e.nativeEvent.key === 'Backspace') {
            if (chars[index] === '' && index > 0) {
                // Jump back and delete
                const newValue = cleanValue.slice(0, index - 1) + cleanValue.slice(index);
                onChange(newValue);
                setTimeout(() => inputs.current[index - 1]?.focus(), 50);
            }
        }
    };

    const handleFocus = (index: number) => {
        // Only allow focus if previous fields are filled (sequential entry)
        if (index > 0 && !chars[index - 1]) {
            // Find first empty position
            const firstEmpty = chars.findIndex(c => !c);
            if (firstEmpty !== -1 && firstEmpty < index) {
                setTimeout(() => inputs.current[firstEmpty]?.focus(), 50);
            }
        }
    };

    const toggleFormat = () => {
        setFormat(prev => prev === 'mercosul' ? 'legacy' : 'mercosul');
        onChange(''); // Clear on toggle
    };

    // Auto-focus first field on mount
    useEffect(() => {
        setTimeout(() => inputs.current[0]?.focus(), 300);
    }, []);

    return (
        <View style={styles.container}>
            <TouchableOpacity onPress={toggleFormat} style={styles.toggleButton}>
                <RefreshCw size={14} color="#000" />
            </TouchableOpacity>

            <View style={[
                styles.plateContainer,
                format === 'mercosul' ? styles.plateMercosul : styles.plateLegacy
            ]}>
                {/* Mercosul Header */}
                {format === 'mercosul' ? (
                    <View style={styles.mercosulBar}>
                        <View style={styles.flagContainer}>
                            <View style={styles.flagBlue} />
                            <View style={styles.flagYellow} />
                        </View>
                        <Text style={styles.brasilText}>BRASIL</Text>
                        <View style={{ width: 28 }} />
                    </View>
                ) : (
                    <Text style={styles.legacyLabel}>BRASIL</Text>
                )}

                {/* Inputs Row */}
                <View style={styles.inputsRow}>
                    {Array(7).fill(0).map((_, i) => (
                        <React.Fragment key={i}>
                            {format === 'legacy' && i === 3 && (
                                <Text style={styles.legacyHyphen}>-</Text>
                            )}

                            <TextInput
                                ref={el => { inputs.current[i] = el; }}
                                value={chars[i]}
                                onChangeText={(txt) => handleTextChange(txt, i)}
                                onKeyPress={(e) => handleKeyPress(e, i)}
                                onFocus={() => handleFocus(i)}
                                placeholder={getKeyboardType(i) === 'number-pad' ? '0' : 'A'}
                                placeholderTextColor="rgba(0,0,0,0.12)"
                                maxLength={1}
                                autoCorrect={false}
                                autoComplete="off"
                                spellCheck={false}
                                keyboardType={getKeyboardType(i)}
                                selectTextOnFocus
                                style={[
                                    styles.singleInput,
                                    format === 'mercosul' ? styles.textMercosul : styles.textLegacy,
                                ]}
                            />
                        </React.Fragment>
                    ))}
                </View>

                {/* QR Code Mercosul */}
                {format === 'mercosul' && (
                    <View style={styles.qrCode}>
                        <Text style={styles.qrText}>QR</Text>
                    </View>
                )}
            </View>

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
        elevation: 5,
    },
    plateContainer: {
        width: 340, // Increased from 320
        height: 95,  // Increased from 90
        borderRadius: 8,
        borderWidth: 3,
        overflow: 'hidden',
        elevation: 8,
        backgroundColor: '#fff',
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
        height: 30,
        backgroundColor: '#1a4d8c',
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
    },
    flagContainer: {
        width: 28,
        height: 18,
        backgroundColor: '#003087',
        borderRadius: 2,
        overflow: 'hidden',
    },
    flagBlue: { flex: 1, backgroundColor: '#003087' },
    flagYellow: {
        position: 'absolute',
        top: '40%',
        height: 4,
        width: '100%',
        backgroundColor: '#FFCC00'
    },
    brasilText: {
        flex: 1,
        color: '#FFFFFF',
        fontSize: 12,
        fontWeight: '900',
        textAlign: 'center',
        letterSpacing: 3,
    },
    legacyLabel: {
        position: 'absolute',
        top: 6,
        alignSelf: 'center',
        fontSize: 10,
        color: 'rgba(0,0,0,0.3)',
        fontWeight: '700',
        letterSpacing: 4,
    },
    inputsRow: {
        flex: 1,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 6,
    },
    singleInput: {
        width: 42,  // Increased from 38
        height: 54, // Increased from 50
        textAlign: 'center',
        fontSize: 38, // Slightly reduced from 40 for better fit
        fontWeight: '700',
        marginHorizontal: 1.5, // Slightly more spacing
        padding: 0,
    },
    textMercosul: {
        color: '#000',
    },
    textLegacy: {
        color: '#333',
        fontFamily: 'monospace',
    },
    legacyHyphen: {
        fontSize: 38,
        color: '#333',
        marginHorizontal: 3,
        marginBottom: 4,
        fontWeight: 'bold',
        opacity: 0.6
    },
    qrCode: {
        position: 'absolute',
        bottom: 6,
        left: 8,
        width: 22,
        height: 22,
        backgroundColor: 'rgba(0,0,0,0.1)',
        borderRadius: 2,
        justifyContent: 'center',
        alignItems: 'center',
    },
    qrText: {
        fontSize: 7,
        fontWeight: '700',
        color: 'rgba(0,0,0,0.4)'
    },
    formatLabel: {
        marginTop: 8,
        fontSize: 10,
        color: 'rgba(212, 175, 55, 0.6)',
        letterSpacing: 2,
        textTransform: 'uppercase',
    },
});
