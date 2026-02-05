import React, { useState } from 'react';
import { View, Text, TouchableOpacity, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { Lock, Mail, Eye, EyeOff } from 'lucide-react-native';
import { Button, Input, Card } from '../components/ui';
import { theme } from '../theme';

export const LoginScreen = () => {
    const { signIn } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleLogin = async () => {
        if (!email || !password) {
            Alert.alert('Erro', 'Por favor, preencha todos os campos.');
            return;
        }

        try {
            setLoading(true);
            setError(null);
            await signIn({ email, password });
        } catch (err: any) {
            console.error(err);
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
                    V2.4.0 // SECURE_ACCESS
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
        </KeyboardAvoidingView>
    );
};
