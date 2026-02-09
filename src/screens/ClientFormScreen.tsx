import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../navigation/types';
import { ArrowLeft, Save } from 'lucide-react-native';
import { theme } from '../theme';
import { clienteService } from '../services/clienteService';
import { ClienteRequest, StatusCliente, TipoPessoa } from '../types';
import { OfflineDebug } from '../utils/OfflineDebug';
import { ClienteModel } from '../services/database/models/ClienteModel';
import { Input } from '../components/ui';
import Toast from 'react-native-toast-message';
import { showApiErrorToast } from '../utils/apiErrorUtils';

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
        endereco: '',
        contato: '',
        email: '',
        status: 'ATIVO',
        cep: '',
        logradouro: '',
        numero: '',
        complemento: '',
        bairro: '',
        cidade: '',
        estado: '',
    });

    // Field-level errors
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

    useEffect(() => {
        if (clienteId) {
            loadCliente(clienteId);
        }
    }, [clienteId]);

    const loadCliente = async (id: number) => {
        try {
            setLoading(true);

            console.log(`[ClientForm] Loading cliente ${id} - checking local DB first`);
            const localCliente = await ClienteModel.getByServerId(id);

            if (localCliente) {
                console.log('[ClientForm] Found in local DB, using local data');
                const formattedData = ClienteModel.toApiFormat(localCliente);
                setFormData({
                    razaoSocial: formattedData.razaoSocial || '',
                    nomeFantasia: formattedData.nomeFantasia || '',
                    cnpj: formattedData.cnpj || '',
                    cpf: formattedData.cpf || '',
                    tipoPessoa: formattedData.tipoPessoa || 'JURIDICA',
                    endereco: formattedData.logradouro || '',
                    contato: formattedData.contato || '',
                    email: formattedData.email || '',
                    status: formattedData.status || 'ATIVO',
                    cep: formattedData.cep || '',
                    logradouro: formattedData.logradouro || '',
                    numero: formattedData.numero || '',
                    complemento: formattedData.complemento || '',
                    bairro: formattedData.bairro || '',
                    cidade: formattedData.cidade || '',
                    estado: formattedData.estado || '',
                });
                return;
            }

            if (!OfflineDebug.isForceOffline()) {
                console.log('[ClientForm] Not found locally, fetching from API');
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
            } else {
                throw new Error('Cliente não encontrado no banco local e modo offline ativo');
            }
        } catch (error) {
            console.error('[ClientForm] Error loading cliente:', error);
            Toast.show({ type: 'error', text1: 'Erro', text2: 'Não foi possível carregar os dados do cliente.' });
            navigation.goBack();
        } finally {
            setLoading(false);
        }
    };

    const handleChange = (field: keyof ClienteRequest, value: string) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        // Limpar erro do campo quando o usuário digita
        if (fieldErrors[field]) {
            setFieldErrors(prev => {
                const next = { ...prev };
                delete next[field];
                return next;
            });
        }
    };

    /** Validação client-side alinhada com backend (apenas nomeFantasia obrigatório) */
    const validate = (): boolean => {
        const errors: Record<string, string> = {};

        if (!formData.nomeFantasia.trim()) errors.nomeFantasia = 'Nome Fantasia é obrigatório';

        // Validação condicional de Email se preenchido
        if (formData.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
            errors.email = 'Email inválido';
        }

        setFieldErrors(errors);

        if (Object.keys(errors).length > 0) {
            Toast.show({
                type: 'error',
                text1: 'Campos obrigatórios',
                text2: 'Preencha o Nome Fantasia',
                topOffset: 60,
            });
            return false;
        }

        return true;
    };

    const handleSave = async () => {
        if (!validate()) return;

        try {
            setSaving(true);

            const isOffline = OfflineDebug.isForceOffline();

            if (clienteId) {
                await clienteService.update(clienteId, formData);
                Toast.show({
                    type: 'success',
                    text1: isOffline ? '✅ Salvo Localmente!' : 'Sucesso',
                    text2: isOffline
                        ? 'Cliente atualizado no dispositivo. Será sincronizado quando voltar online.'
                        : 'Cliente atualizado com sucesso!',
                    topOffset: 60,
                });
                navigation.goBack();
            } else {
                await clienteService.create(formData);
                Toast.show({
                    type: 'success',
                    text1: isOffline ? '✅ Salvo Localmente!' : 'Sucesso',
                    text2: isOffline
                        ? 'Cliente cadastrado no dispositivo. Será sincronizado quando voltar online.'
                        : 'Cliente cadastrado com sucesso!',
                    topOffset: 60,
                });
                navigation.goBack();
            }
        } catch (error) {
            console.error('[ClientForm] Error saving:', error);
            const apiErrors = showApiErrorToast(error, 'Erro ao salvar cliente');
            // Mapear erros do backend para os campos do formulário
            if (Object.keys(apiErrors.fieldErrors).length > 0) {
                setFieldErrors(prev => ({ ...prev, ...apiErrors.fieldErrors }));
            }
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
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
                    <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 8 }}>
                        <ArrowLeft size={24} color={theme.colors.text} />
                    </TouchableOpacity>
                    <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: '700', flex: 1 }}>
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
            </View>

            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
                {/* Dados Principais */}
                <Text style={{ color: theme.colors.primary, fontSize: 10, fontWeight: '700', letterSpacing: 2, marginBottom: 12, marginTop: 8 }}>
                    DADOS PRINCIPAIS
                </Text>

                <View style={{ gap: 12 }}>
                    <Input
                        label="NOME FANTASIA *"
                        value={formData.nomeFantasia}
                        onChangeText={(t) => handleChange('nomeFantasia', t)}
                        placeholder="Ex: Nome Comercial"
                        error={fieldErrors.nomeFantasia}
                    />
                    <Input
                        label="RAZÃO SOCIAL"
                        value={formData.razaoSocial}
                        onChangeText={(t) => handleChange('razaoSocial', t)}
                        placeholder="Ex: Empresa LTDA"
                        error={fieldErrors.razaoSocial}
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
                <Text style={{ color: theme.colors.primary, fontSize: 10, fontWeight: '700', letterSpacing: 2, marginBottom: 12, marginTop: 24 }}>
                    CONTATO
                </Text>

                <View style={{ gap: 12 }}>
                    <Input
                        label="TELEFONE / WHATSAPP"
                        value={formData.contato}
                        onChangeText={(t) => handleChange('contato', t)}
                        keyboardType="phone-pad"
                        placeholder="Ex: (11) 99999-9999"
                        error={fieldErrors.contato}
                    />
                    <Input
                        label="EMAIL"
                        value={formData.email}
                        onChangeText={(t) => handleChange('email', t)}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        placeholder="Ex: contato@empresa.com"
                        error={fieldErrors.email}
                    />
                </View>

                {/* Endereço */}
                <Text style={{ color: theme.colors.primary, fontSize: 10, fontWeight: '700', letterSpacing: 2, marginBottom: 12, marginTop: 24 }}>
                    ENDEREÇO
                </Text>

                <View style={{ gap: 12 }}>
                    <Input
                        label="CEP"
                        value={formData.cep}
                        onChangeText={(t) => handleChange('cep', t)}
                        keyboardType="numeric"
                        placeholder="Ex: 01310-100"
                    />
                    <View style={{ flexDirection: 'row', gap: 12 }}>
                        <View style={{ flex: 3 }}>
                            <Input
                                label="LOGRADOURO"
                                value={formData.logradouro}
                                onChangeText={(t) => handleChange('logradouro', t)}
                                placeholder="Ex: Av. Paulista"
                                error={fieldErrors.logradouro}
                            />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Input
                                label="NÚMERO"
                                value={formData.numero}
                                onChangeText={(t) => handleChange('numero', t)}
                                placeholder="Nº"
                            />
                        </View>
                    </View>
                    <Input
                        label="COMPLEMENTO"
                        value={formData.complemento || ''}
                        onChangeText={(t) => handleChange('complemento', t)}
                        placeholder="Ex: Sala 101"
                    />
                    <Input
                        label="BAIRRO"
                        value={formData.bairro}
                        onChangeText={(t) => handleChange('bairro', t)}
                        placeholder="Ex: Bela Vista"
                    />
                    <View style={{ flexDirection: 'row', gap: 12 }}>
                        <View style={{ flex: 3 }}>
                            <Input
                                label="CIDADE"
                                value={formData.cidade}
                                onChangeText={(t) => handleChange('cidade', t)}
                                placeholder="Ex: São Paulo"
                                error={fieldErrors.cidade}
                            />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Input
                                label="UF"
                                value={formData.estado}
                                onChangeText={(t) => handleChange('estado', t)}
                                maxLength={2}
                                autoCapitalize="characters"
                                placeholder="SP"
                                error={fieldErrors.estado}
                            />
                        </View>
                    </View>
                </View>

                <View style={{ height: 40 }} />
            </ScrollView>
        </View>
    );
};
