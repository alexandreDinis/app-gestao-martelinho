import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, KeyboardAvoidingView, Platform, Alert, Modal } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { Lock, Mail, Eye, EyeOff, Fingerprint } from 'lucide-react-native';
import { Button, Input, Card } from '../components/ui';
import { theme } from '../theme';

export const LoginScreen = () => {
    const { signIn, signInWithBiometric, biometricAvailable, biometricEnabled, toggleBiometric, completeSignIn } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showBiometricDialog, setShowBiometricDialog] = useState(false);
    const [lastCredentials, setLastCredentials] = useState<{ email: string; password: string } | null>(null);
    const [pendingUserData, setPendingUserData] = useState<any>(null); // UserData esperando conclusão do dialog

    const handleLogin = async () => {
        if (!email || !password) {
            Alert.alert('Erro', 'Por favor, preencha todos os campos.');
            return;
        }

        try {
            setLoading(true);
            setError(null);

            console.log('🔑 [LoginScreen] Attempting login...');
            console.log('🔑 [LoginScreen] biometricAvailable:', biometricAvailable);
            console.log('🔑 [LoginScreen] biometricEnabled:', biometricEnabled);

            const userData = await signIn({ email, password });

            console.log('🔑 [LoginScreen] Login successful, checking biometric dialog...');

            // Se login bem-sucedido e biometria disponível mas não habilitada, perguntar
            if (biometricAvailable && !biometricEnabled) {
                console.log('🔑 [LoginScreen] Showing biometric dialog!');
                setLastCredentials({ email, password });
                setPendingUserData(userData); // Armazena userData
                setShowBiometricDialog(true); // Mostra dialog
            } else {
                console.log('🔑 [LoginScreen] NOT showing dialog - available:', biometricAvailable, 'enabled:', biometricEnabled);
                console.log('🔑 [LoginScreen] Completing sign-in immediately');
                completeSignIn(userData); // Completa login imediatamente
            }
        } catch (err: any) {
            console.error('🔑 [LoginScreen] Login failed:', err);
            if (err.response?.status === 401) {
                setError('Credenciais inválidas. ACESSO NEGADO.');
            } else if (err.response?.status === 429) {
                setError('Muitas tentativas. Tente novamente em 15min.');
            } else {
                setError('Falha na conexão com o servidor.');
            }
        } finally {
            setLoading(false);
        }
    };

    const handleBiometricLogin = async () => {
        try {
            setLoading(true);
            setError(null);
            await signInWithBiometric();
        } catch (err: any) {
            console.error(err);
            setError('Falha na autenticação biométrica. Use email e senha.');
        } finally {
            setLoading(false);
        }
    };

    const handleEnableBiometric = async () => {
        if (!lastCredentials) return;

        try {
            console.log('🔑 [LoginScreen] User accepted biometric, enabling...');
            await toggleBiometric(true, lastCredentials);
            setShowBiometricDialog(false);
            Alert.alert('Sucesso', 'Autenticação biométrica habilitada!');

            // Completa o login após habilitar biometria
            if (pendingUserData) {
                console.log('🔑 [LoginScreen] Completing sign-in after enabling biometric');
                completeSignIn(pendingUserData);
            }
        } catch (err: any) {
            console.error('🔑 [LoginScreen] Failed to enable biometric:', err);
            Alert.alert('Erro', 'Não foi possível habilitar a biometria.');

            // Completa o login mesmo se habilitar biometria falhou
            if (pendingUserData) {
                console.log('🔑 [LoginScreen] Completing sign-in despite biometric error');
                completeSignIn(pendingUserData);
            }
        }
    };

    const handleDeclineBiometric = () => {
        console.log('🔑 [LoginScreen] User declined biometric');
        setShowBiometricDialog(false);

        // Completa o login quando usuário recusa biometria
        if (pendingUserData) {
            console.log('🔑 [LoginScreen] Completing sign-in after user declined');
            completeSignIn(pendingUserData);
        }
    };

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={{
                flex: 1,
                backgroundColor: theme.colors.background,
                justifyContent: 'center',
                alignItems: 'center',
                padding: 24,
            }}
        >
            {/* Grid Background Effect */}
            <View
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    opacity: 0.03,
                }}
            />

            {/* Logo */}
            <View style={{ alignItems: 'center', marginBottom: 40 }}>
                <View
                    style={{
                        width: 64,
                        height: 64,
                        backgroundColor: theme.colors.primaryMuted,
                        borderWidth: 2,
                        borderColor: theme.colors.primary,
                        borderRadius: 12,
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginBottom: 16,
                    }}
                >
                    <Text style={{ color: theme.colors.primary, fontWeight: 'bold', fontSize: 28 }}>S</Text>
                </View>
                <Text
                    style={{
                        fontSize: 24,
                        fontWeight: '900',
                        color: theme.colors.primary,
                        letterSpacing: 3,
                        textTransform: 'uppercase',
                    }}
                >
                    GESTÃO DE SERVIÇOS
                </Text>
                <Text
                    style={{
                        fontSize: 9,
                        color: theme.colors.textMuted,
                        letterSpacing: 2,
                        marginTop: 4,
                    }}
                >
                    V2.5.0 // BIOMETRIC_AUTH
                </Text>
            </View>

            {/* Login Card */}
            <Card style={{ width: '100%', maxWidth: 360 }}>
                {/* Error Message */}
                {error && (
                    <View
                        style={{
                            backgroundColor: 'rgba(239, 68, 68, 0.1)',
                            borderWidth: 1,
                            borderColor: theme.colors.error,
                            padding: 12,
                            marginBottom: 20,
                            borderRadius: 4,
                        }}
                    >
                        <Text style={{ color: theme.colors.error, fontSize: 10, fontWeight: '700', marginBottom: 2 }}>
                            ERRO_CRÍTICO:
                        </Text>
                        <Text style={{ color: theme.colors.error, fontSize: 12 }}>{error}</Text>
                    </View>
                )}

                {/* Biometric Button - mostrar se habilitado */}
                {biometricEnabled && (
                    <TouchableOpacity
                        onPress={handleBiometricLogin}
                        disabled={loading}
                        style={{
                            alignItems: 'center',
                            justifyContent: 'center',
                            paddingVertical: 20,
                            marginBottom: 20,
                            borderWidth: 1,
                            borderColor: theme.colors.primary,
                            borderRadius: 8,
                            backgroundColor: theme.colors.primaryMuted,
                        }}
                    >
                        <Fingerprint size={48} color={theme.colors.primary} />
                        <Text style={{
                            color: theme.colors.primary,
                            fontSize: 12,
                            marginTop: 8,
                            fontWeight: '600',
                            letterSpacing: 1
                        }}>
                            AUTENTICAR COM BIOMETRIA
                        </Text>
                    </TouchableOpacity>
                )}

                {biometricEnabled && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}>
                        <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.border }} />
                        <Text style={{
                            marginHorizontal: 12,
                            color: theme.colors.textMuted,
                            fontSize: 10,
                            letterSpacing: 1
                        }}>
                            OU USE EMAIL/SENHA
                        </Text>
                        <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.border }} />
                    </View>
                )}

                {/* Email Input */}
                <Input
                    label="ID_USUÁRIO"
                    placeholder="usuario@gestao.com"
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    icon={<Mail size={16} color={theme.colors.textSecondary} />}
                    containerStyle={{ marginBottom: 20 }}
                />

                {/* Password Input */}
                <View style={{ marginBottom: 24 }}>
                    <Input
                        label="CHAVE_ACESSO"
                        placeholder="••••••••"
                        value={password}
                        onChangeText={setPassword}
                        secureTextEntry={!showPassword}
                        icon={<Lock size={16} color={theme.colors.textSecondary} />}
                    />
                    <TouchableOpacity
                        onPress={() => setShowPassword(!showPassword)}
                        style={{
                            position: 'absolute',
                            right: 12,
                            bottom: 14,
                            padding: 4,
                        }}
                    >
                        {showPassword ? (
                            <EyeOff size={18} color={theme.colors.textMuted} />
                        ) : (
                            <Eye size={18} color={theme.colors.textMuted} />
                        )}
                    </TouchableOpacity>
                </View>

                {/* Login Button */}
                <Button onPress={handleLogin} loading={loading} disabled={loading}>
                    {loading ? '>>> AUTENTICANDO...' : 'INICIAR_SESSÃO >>'}
                </Button>

                {/* Forgot Password */}
                <TouchableOpacity style={{ marginTop: 16, alignItems: 'center' }}>
                    <Text style={{ color: theme.colors.textMuted, fontSize: 10, letterSpacing: 1 }}>
                        ESQUECI MINHA SENHA
                    </Text>
                </TouchableOpacity>

                {/* Footer */}
                <Text
                    style={{
                        textAlign: 'center',
                        marginTop: 24,
                        fontSize: 9,
                        color: theme.colors.textMuted,
                        opacity: 0.5,
                    }}
                >
                    ACESSO RESTRITO A PESSOAL AUTORIZADO
                </Text>
            </Card>

            {/* Dialog para habilitar biometria */}
            <Modal
                visible={showBiometricDialog}
                transparent
                animationType="fade"
                onRequestClose={handleDeclineBiometric}
            >
                <View style={{
                    flex: 1,
                    backgroundColor: 'rgba(0,0,0,0.8)',
                    justifyContent: 'center',
                    alignItems: 'center',
                    padding: 24
                }}>
                    <Card style={{ width: '100%', maxWidth: 360 }}>
                        <View style={{ alignItems: 'center', marginBottom: 20 }}>
                            <Fingerprint size={64} color={theme.colors.primary} />
                        </View>

                        <Text style={{
                            fontSize: 18,
                            fontWeight: 'bold',
                            color: theme.colors.text,
                            textAlign: 'center',
                            marginBottom: 12
                        }}>
                            Habilitar Biometria?
                        </Text>

                        <Text style={{
                            fontSize: 14,
                            color: theme.colors.textSecondary,
                            textAlign: 'center',
                            marginBottom: 24,
                            lineHeight: 20
                        }}>
                            Acesse o app rapidamente usando sua impressão digital ou reconhecimento facial.
                        </Text>

                        <Button onPress={handleEnableBiometric} style={{ marginBottom: 12 }}>
                            HABILITAR
                        </Button>

                        <TouchableOpacity
                            onPress={handleDeclineBiometric}
                            style={{ padding: 12, alignItems: 'center' }}
                        >
                            <Text style={{
                                color: theme.colors.textMuted,
                                fontSize: 12,
                                letterSpacing: 1
                            }}>
                                AGORA NÃO
                            </Text>
                        </TouchableOpacity>
                    </Card>
                </View>
            </Modal>
        </KeyboardAvoidingView>
    );
};
