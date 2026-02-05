import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../navigation/types';
import { ArrowLeft, Save } from 'lucide-react-native';
import { theme } from '../theme';
import { clienteService } from '../services/clienteService';
import { ClienteRequest, StatusCliente, TipoPessoa } from '../types';

export const ClientFormScreen = () => {
    const navigation = useNavigation();
    const route = useRoute<RouteProp<RootStackParamList, 'ClientForm'>>();
    const { clienteId } = route.params || {};

    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    // Form State
    const [formData, setFormData] = useState<ClienteRequest>({
        razaoSocial: '',
        nomeFantasia: '',
        cnpj: '',
        cpf: '',
        tipoPessoa: 'JURIDICA',
        endereco: '', // Legacy field, keeping empty or syncing with logradouro
        contato: '',
        email: '',
        status: 'ATIVO',
        // Address
        cep: '',
        logradouro: '',
        numero: '',
        complemento: '',
        bairro: '',
        cidade: '',
        estado: '',
    });

    useEffect(() => {
        if (clienteId) {
            loadCliente(clienteId);
        }
    }, [clienteId]);

    const loadCliente = async (id: number) => {
        try {
            setLoading(true);
            const data = await clienteService.getById(id);
            setFormData({
                razaoSocial: data.razaoSocial || '',
                nomeFantasia: data.nomeFantasia || '',
                cnpj: data.cnpj || '',
                cpf: data.cpf || '',
                tipoPessoa: data.tipoPessoa || 'JURIDICA',
                endereco: data.endereco || '',
                contato: data.contato || '',
                email: data.email || '',
                status: data.status || 'ATIVO',
                cep: data.cep || '',
                logradouro: data.logradouro || '',
                numero: data.numero || '',
                complemento: data.complemento || '',
                bairro: data.bairro || '',
                cidade: data.cidade || '',
                estado: data.estado || '',
            });
        } catch (error) {
            Alert.alert('Erro', 'Não foi possível carregar os dados do cliente.');
            navigation.goBack();
        } finally {
            setLoading(false);
        }
    };

    const handleChange = (field: keyof ClienteRequest, value: string) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const handleSave = async () => {
        if (!formData.razaoSocial || !formData.nomeFantasia) {
            Alert.alert('Atenção', 'Razão Social e Nome Fantasia são obrigatórios.');
            return;
        }

        try {
            setSaving(true);
            if (clienteId) {
                await clienteService.update(clienteId, formData);
                Alert.alert('Sucesso', 'Cliente atualizado com sucesso!');
            } else {
                await clienteService.create(formData);
                Alert.alert('Sucesso', 'Cliente cadastrado com sucesso!');
            }
            navigation.goBack();
        } catch (error) {
            console.error(error);
            Alert.alert('Erro', 'Ocorreu um erro ao salvar o cliente.');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <View style={{ flex: 1, backgroundColor: theme.colors.background, justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator size="large" color={theme.colors.primary} />
            </View>
        );
    }

    return (
        <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
            {/* Header */}
            <View
                style={{
                    paddingTop: 50,
                    paddingHorizontal: 16,
                    paddingBottom: 16,
                    backgroundColor: theme.colors.backgroundSecondary,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderBottomWidth: 1,
                    borderBottomColor: theme.colors.border,
                }}
            >
                <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 8 }}>
                    <ArrowLeft size={24} color={theme.colors.text} />
                </TouchableOpacity>
                <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: '700' }}>
                    {clienteId ? 'Editar Cliente' : 'Novo Cliente'}
                </Text>
                <TouchableOpacity onPress={handleSave} disabled={saving} style={{ padding: 8 }}>
                    {saving ? (
                        <ActivityIndicator size="small" color={theme.colors.primary} />
                    ) : (
                        <Save size={24} color={theme.colors.primary} />
                    )}
                </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
                {/* Dados Principais */}
                <Text style={{ color: theme.colors.primary, fontSize: 14, fontWeight: '700', marginBottom: 12, marginTop: 8 }}>
                    DADOS PRINCIPAIS
                </Text>

                <View style={{ gap: 12 }}>
                    <Input
                        label="Razão Social *"
                        value={formData.razaoSocial}
                        onChangeText={(t) => handleChange('razaoSocial', t)}
                        placeholder="Ex: Empresa LTDA"
                    />
                    <Input
                        label="Nome Fantasia *"
                        value={formData.nomeFantasia}
                        onChangeText={(t) => handleChange('nomeFantasia', t)}
                        placeholder="Ex: Nome Comercial"
                    />

                    <View style={{ flexDirection: 'row', gap: 12 }}>
                        <View style={{ flex: 1 }}>
                            <Input
                                label="CNPJ"
                                value={formData.cnpj || ''}
                                onChangeText={(t) => handleChange('cnpj', t)}
                                keyboardType="numeric"
                            />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Input
                                label="CPF"
                                value={formData.cpf || ''}
                                onChangeText={(t) => handleChange('cpf', t)}
                                keyboardType="numeric"
                            />
                        </View>
                    </View>
                </View>

                {/* Contato */}
                <Text style={{ color: theme.colors.primary, fontSize: 14, fontWeight: '700', marginBottom: 12, marginTop: 24 }}>
                    CONTATO
                </Text>

                <View style={{ gap: 12 }}>
                    <Input
                        label="Telefone / WhatsApp"
                        value={formData.contato}
                        onChangeText={(t) => handleChange('contato', t)}
                        keyboardType="phone-pad"
                    />
                    <Input
                        label="Email"
                        value={formData.email}
                        onChangeText={(t) => handleChange('email', t)}
                        keyboardType="email-address"
                        autoCapitalize="none"
                    />
                </View>

                {/* Endereço */}
                <Text style={{ color: theme.colors.primary, fontSize: 14, fontWeight: '700', marginBottom: 12, marginTop: 24 }}>
                    ENDEREÇO
                </Text>

                <View style={{ gap: 12 }}>
                    <Input
                        label="CEP"
                        value={formData.cep}
                        onChangeText={(t) => handleChange('cep', t)}
                        keyboardType="numeric"
                    />
                    <View style={{ flexDirection: 'row', gap: 12 }}>
                        <View style={{ flex: 3 }}>
                            <Input
                                label="Logradouro"
                                value={formData.logradouro}
                                onChangeText={(t) => handleChange('logradouro', t)}
                            />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Input
                                label="Número"
                                value={formData.numero}
                                onChangeText={(t) => handleChange('numero', t)}
                            />
                        </View>
                    </View>
                    <Input
                        label="Complemento"
                        value={formData.complemento || ''}
                        onChangeText={(t) => handleChange('complemento', t)}
                    />
                    <Input
                        label="Bairro"
                        value={formData.bairro}
                        onChangeText={(t) => handleChange('bairro', t)}
                    />
                    <View style={{ flexDirection: 'row', gap: 12 }}>
                        <View style={{ flex: 3 }}>
                            <Input
                                label="Cidade"
                                value={formData.cidade}
                                onChangeText={(t) => handleChange('cidade', t)}
                            />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Input
                                label="UF"
                                value={formData.estado}
                                onChangeText={(t) => handleChange('estado', t)}
                                maxLength={2}
                                autoCapitalize="characters"
                            />
                        </View>
                    </View>
                </View>

                {/* Status Selection could be added here later if needed */}

                <View style={{ height: 40 }} />
            </ScrollView>
        </View>
    );
};

interface InputProps {
    label: string;
    value: string;
    onChangeText: (text: string) => void;
    placeholder?: string;
    keyboardType?: 'default' | 'number-pad' | 'decimal-pad' | 'numeric' | 'email-address' | 'phone-pad';
    maxLength?: number;
    autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}

// Helper Input Component
const Input = ({ label, value, onChangeText, placeholder, keyboardType, maxLength, autoCapitalize }: InputProps) => (
    <View>
        <Text style={{ color: theme.colors.textMuted, fontSize: 12, marginBottom: 4 }}>{label}</Text>
        <TextInput
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={theme.colors.textMuted}
            keyboardType={keyboardType}
            maxLength={maxLength}
            autoCapitalize={autoCapitalize}
            style={{
                backgroundColor: 'rgba(255,255,255,0.05)',
                borderWidth: 1,
                borderColor: theme.colors.border,
                borderRadius: 8,
                padding: 12,
                color: theme.colors.text,
                fontSize: 16,
            }}
        />
    </View>
);
