import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { AlertTriangle, CheckCircle, Info, XCircle } from 'lucide-react-native';
import { theme } from '../../theme';

export interface CyberpunkAlertProps {
    visible: boolean;
    title: string;
    message: string;
    type?: 'error' | 'warning' | 'success' | 'info';
    onClose: () => void;
    actions?: { text: string; onPress: () => void; variant?: 'primary' | 'secondary' }[];
}

export const CyberpunkAlert: React.FC<CyberpunkAlertProps> = ({
    visible,
    title,
    message,
    type = 'info',
    onClose,
    actions
}) => {
    if (!visible) return null;

    const getIcon = () => {
        switch (type) {
            case 'error': return <XCircle size={32} color={theme.colors.error} />;
            case 'warning': return <AlertTriangle size={32} color={theme.colors.warning} />;
            case 'success': return <CheckCircle size={32} color={theme.colors.success} />;
            default: return <Info size={32} color={theme.colors.primary} />;
        }
    };

    const getColor = () => {
        switch (type) {
            case 'error': return theme.colors.error;
            case 'warning': return theme.colors.warning;
            case 'success': return theme.colors.success;
            default: return theme.colors.primary;
        }
    };

    const color = getColor();

    return (
        <Modal
            transparent
            visible={visible}
            animationType="fade"
            onRequestClose={onClose}
        >
            <View style={styles.overlay}>
                <View style={[styles.container, { borderColor: color }]}>
                    {/* Decorative Corner Lines */}
                    <View style={[styles.corner, styles.cornerTL, { borderColor: color }]} />
                    <View style={[styles.corner, styles.cornerTR, { borderColor: color }]} />
                    <View style={[styles.corner, styles.cornerBL, { borderColor: color }]} />
                    <View style={[styles.corner, styles.cornerBR, { borderColor: color }]} />

                    {/* Header */}
                    <View style={[styles.header, { borderBottomColor: theme.colors.border }]}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            {getIcon()}
                            <View style={{ marginLeft: 12 }}>
                                <Text style={[styles.systemText, { color: theme.colors.textMuted }]}>
                                    SYSTEM_ALERT_V2 {'>>'} {type.toUpperCase()}
                                </Text>
                                <Text style={[styles.title, { color }]}>{title}</Text>
                            </View>
                        </View>
                    </View>

                    {/* Content */}
                    <View style={styles.content}>
                        <Text style={styles.message}>{message}</Text>

                        {/* Fake Tech Data decoration */}
                        <View style={{ marginTop: 16, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', paddingTop: 8 }}>
                            <Text style={{ color: theme.colors.textMuted, fontSize: 8, fontFamily: 'monospace' }}>
                                ERR_CODE: 0x{Math.floor(Math.random() * 9999).toString(16).toUpperCase()} // TIMESTAMP: {Date.now()}
                            </Text>
                        </View>
                    </View>

                    {/* Actions */}
                    <View style={styles.actions}>
                        {actions ? (
                            actions.map((action, index) => (
                                <TouchableOpacity
                                    key={index}
                                    onPress={action.onPress}
                                    style={[
                                        styles.button,
                                        action.variant === 'secondary'
                                            ? { borderColor: theme.colors.textMuted, backgroundColor: 'transparent' }
                                            : { backgroundColor: color, borderColor: color }
                                    ]}
                                >
                                    <Text
                                        style={[
                                            styles.buttonText,
                                            { color: action.variant === 'secondary' ? theme.colors.textMuted : '#000' }
                                        ]}
                                    >
                                        [{action.text}]
                                    </Text>
                                </TouchableOpacity>
                            ))
                        ) : (
                            <TouchableOpacity
                                onPress={onClose}
                                style={[styles.button, { backgroundColor: color, borderColor: color }]}
                            >
                                <Text style={[styles.buttonText, { color: '#000' }]}>[ FECHAR ]</Text>
                            </TouchableOpacity>
                        )}
                    </View>
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.9)',
        justifyContent: 'center',
        padding: 20,
    },
    container: {
        backgroundColor: theme.colors.backgroundSecondary,
        borderWidth: 1,
        padding: 2,
        position: 'relative',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.5,
        shadowRadius: 20,
        elevation: 10,
    },
    corner: {
        position: 'absolute',
        width: 10,
        height: 10,
        borderTopWidth: 2,
        borderLeftWidth: 2,
    },
    cornerTL: { top: -2, left: -2 },
    cornerTR: { top: -2, right: -2, transform: [{ rotate: '90deg' }] },
    cornerBR: { bottom: -2, right: -2, transform: [{ rotate: '180deg' }] },
    cornerBL: { bottom: -2, left: -2, transform: [{ rotate: '270deg' }] },
    header: {
        padding: 16,
        backgroundColor: 'rgba(0,0,0,0.5)',
        borderBottomWidth: 1,
    },
    systemText: {
        fontSize: 10,
        fontWeight: 'bold',
        letterSpacing: 2,
        marginBottom: 4,
    },
    title: {
        fontSize: 18,
        fontWeight: '900',
        letterSpacing: 1,
        fontStyle: 'italic',
        textTransform: 'uppercase',
    },
    content: {
        padding: 20,
    },
    message: {
        color: theme.colors.textWhite,
        fontSize: 16,
        lineHeight: 24,
    },
    actions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        padding: 16,
        gap: 12,
        backgroundColor: 'rgba(0,0,0,0.3)',
    },
    button: {
        paddingVertical: 12,
        paddingHorizontal: 24,
        borderWidth: 1,
        minWidth: 100,
        alignItems: 'center',
    },
    buttonText: {
        fontWeight: '900',
        fontSize: 14,
        letterSpacing: 1,
    },
});
