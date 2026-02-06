import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, RefreshControl, TextInput } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { Search, Phone, Mail, MapPin, User, Plus, Wifi, WifiOff } from 'lucide-react-native';
import { theme } from '../theme';
import { Card, Badge } from '../components/ui';
import { clienteService } from '../services/clienteService';
import { ClienteModel } from '../services/database/models/ClienteModel';
import { SyncService } from '../services/SyncService';
import { Cliente } from '../types';
import { OfflineDebug } from '../utils/OfflineDebug';

export const ClientesScreen = () => {
    const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
    const [clientes, setClientes] = useState<Cliente[]>([]);
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [isOffline, setIsOffline] = useState(OfflineDebug.isForceOffline());

    const fetchClientes = async () => {
        try {
            // Offline First: Ler do banco local
            const localData = await ClienteModel.getAll();
            const formattedData = localData.map(c => ClienteModel.toApiFormat(c));
            setClientes(formattedData);
        } catch (error) {
            console.error('Failed to load clients from DB:', error);
        }
    };

    const handleRefresh = async () => {
        setLoading(true);
        try {
            // Sync Completo: PUSH (envia locais) depois PULL (baixa do servidor)
            // Isso garante que edições locais não sejam sobrescritas se a queue não tiver sido processada
            await SyncService.processQueue();
            await SyncService.syncClientes();

            // Recarregar do banco
            await fetchClientes();
        } catch (error) {
            console.error('Sync failed:', error);
        } finally {
            setLoading(false);
        }
    };

    useFocusEffect(
        useCallback(() => {
            fetchClientes();
        }, [])
    );

    const filteredClientes = clientes.filter(cliente => {
        const term = searchTerm.toLowerCase();
        return (
            cliente.razaoSocial?.toLowerCase().includes(term) ||
            cliente.nomeFantasia?.toLowerCase().includes(term) ||
            cliente.email?.toLowerCase().includes(term) ||
            cliente.contato?.includes(term)
        );
    });

    const getStatusColors = (status: string) => {
        switch (status) {
            case 'ATIVO':
                return { bg: 'rgba(34, 197, 94, 0.15)', text: theme.colors.success };
            case 'INATIVO':
                return { bg: 'rgba(239, 68, 68, 0.15)', text: theme.colors.error };
            case 'EM_PROSPECCAO':
                return { bg: 'rgba(245, 158, 11, 0.15)', text: theme.colors.warning };
            default:
                return { bg: theme.colors.primaryMuted, text: theme.colors.text };
        }
    };

    const renderCliente = ({ item }: { item: Cliente }) => {
        const statusColors = getStatusColors(item.status);

        return (
            <TouchableOpacity onPress={() => navigation.navigate('ClientForm', { clienteId: item.id })}>
                <Card style={{ marginBottom: 12 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                        <View style={{ flex: 1 }}>
                            <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '700', marginBottom: 4 }}>
                                {item.nomeFantasia || item.razaoSocial}
                            </Text>
                            {item.nomeFantasia && (
                                <Text style={{ color: theme.colors.textMuted, fontSize: 11 }}>
                                    {item.razaoSocial}
                                </Text>
                            )}
                        </View>
                        <View
                            style={{
                                backgroundColor: statusColors.bg,
                                paddingHorizontal: 8,
                                paddingVertical: 3,
                                borderRadius: 4,
                            }}
                        >
                            <Text style={{ color: statusColors.text, fontSize: 9, fontWeight: '700', letterSpacing: 0.5 }}>
                                {item.status === 'EM_PROSPECCAO' ? 'PROSPECÇÃO' : item.status}
                            </Text>
                        </View>
                    </View>

                    <View style={{ gap: 8 }}>
                        {item.contato && (
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <Phone size={14} color={theme.colors.textSecondary} />
                                <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginLeft: 8 }}>
                                    {item.contato}
                                </Text>
                            </View>
                        )}
                        {item.email && (
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <Mail size={14} color={theme.colors.textSecondary} />
                                <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginLeft: 8 }}>
                                    {item.email}
                                </Text>
                            </View>
                        )}
                        {item.cidade && (
                            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                                <MapPin size={14} color={theme.colors.textSecondary} />
                                <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginLeft: 8 }}>
                                    {item.cidade}{item.estado ? ` - ${item.estado}` : ''}
                                </Text>
                            </View>
                        )}
                    </View>
                </Card>
            </TouchableOpacity>
        );
    };

    return (
        <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
            {/* Header */}
            <View
                style={{
                    paddingTop: 50,
                    paddingHorizontal: 16,
                    paddingBottom: 16,
                    backgroundColor: theme.colors.backgroundSecondary,
                    borderBottomWidth: 1,
                    borderBottomColor: theme.colors.border,
                }}
            >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <Text style={{ color: theme.colors.primary, fontSize: 20, fontWeight: '900', letterSpacing: 2 }}>
                        CLIENTES
                    </Text>
                    <TouchableOpacity
                        onPress={() => {
                            const newState = !isOffline;
                            OfflineDebug.setForceOffline(newState);
                            setIsOffline(newState);
                        }}
                        style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            backgroundColor: isOffline ? '#dc2626' : '#16a34a',
                            paddingHorizontal: 12,
                            paddingVertical: 6,
                            borderRadius: 6,
                        }}
                    >
                        {isOffline ? (
                            <WifiOff size={16} color="#fff" />
                        ) : (
                            <Wifi size={16} color="#fff" />
                        )}
                        <Text style={{ color: '#fff', marginLeft: 6, fontSize: 12, fontWeight: '700' }}>
                            {isOffline ? '✈️ OFF' : '🌐 ON'}
                        </Text>
                    </TouchableOpacity>
                </View>

                {/* Search */}
                <View
                    style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        backgroundColor: 'rgba(0,0,0,0.4)',
                        borderWidth: 1,
                        borderColor: theme.colors.border,
                        borderRadius: 8,
                        paddingHorizontal: 12,
                    }}
                >
                    <Search size={18} color={theme.colors.textMuted} />
                    <TextInput
                        placeholder="Buscar cliente..."
                        placeholderTextColor={theme.colors.textMuted}
                        value={searchTerm}
                        onChangeText={setSearchTerm}
                        style={{
                            flex: 1,
                            color: theme.colors.text,
                            paddingVertical: 12,
                            paddingHorizontal: 12,
                            fontSize: 14,
                        }}
                    />
                </View>
            </View>

            {/* List */}
            <FlatList
                data={filteredClientes}
                renderItem={renderCliente}
                keyExtractor={(item) => item.id.toString()}
                contentContainerStyle={{ padding: 16 }}
                refreshControl={
                    <RefreshControl
                        refreshing={loading}
                        onRefresh={handleRefresh}
                        tintColor={theme.colors.primary}
                    />
                }
                ListEmptyComponent={
                    <View style={{ alignItems: 'center', padding: 40 }}>
                        <User size={48} color={theme.colors.textMuted} />
                        <Text style={{ color: theme.colors.textMuted, marginTop: 16, fontSize: 14 }}>
                            {searchTerm ? 'Nenhum cliente encontrado' : 'Nenhum cliente cadastrado'}
                        </Text>
                    </View>
                }
            />

            {/* Floating Action Button */}
            <TouchableOpacity
                onPress={() => navigation.navigate('ClientForm')}
                style={{
                    position: 'absolute',
                    bottom: 24,
                    right: 24,
                    width: 56,
                    height: 56,
                    borderRadius: 28,
                    backgroundColor: theme.colors.primary,
                    alignItems: 'center',
                    justifyContent: 'center',
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.3,
                    shadowRadius: 4,
                    elevation: 8,
                    zIndex: 100,
                    borderWidth: 2,
                    borderColor: '#000',
                }}
            >
                <Plus size={24} color="#000" strokeWidth={3} />
            </TouchableOpacity>
        </View>
    );
};
