import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator, FlatList, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { ChevronLeft, Search, User, Car, Calendar, CheckCircle, X, ChevronRight, Users } from 'lucide-react-native';
import { osService } from '../services/osService';
import { userService } from '../services/userService';
import { Cliente } from '../types';
import { RootStackParamList } from '../navigation/types';
import { theme } from '../theme';
import { Card, Button, Input, NetworkStatusDot } from '../components/ui';
import { SimplePlateInput } from '../components/forms/SimplePlateInput';
import Toast from 'react-native-toast-message';


import { showApiErrorToast } from '../utils/apiErrorUtils';

// ...

const getClientInitials = (client: Cliente) => {
    const name = client.nomeFantasia || client.razaoSocial || '?';
    return name.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('');
};

export const CreateOSScreen = () => {
    const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();

    // Form State
    const [selectedClient, setSelectedClient] = useState<Cliente | null>(null);
    const [plate, setPlate] = useState('');
    const [model, setModel] = useState('');
    const [color, setColor] = useState('');

    // Search State
    const [searchTerm, setSearchTerm] = useState('');
    const [clients, setClients] = useState<Cliente[]>([]);
    const [filteredClients, setFilteredClients] = useState<Cliente[]>([]);
    const [showClientModal, setShowClientModal] = useState(false);

    // Responsible User
    const [users, setUsers] = useState<any[]>([]);
    const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
    const [showUserModal, setShowUserModal] = useState(false);

    // Loading States
    const [loadingClients, setLoadingClients] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [loadingPlate, setLoadingPlate] = useState(false);

    useEffect(() => {
        if (showClientModal) {
            fetchClients();
        }
    }, [showClientModal]);

    useEffect(() => {
        if (searchTerm.trim() === '') {
            setFilteredClients(clients);
        } else {
            const term = searchTerm.toLowerCase();
            setFilteredClients(clients.filter(c =>
                c.nomeFantasia?.toLowerCase().includes(term) ||
                c.razaoSocial?.toLowerCase().includes(term) ||
                c.cpf?.includes(term) ||
                c.cnpj?.includes(term) ||
                c.contato?.toLowerCase().includes(term)
            ));
        }
    }, [searchTerm, clients]);

    const fetchClients = async () => {
        setLoadingClients(true);
        try {
            const data = await osService.listClientes();
            setClients(data);
            setFilteredClients(data);
        } catch (error) {
            Toast.show({ type: 'error', text1: 'Erro', text2: 'Falha ao carregar clientes', topOffset: 60 });
        } finally {
            setLoadingClients(false);
        }
    };

    useEffect(() => {
        loadUsers();
    }, []);

    const loadUsers = async () => {
        try {
            const data = await userService.getUsers();
            setUsers(data);
        } catch (e) {
            console.error('Failed to load users', e);
        }
    };

    const handleCheckPlate = async () => {
        const placaLimpa = plate.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
        if (placaLimpa.length < 3) {
            Alert.alert('Atenção', 'Digite pelo menos 3 caracteres.');
            return;
        }

        setLoadingPlate(true);
        try {
            const check = await osService.verificarPlaca(placaLimpa);
            if (check.existe && check.veiculoExistente) {
                Alert.alert(
                    'Veículo Encontrado',
                    `Modelo: ${check.veiculoExistente.modelo}\nCor: ${check.veiculoExistente.cor}\n\nDeseja carregar estes dados?`,
                    [
                        { text: 'Não', style: 'cancel' },
                        {
                            text: 'Sim, preencher',
                            onPress: () => {
                                setModel(check.veiculoExistente!.modelo || '');
                                setColor(check.veiculoExistente!.cor || '');
                                Toast.show({
                                    type: 'success',
                                    text1: 'Dados preenchidos',
                                });
                            }
                        }
                    ]
                );
            } else {
                Toast.show({
                    type: 'info',
                    text1: 'Veículo Novo',
                    text2: 'Preencha os dados manualmente.',
                });
            }
        } catch (error) {
            console.error(error);
        } finally {
            setLoadingPlate(false);
        }
    };

    const handleCreate = async () => {
        if (!selectedClient?.localId) {
            Alert.alert('Atenção', 'Selecione um cliente válido (ID local ausente). Tente recarregar.');
            return;
        }
        if (!plate || !model) {
            Alert.alert('Atenção', 'Preencha os dados do veículo (Placa e Modelo).');
            return;
        }

        try {
            setSubmitting(true);

            console.log('[CreateOS] 🔍 Step 1: Starting OS creation...');
            console.log('[CreateOS] 🔍 selectedClient:', JSON.stringify({
                id: selectedClient.id,
                localId: selectedClient.localId,
                razaoSocial: selectedClient.razaoSocial,
            }));
            console.log('[CreateOS] 🔍 selectedUserId:', selectedUserId);

            // 1. Create OS Header
            const os = await osService.createOS({
                clienteId: selectedClient.id,
                clienteLocalId: selectedClient.localId,
                data: new Date().toISOString().split('T')[0],
                usuarioId: selectedUserId || undefined
            });

            console.log('[CreateOS] ✅ Step 1 OK: OS created', { id: os.id, localId: os.localId });

            // 2. Add Vehicle
            console.log('[CreateOS] 🔍 Step 2: Adding vehicle...');
            await osService.addVeiculo({
                ordemServicoId: os.id,
                osLocalId: os.localId, // Grampo de UUID para garantir vínculo correto offline
                placa: plate.replace(/[^a-zA-Z0-9]/g, '').toUpperCase(),
                modelo: model,
                cor: color || 'Não informada'
            });

            console.log('[CreateOS] ✅ Step 2 OK: Vehicle added');

            Alert.alert('Sucesso', 'Ordem de serviço criada!');
            navigation.replace('OSDetails', { osId: os.id });

        } catch (error: any) {
            console.error('[CreateOS] ❌ ERRO:', error?.message || error);
            console.error('[CreateOS] ❌ Stack:', error?.stack);

            // Mostrar o erro REAL no toast para diagnóstico
            const realMessage = error?.message || 'Erro desconhecido';
            Toast.show({
                type: 'error',
                text1: 'Falha ao criar OS',
                text2: realMessage,
                visibilityTime: 8000,
                topOffset: 60,
            });
        } finally {
            setSubmitting(false);
        }
    };

    const selectClient = (client: Cliente) => {
        setSelectedClient(client);
        setShowClientModal(false);
        setSearchTerm('');
    };

    const selectedUser = users.find(u => u.id === selectedUserId);

    return (
        <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
            {/* Header */}
            <View
                style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingHorizontal: 16,
                    paddingTop: 50,
                    paddingBottom: 16,
                    backgroundColor: theme.colors.backgroundSecondary,
                    borderBottomWidth: 1,
                    borderBottomColor: theme.colors.border,
                }}
            >
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginRight: 16 }}>
                        <ChevronLeft size={24} color={theme.colors.primary} />
                    </TouchableOpacity>
                    <View>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Text style={{ color: theme.colors.primary, fontSize: 18, fontWeight: '900', letterSpacing: 1 }}>NOVA OS</Text>
                            <NetworkStatusDot />
                        </View>
                        <Text style={{ color: theme.colors.textMuted, fontSize: 10, letterSpacing: 1 }}>Preencha os dados iniciais</Text>
                    </View>
                </View>
            </View>

            <KeyboardAvoidingView
                style={{ flex: 1 }}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
            >
                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 100 }}>
                    {/* Client Selection */}
                    <Text style={{ color: theme.colors.primary, fontSize: 10, fontWeight: '700', letterSpacing: 2, marginBottom: 8 }}>
                        CLIENTE
                    </Text>
                    <TouchableOpacity onPress={() => setShowClientModal(true)} activeOpacity={0.7}>
                        <View
                            style={{
                                backgroundColor: theme.colors.backgroundSecondary,
                                borderRadius: 12,
                                padding: 16,
                                marginBottom: 24,
                                borderWidth: 1,
                                borderColor: selectedClient ? 'rgba(212, 175, 55, 0.4)' : theme.colors.border,
                            }}
                        >
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <View
                                    style={{
                                        width: 44,
                                        height: 44,
                                        backgroundColor: selectedClient ? theme.colors.primaryMuted : 'rgba(255,255,255,0.05)',
                                        borderRadius: 22,
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        marginRight: 12,
                                        borderWidth: 1,
                                        borderColor: selectedClient ? 'rgba(212, 175, 55, 0.3)' : theme.colors.border,
                                    }}
                                >
                                    {selectedClient ? (
                                        <Text style={{ color: theme.colors.primary, fontSize: 15, fontWeight: '900' }}>
                                            {getClientInitials(selectedClient)}
                                        </Text>
                                    ) : (
                                        <User size={20} color={theme.colors.textMuted} />
                                    )}
                                </View>
                                <View style={{ flex: 1 }}>
                                    {selectedClient ? (
                                        <>
                                            <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '700' }}>
                                                {selectedClient.nomeFantasia || selectedClient.razaoSocial}
                                            </Text>
                                            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
                                                {selectedClient.contato && (
                                                    <Text style={{ color: theme.colors.textSecondary, fontSize: 11 }}>
                                                        {selectedClient.contato}
                                                    </Text>
                                                )}
                                                {selectedClient.contato && (selectedClient.cpf || selectedClient.cnpj) && (
                                                    <Text style={{ color: theme.colors.textMuted, fontSize: 11 }}> • </Text>
                                                )}
                                                <Text style={{ color: theme.colors.textMuted, fontSize: 11 }}>
                                                    {selectedClient.cpf || selectedClient.cnpj}
                                                </Text>
                                            </View>
                                        </>
                                    ) : (
                                        <>
                                            <Text style={{ color: theme.colors.textMuted, fontSize: 14 }}>Toque para selecionar...</Text>
                                            <Text style={{ color: theme.colors.textMuted, fontSize: 10, marginTop: 2 }}>Busque por nome, CPF ou CNPJ</Text>
                                        </>
                                    )}
                                </View>
                                <ChevronRight size={18} color={theme.colors.textMuted} />
                            </View>
                        </View>
                    </TouchableOpacity>

                    {/* Responsible User Selection */}
                    <Text style={{ color: theme.colors.primary, fontSize: 10, fontWeight: '700', letterSpacing: 2, marginBottom: 8 }}>
                        RESPONSÁVEL (VENDEDOR)
                    </Text>
                    <TouchableOpacity onPress={() => setShowUserModal(true)} activeOpacity={0.7}>
                        <View
                            style={{
                                backgroundColor: theme.colors.backgroundSecondary,
                                borderRadius: 12,
                                padding: 16,
                                marginBottom: 24,
                                borderWidth: 1,
                                borderColor: selectedUser ? 'rgba(212, 175, 55, 0.4)' : theme.colors.border,
                            }}
                        >
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <View
                                    style={{
                                        width: 44,
                                        height: 44,
                                        backgroundColor: selectedUser ? 'rgba(59, 130, 246, 0.15)' : 'rgba(255,255,255,0.05)',
                                        borderRadius: 22,
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        marginRight: 12,
                                        borderWidth: 1,
                                        borderColor: selectedUser ? 'rgba(59, 130, 246, 0.3)' : theme.colors.border,
                                    }}
                                >
                                    <Users size={20} color={selectedUser ? '#3b82f6' : theme.colors.textMuted} />
                                </View>
                                <View style={{ flex: 1 }}>
                                    {selectedUser ? (
                                        <>
                                            <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '700' }}>
                                                {selectedUser.name || 'Sem nome'}
                                            </Text>
                                            {selectedUser.email && (
                                                <Text style={{ color: theme.colors.textMuted, fontSize: 11, marginTop: 2 }}>{selectedUser.email}</Text>
                                            )}
                                        </>
                                    ) : (
                                        <>
                                            <Text style={{ color: theme.colors.textMuted, fontSize: 14 }}>Toque para selecionar...</Text>
                                            <Text style={{ color: theme.colors.textMuted, fontSize: 10, marginTop: 2 }}>Opcional</Text>
                                        </>
                                    )}
                                </View>
                                <ChevronRight size={18} color={theme.colors.textMuted} />
                            </View>
                        </View>
                    </TouchableOpacity>

                    {/* Vehicle Form */}
                    <Text style={{ color: theme.colors.primary, fontSize: 10, fontWeight: '700', letterSpacing: 2, marginBottom: 8 }}>
                        VEÍCULO
                    </Text>
                    <Card style={{ marginBottom: 24 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
                            <Car size={18} color={theme.colors.primary} />
                            <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginLeft: 8 }}>Dados do veículo</Text>
                        </View>

                        <View style={{ marginBottom: 16 }}>
                            <SimplePlateInput
                                value={plate}
                                onChange={setPlate}
                                onSearch={handleCheckPlate}
                                isSearching={loadingPlate}
                                buttonLabel="VERIFICAR PLACA"
                            />
                        </View>
                        <Input
                            label="MODELO"
                            placeholder="Ex: Fiat Uno"
                            value={model}
                            onChangeText={setModel}
                            containerStyle={{ marginBottom: 16 }}
                        />
                        <Input
                            label="COR"
                            placeholder="Ex: Prata"
                            value={color}
                            onChangeText={setColor}
                        />
                    </Card>

                    {/* Date Info */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 24 }}>
                        <Calendar size={14} color={theme.colors.textMuted} />
                        <Text style={{ color: theme.colors.textMuted, fontSize: 11, marginLeft: 8 }}>
                            Data de abertura: {new Date().toLocaleDateString('pt-BR')}
                        </Text>
                    </View>

                    {/* Submit Button */}
                    <Button onPress={handleCreate} loading={submitting} disabled={submitting}>
                        {submitting ? 'CRIANDO...' : 'CRIAR ORDEM >>'}
                    </Button>
                </ScrollView >
            </KeyboardAvoidingView>

            {/* Client Selection Modal */}
            <Modal visible={showClientModal} animationType="slide" transparent>
                <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'flex-end' }}>
                    <View
                        style={{
                            flex: 1,
                            marginTop: 60,
                            backgroundColor: theme.colors.backgroundSecondary,
                            borderTopLeftRadius: 24,
                            borderTopRightRadius: 24,
                            borderWidth: 1,
                            borderColor: theme.colors.border,
                            overflow: 'hidden',
                        }}
                    >
                        {/* Modal Header */}
                        <View style={{ padding: 20, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                                <View>
                                    <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: '900' }}>Selecionar Cliente</Text>
                                    <Text style={{ color: theme.colors.textMuted, fontSize: 11, marginTop: 2 }}>
                                        {loadingClients ? 'Carregando...' : `${filteredClients.length} cliente${filteredClients.length !== 1 ? 's' : ''} encontrado${filteredClients.length !== 1 ? 's' : ''}`}
                                    </Text>
                                </View>
                                <TouchableOpacity
                                    onPress={() => { setShowClientModal(false); setSearchTerm(''); }}
                                    style={{
                                        width: 36, height: 36, borderRadius: 18,
                                        backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center',
                                        borderWidth: 1, borderColor: theme.colors.border,
                                    }}
                                >
                                    <X size={18} color={theme.colors.textMuted} />
                                </TouchableOpacity>
                            </View>
                            {/* Search Input */}
                            <View
                                style={{
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    backgroundColor: 'rgba(0,0,0,0.4)',
                                    borderRadius: 10,
                                    borderWidth: 1,
                                    borderColor: theme.colors.border,
                                    paddingHorizontal: 12,
                                }}
                            >
                                <Search size={16} color={theme.colors.textMuted} />
                                <TextInput
                                    placeholder="Buscar por nome, CPF, CNPJ..."
                                    placeholderTextColor={theme.colors.textMuted}
                                    value={searchTerm}
                                    onChangeText={setSearchTerm}
                                    autoFocus
                                    style={{
                                        flex: 1,
                                        color: theme.colors.text,
                                        paddingHorizontal: 10,
                                        paddingVertical: 12,
                                        fontSize: 14,
                                    }}
                                />
                                {searchTerm.length > 0 && (
                                    <TouchableOpacity onPress={() => setSearchTerm('')}>
                                        <X size={16} color={theme.colors.textMuted} />
                                    </TouchableOpacity>
                                )}
                            </View>
                        </View>

                        {/* Client List */}
                        {loadingClients ? (
                            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                                <ActivityIndicator size="large" color={theme.colors.primary} />
                                <Text style={{ color: theme.colors.textMuted, marginTop: 12, fontSize: 12 }}>Carregando clientes...</Text>
                            </View>
                        ) : (
                            <FlatList
                                data={filteredClients}
                                keyExtractor={(item) => item.localId || `temp-${item.id}`}
                                contentContainerStyle={{ paddingVertical: 8 }}
                                renderItem={({ item }) => {
                                    const isSelected = selectedClient?.localId === item.localId;
                                    return (
                                        <TouchableOpacity
                                            onPress={() => selectClient(item)}
                                            activeOpacity={0.7}
                                            style={{
                                                flexDirection: 'row',
                                                alignItems: 'center',
                                                paddingHorizontal: 20,
                                                paddingVertical: 12,
                                                backgroundColor: isSelected ? theme.colors.primaryMuted : 'transparent',
                                                borderLeftWidth: isSelected ? 3 : 0,
                                                borderLeftColor: theme.colors.primary,
                                            }}
                                        >
                                            <View
                                                style={{
                                                    width: 40,
                                                    height: 40,
                                                    borderRadius: 20,
                                                    backgroundColor: isSelected ? 'rgba(212, 175, 55, 0.2)' : 'rgba(255,255,255,0.06)',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    marginRight: 12,
                                                    borderWidth: 1,
                                                    borderColor: isSelected ? 'rgba(212, 175, 55, 0.3)' : 'rgba(255,255,255,0.08)',
                                                }}
                                            >
                                                <Text style={{ color: isSelected ? theme.colors.primary : theme.colors.textSecondary, fontSize: 13, fontWeight: '800' }}>
                                                    {getClientInitials(item)}
                                                </Text>
                                            </View>
                                            <View style={{ flex: 1 }}>
                                                <Text style={{ color: isSelected ? theme.colors.primary : theme.colors.text, fontSize: 14, fontWeight: '700' }}>
                                                    {item.nomeFantasia || item.razaoSocial}
                                                </Text>
                                                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                                                    {item.contato && (
                                                        <Text style={{ color: theme.colors.textMuted, fontSize: 11 }}>{item.contato}</Text>
                                                    )}
                                                    {item.contato && (item.cpf || item.cnpj) && (
                                                        <Text style={{ color: theme.colors.textMuted, fontSize: 11 }}> • </Text>
                                                    )}
                                                    <Text style={{ color: theme.colors.textMuted, fontSize: 11 }}>{item.cpf || item.cnpj}</Text>
                                                </View>
                                            </View>
                                            {isSelected && <CheckCircle size={18} color={theme.colors.primary} />}
                                        </TouchableOpacity>
                                    );
                                }}
                                ItemSeparatorComponent={() => (
                                    <View style={{ height: 1, backgroundColor: theme.colors.border, marginHorizontal: 20 }} />
                                )}
                                ListEmptyComponent={
                                    <View style={{ alignItems: 'center', padding: 40 }}>
                                        <User size={40} color={theme.colors.textMuted} />
                                        <Text style={{ color: theme.colors.textMuted, marginTop: 12, fontSize: 14 }}>Nenhum cliente encontrado</Text>
                                        <Text style={{ color: theme.colors.textMuted, fontSize: 11, marginTop: 4 }}>
                                            {searchTerm ? 'Tente outro termo de busca' : 'Sincronize para carregar clientes'}
                                        </Text>
                                    </View>
                                }
                            />
                        )}
                    </View>
                </View>
            </Modal>

            {/* Responsible User Modal */}
            <Modal visible={showUserModal} animationType="slide" transparent>
                <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'flex-end' }}>
                    <View
                        style={{
                            backgroundColor: theme.colors.backgroundSecondary,
                            borderTopLeftRadius: 24,
                            borderTopRightRadius: 24,
                            padding: 24,
                            borderWidth: 1,
                            borderColor: theme.colors.border,
                            maxHeight: '60%',
                        }}
                    >
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                            <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: '900' }}>Responsável</Text>
                            <TouchableOpacity onPress={() => setShowUserModal(false)}>
                                <X size={24} color={theme.colors.textMuted} />
                            </TouchableOpacity>
                        </View>

                        <ScrollView style={{ marginBottom: 16 }}>
                            {/* None option */}
                            <TouchableOpacity
                                onPress={() => { setSelectedUserId(null); setShowUserModal(false); }}
                                style={{
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    padding: 14,
                                    borderRadius: 8,
                                    marginBottom: 6,
                                    backgroundColor: !selectedUserId ? theme.colors.primaryMuted : 'rgba(0,0,0,0.3)',
                                    borderWidth: 1,
                                    borderColor: !selectedUserId ? 'rgba(212, 175, 55, 0.5)' : theme.colors.border,
                                }}
                            >
                                <View
                                    style={{
                                        width: 22, height: 22, borderRadius: 11,
                                        borderWidth: 2,
                                        borderColor: !selectedUserId ? theme.colors.primary : theme.colors.textMuted,
                                        alignItems: 'center', justifyContent: 'center', marginRight: 12,
                                    }}
                                >
                                    {!selectedUserId && <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: theme.colors.primary }} />}
                                </View>
                                <Text style={{ color: !selectedUserId ? theme.colors.primary : theme.colors.textSecondary, fontSize: 15, fontWeight: '600' }}>
                                    Nenhum (definir depois)
                                </Text>
                            </TouchableOpacity>

                            {users.map(u => {
                                const isSelected = selectedUserId === u.id;
                                return (
                                    <TouchableOpacity
                                        key={u.id}
                                        onPress={() => { setSelectedUserId(u.id); setShowUserModal(false); }}
                                        style={{
                                            flexDirection: 'row',
                                            alignItems: 'center',
                                            padding: 14,
                                            borderRadius: 8,
                                            marginBottom: 6,
                                            backgroundColor: isSelected ? theme.colors.primaryMuted : 'rgba(0,0,0,0.3)',
                                            borderWidth: 1,
                                            borderColor: isSelected ? 'rgba(212, 175, 55, 0.5)' : theme.colors.border,
                                        }}
                                    >
                                        <View
                                            style={{
                                                width: 22, height: 22, borderRadius: 11,
                                                borderWidth: 2,
                                                borderColor: isSelected ? theme.colors.primary : theme.colors.textMuted,
                                                alignItems: 'center', justifyContent: 'center', marginRight: 12,
                                            }}
                                        >
                                            {isSelected && <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: theme.colors.primary }} />}
                                        </View>
                                        <View style={{ flex: 1 }}>
                                            <Text style={{ color: isSelected ? theme.colors.primary : theme.colors.text, fontSize: 15, fontWeight: '600' }}>
                                                {u.name || 'Sem nome'}
                                            </Text>
                                            {u.email && (
                                                <Text style={{ color: theme.colors.textMuted, fontSize: 11, marginTop: 2 }}>{u.email}</Text>
                                            )}
                                        </View>
                                        {isSelected && <CheckCircle size={18} color={theme.colors.primary} />}
                                    </TouchableOpacity>
                                );
                            })}
                        </ScrollView>
                    </View>
                </View>
            </Modal>
        </View >
    );
};

