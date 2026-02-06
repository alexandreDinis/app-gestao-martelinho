import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator, FlatList, Modal } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ChevronLeft, Search, User, Car, Calendar, CheckCircle, X } from 'lucide-react-native';
import { Picker } from '@react-native-picker/picker';
import { osService } from '../services/osService';
import { userService } from '../services/userService';
import { Cliente } from '../types';
import { theme } from '../theme';
import { Card, Button, Input } from '../components/ui';

import { OfflineDebug } from '../utils/OfflineDebug';

// ...

export const CreateOSScreen = () => {
    const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
    const [isForceOffline, setIsForceOffline] = useState(OfflineDebug.isForceOffline());

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

    // Loading States
    const [loadingClients, setLoadingClients] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const toggleOfflineMode = () => {
        const newMode = !OfflineDebug.isForceOffline();
        OfflineDebug.setForceOffline(newMode);
        setIsForceOffline(newMode);
    };

    useEffect(() => {
        if (showClientModal && clients.length === 0) {
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
                c.cnpj?.includes(term)
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
            Alert.alert('Erro', 'Falha ao carregar clientes');
        } finally {
            setLoadingClients(false);
        }
    };

    const [users, setUsers] = useState<any[]>([]);
    const [selectedUserId, setSelectedUserId] = useState<number | null>(null);

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

    const handleCreate = async () => {
        if (!selectedClient) {
            Alert.alert('Atenção', 'Selecione um cliente.');
            return;
        }
        if (!plate || !model) {
            Alert.alert('Atenção', 'Preencha os dados do veículo (Placa e Modelo).');
            return;
        }

        try {
            setSubmitting(true);

            // 1. Create OS Header
            const os = await osService.createOS({
                clienteId: selectedClient.id,
                data: new Date().toISOString().split('T')[0],
                usuarioId: selectedUserId || undefined
            });

            // 2. Add Vehicle
            await osService.addVeiculo({
                ordemServicoId: os.id,
                placa: plate.toUpperCase(),
                modelo: model,
                cor: color || 'Não informada'
            });

            Alert.alert('Sucesso', 'Ordem de serviço criada!');
            navigation.replace('OSDetails', { osId: os.id });

        } catch (error) {
            console.error(error);
            Alert.alert('Erro', 'Falha ao criar OS. Verifique os dados.');
        } finally {
            setSubmitting(false);
        }
    };

    const selectClient = (client: Cliente) => {
        setSelectedClient(client);
        setShowClientModal(false);
        setSearchTerm('');
    };

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
                        <Text style={{ color: theme.colors.primary, fontSize: 18, fontWeight: '900', letterSpacing: 1 }}>NOVA OS</Text>
                        <Text style={{ color: theme.colors.textMuted, fontSize: 10, letterSpacing: 1 }}>Preencha os dados iniciais</Text>
                    </View>
                </View>

                {/* Offline Toggle */}
                <TouchableOpacity
                    onPress={toggleOfflineMode}
                    style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        backgroundColor: isForceOffline ? 'rgba(239, 68, 68, 0.2)' : 'rgba(34, 197, 94, 0.2)',
                        paddingHorizontal: 8,
                        paddingVertical: 4,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: isForceOffline ? theme.colors.error : theme.colors.success
                    }}
                >
                    <Text style={{
                        color: isForceOffline ? theme.colors.error : theme.colors.success,
                        fontSize: 10,
                        fontWeight: '700',
                        marginRight: 4
                    }}>
                        {isForceOffline ? '✈️ OFF' : '🌐 ON'}
                    </Text>
                </TouchableOpacity>
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
                {/* Client Selection */}
                <Text style={{ color: theme.colors.primary, fontSize: 10, fontWeight: '700', letterSpacing: 2, marginBottom: 8 }}>
                    CLIENTE
                </Text>
                <TouchableOpacity onPress={() => setShowClientModal(true)}>
                    <Card style={{ marginBottom: 24 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <View
                                style={{
                                    width: 40,
                                    height: 40,
                                    backgroundColor: theme.colors.primaryMuted,
                                    borderRadius: 20,
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    marginRight: 12,
                                }}
                            >
                                <User size={20} color={theme.colors.primary} />
                            </View>
                            <View style={{ flex: 1 }}>
                                {selectedClient ? (
                                    <>
                                        <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '700' }}>
                                            {selectedClient.nomeFantasia || selectedClient.razaoSocial}
                                        </Text>
                                        <Text style={{ color: theme.colors.textMuted, fontSize: 11 }}>
                                            {selectedClient.cpf || selectedClient.cnpj}
                                        </Text>
                                    </>
                                ) : (
                                    <Text style={{ color: theme.colors.textMuted, fontSize: 14 }}>Toque para selecionar...</Text>
                                )}
                            </View>
                            <Search size={18} color={theme.colors.textMuted} />
                        </View>
                    </Card>
                </TouchableOpacity>



                {/* Responsible User Selection */}
                <Text style={{ color: theme.colors.primary, fontSize: 10, fontWeight: '700', letterSpacing: 2, marginBottom: 8 }}>
                    RESPONSÁVEL (VENDEDOR)
                </Text>
                <Card style={{ marginBottom: 24, padding: 0 }}>
                    <View style={{ borderRadius: 8, overflow: 'hidden' }}>
                        <Picker
                            selectedValue={selectedUserId}
                            onValueChange={(itemValue) => setSelectedUserId(itemValue)}
                            style={{ color: theme.colors.text, backgroundColor: 'transparent' }}
                            dropdownIconColor={theme.colors.primary}
                        >
                            <Picker.Item label="Selecione o responsável..." value={null} style={{ color: '#666' }} />
                            {users.map(user => (
                                <Picker.Item key={user.id} label={user.name || user.email} value={user.id} style={{ color: '#000' }} />
                            ))}
                        </Picker>
                    </View>
                </Card>

                {/* Vehicle Form */}
                <Text style={{ color: theme.colors.primary, fontSize: 10, fontWeight: '700', letterSpacing: 2, marginBottom: 8 }}>
                    VEÍCULO
                </Text>
                <Card style={{ marginBottom: 24 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
                        <Car size={18} color={theme.colors.primary} />
                        <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginLeft: 8 }}>Dados do veículo</Text>
                    </View>

                    <Input
                        label="PLACA"
                        placeholder="ABC-1234"
                        value={plate}
                        onChangeText={t => setPlate(t.toUpperCase())}
                        maxLength={8}
                        containerStyle={{ marginBottom: 16 }}
                    />
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

            {/* Client Selection Modal */}
            < Modal visible={showClientModal} animationType="slide" transparent >
                <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', paddingTop: 40 }}>
                    <View
                        style={{
                            flex: 1,
                            backgroundColor: theme.colors.backgroundSecondary,
                            borderTopLeftRadius: 24,
                            borderTopRightRadius: 24,
                            borderWidth: 1,
                            borderColor: theme.colors.border,
                            overflow: 'hidden',
                        }}
                    >
                        {/* Modal Header */}
                        <View
                            style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                padding: 16,
                                borderBottomWidth: 1,
                                borderBottomColor: theme.colors.border,
                                gap: 12,
                            }}
                        >
                            <Search size={18} color={theme.colors.textMuted} />
                            <TextInput
                                placeholder="Buscar cliente..."
                                placeholderTextColor={theme.colors.textMuted}
                                value={searchTerm}
                                onChangeText={setSearchTerm}
                                autoFocus
                                style={{
                                    flex: 1,
                                    backgroundColor: 'rgba(0,0,0,0.4)',
                                    color: theme.colors.text,
                                    paddingHorizontal: 12,
                                    paddingVertical: 10,
                                    borderRadius: 8,
                                    borderWidth: 1,
                                    borderColor: theme.colors.border,
                                }}
                            />
                            <TouchableOpacity onPress={() => setShowClientModal(false)}>
                                <Text style={{ color: theme.colors.primary, fontWeight: '700' }}>Fechar</Text>
                            </TouchableOpacity>
                        </View>

                        {/* Client List */}
                        {loadingClients ? (
                            <ActivityIndicator size="large" color={theme.colors.primary} style={{ marginTop: 40 }} />
                        ) : (
                            <FlatList
                                data={filteredClients}
                                keyExtractor={item => item.id.toString()}
                                renderItem={({ item }) => (
                                    <TouchableOpacity
                                        onPress={() => selectClient(item)}
                                        style={{
                                            padding: 16,
                                            borderBottomWidth: 1,
                                            borderBottomColor: theme.colors.border,
                                        }}
                                    >
                                        <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '700' }}>
                                            {item.nomeFantasia || item.razaoSocial}
                                        </Text>
                                        <Text style={{ color: theme.colors.textMuted, fontSize: 11 }}>
                                            {item.cpf || item.cnpj}
                                        </Text>
                                    </TouchableOpacity>
                                )}
                                ListEmptyComponent={
                                    <View style={{ alignItems: 'center', padding: 40 }}>
                                        <Text style={{ color: theme.colors.textMuted }}>Nenhum cliente encontrado</Text>
                                    </View>
                                }
                            />
                        )}
                    </View>
                </View>
            </Modal >
        </View >
    );
};
