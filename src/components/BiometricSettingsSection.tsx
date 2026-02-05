import React, { useState } from 'react';
import { View, Text, Switch, Alert, TouchableOpacity } from 'react-native';
import { Fingerprint, CheckCircle, XCircle } from 'lucide-react-native';
import { useAuth } from '../contexts/AuthContext';
import { BiometricService } from '../services/BiometricService';
import { theme } from '../theme';

interface BiometricSettingsSectionProps {
    style?: any;
}

export const BiometricSettingsSection: React.FC<BiometricSettingsSectionProps> = ({ style }) => {
    const { biometricAvailable, biometricEnabled, toggleBiometric } = useAuth();
    const [loading, setLoading] = useState(false);
    const [biometricTypes, setBiometricTypes] = useState<string[]>([]);

    React.useEffect(() => {
        const loadBiometricTypes = async () => {
            if (biometricAvailable) {
                const types = await BiometricService.getSupportedAuthenticationTypes();
                setBiometricTypes(types);
            }
        };
        loadBiometricTypes();
    }, [biometricAvailable]);

    const handleToggle = async (value: boolean) => {
        if (!biometricAvailable) {
            Alert.alert(
                'Biometria não disponível',
                'Seu dispositivo não suporta autenticação biométrica ou não está configurado.'
            );
            return;
        }

        if (value) {
            // Habilitar: Precisa re-fazer login para obter credenciais
            Alert.alert(
                'Biometria',
                'Para habilitar a autenticação biométrica, você precisará fazer login novamente.',
                [
                    { text: 'Cancelar', style: 'cancel' },
                    {
                        text: 'OK',
                        onPress: async () => {
                            // Usuário terá que fazer logout e login novamente
                            Alert.alert(
                                'Instruções',
                                'Por favor, faça logout e faça login novamente. Você será perguntado se deseja habilitar a biometria.'
                            );
                        }
                    }
                ]
            );
        } else {
            // Desabilitar
            Alert.alert(
                'Desabilitar Biometria',
                'Tem certeza que deseja desabilitar a autenticação biométrica?',
                [
                    { text: 'Cancelar', style: 'cancel' },
                    {
                        text: 'Desabilitar',
                        style: 'destructive',
                        onPress: async () => {
                            setLoading(true);
                            try {
                                await toggleBiometric(false);
                                Alert.alert('Sucesso', 'Autenticação biométrica desabilitada.');
                            } catch (error) {
                                Alert.alert('Erro', 'Não foi possível desabilitar a biometria.');
                            } finally {
                                setLoading(false);
                            }
                        }
                    }
                ]
            );
        }
    };

    const testBiometric = async () => {
        setLoading(true);
        try {
            const result = await BiometricService.authenticate('Teste sua biometria');
            if (result) {
                Alert.alert('Sucesso', 'Autenticação biométrica funcionou!');
            } else {
                Alert.alert('Falha', 'Autenticação biométrica falhou ou foi cancelada.');
            }
        } catch (error) {
            Alert.alert('Erro', 'Erro ao testar biometria.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <View style={[{
            backgroundColor: theme.colors.backgroundCard,
            borderRadius: 8,
            padding: 16,
            borderWidth: 1,
            borderColor: theme.colors.border
        }, style]}>
            {/* Header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                <Fingerprint size={24} color={theme.colors.primary} />
                <Text style={{
                    fontSize: 16,
                    fontWeight: 'bold',
                    color: theme.colors.text,
                    marginLeft: 12
                }}>
                    Autenticação Biométrica
                </Text>
            </View>

            {/* Status */}
            {!biometricAvailable ? (
                <View style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    padding: 12,
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    borderRadius: 6,
                    marginBottom: 12
                }}>
                    <XCircle size={20} color={theme.colors.error} />
                    <Text style={{
                        flex: 1,
                        marginLeft: 8,
                        color: theme.colors.error,
                        fontSize: 13
                    }}>
                        Biometria não disponível neste dispositivo
                    </Text>
                </View>
            ) : (
                <View style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    padding: 12,
                    backgroundColor: 'rgba(34, 197, 94, 0.1)',
                    borderRadius: 6,
                    marginBottom: 12
                }}>
                    <CheckCircle size={20} color="#22c55e" />
                    <View style={{ flex: 1, marginLeft: 8 }}>
                        <Text style={{
                            color: '#22c55e',
                            fontSize: 13,
                            fontWeight: '600'
                        }}>
                            Biometria disponível
                        </Text>
                        {biometricTypes.length > 0 && (
                            <Text style={{
                                color: theme.colors.textSecondary,
                                fontSize: 11,
                                marginTop: 2
                            }}>
                                Tipos: {biometricTypes.join(', ')}
                            </Text>
                        )}
                    </View>
                </View>
            )}

            {/* Toggle */}
            <View style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingVertical: 8
            }}>
                <View style={{ flex: 1 }}>
                    <Text style={{
                        fontSize: 14,
                        color: theme.colors.text,
                        fontWeight: '500'
                    }}>
                        Login com Biometria
                    </Text>
                    <Text style={{
                        fontSize: 12,
                        color: theme.colors.textSecondary,
                        marginTop: 2
                    }}>
                        {biometricEnabled
                            ? 'Use sua biometria para fazer login'
                            : 'Habilite para login rápido'}
                    </Text>
                </View>
                <Switch
                    value={biometricEnabled}
                    onValueChange={handleToggle}
                    disabled={!biometricAvailable || loading}
                    trackColor={{
                        false: theme.colors.border,
                        true: theme.colors.primary
                    }}
                    thumbColor="#fff"
                />
            </View>

            {/* Test Button */}
            {biometricAvailable && (
                <TouchableOpacity
                    onPress={testBiometric}
                    disabled={loading}
                    style={{
                        marginTop: 12,
                        paddingVertical: 10,
                        paddingHorizontal: 16,
                        backgroundColor: theme.colors.primaryMuted,
                        borderRadius: 6,
                        borderWidth: 1,
                        borderColor: theme.colors.primary,
                        alignItems: 'center'
                    }}
                >
                    <Text style={{
                        color: theme.colors.primary,
                        fontSize: 12,
                        fontWeight: '600',
                        letterSpacing: 0.5
                    }}>
                        TESTAR BIOMETRIA
                    </Text>
                </TouchableOpacity>
            )}
        </View>
    );
};
