import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, FlatList, TouchableOpacity, RefreshControl, TextInput, Modal, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { FileText, Calendar, DollarSign, Search, Clock, CheckCircle, Ban, Plus, User, ChevronRight } from 'lucide-react-native';
import { theme } from '../theme';
import { Card, OSStatusBadge } from '../components/ui';
import { osService } from '../services/osService';
import { OrdemServico, OSStatus, Cliente } from '../types';

type TabType = 'iniciadas' | 'finalizadas' | 'canceladas' | 'atrasadas';

const TABS: { key: TabType; label: string; icon: any }[] = [
    { key: 'iniciadas', label: 'INICIADAS', icon: Clock },
    { key: 'finalizadas', label: 'FINALIZADAS', icon: CheckCircle },
    { key: 'canceladas', label: 'CANCELADAS', icon: Ban },
    { key: 'atrasadas', label: 'ATRASADAS', icon: Clock },
];

export const OSListScreen = () => {
    const navigation = useNavigation<any>();
    const [ordens, setOrdens] = useState<OrdemServico[]>([]);
    const [loading, setLoading] = useState(false);
    const [activeTab, setActiveTab] = useState<TabType>('iniciadas');
    const [searchTerm, setSearchTerm] = useState('');
    const [dateFilter, setDateFilter] = useState('');

    // Create Modal State
    const [createModalOpen, setCreateModalOpen] = useState(false);
    const [clientes, setClientes] = useState<Cliente[]>([]);
    const [selectedClientId, setSelectedClientId] = useState<number>(0);
    const [osDate, setOsDate] = useState(new Date().toISOString().split('T')[0]);
    const [osVencimento, setOsVencimento] = useState(new Date().toISOString().split('T')[0]);
    const [isCreating, setIsCreating] = useState(false);

    const fetchOrdens = async () => {
        try {
            setLoading(true);
            const data = await osService.listOS();
            setOrdens(data);
        } catch (error) {
            console.error('Failed to load OS:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchClientes = async () => {
        try {
            const data = await osService.listClientes();
            setClientes(data);
        } catch (error) {
            console.error('Failed to load clients:', error);
        }
    };

    useFocusEffect(
        useCallback(() => {
            fetchOrdens();
        }, [])
    );

    const filteredOrdens = useMemo(() => {
        return ordens.filter(os => {
            // Status filter (tab)
            let statusMatch = false;
            if (activeTab === 'iniciadas') statusMatch = (os.status === 'ABERTA' || os.status === 'EM_EXECUCAO');
            else if (activeTab === 'finalizadas') statusMatch = (os.status === 'FINALIZADA');
            else if (activeTab === 'canceladas') statusMatch = (os.status === 'CANCELADA');
            else if (activeTab === 'atrasadas') statusMatch = os.atrasado === true;

            // Client search
            const clientMatch = searchTerm === '' ||
                os.cliente?.nomeFantasia?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                os.cliente?.razaoSocial?.toLowerCase().includes(searchTerm.toLowerCase());

            // Date filter
            const dateMatch = dateFilter === '' || os.data === dateFilter;

            return statusMatch && clientMatch && dateMatch;
        });
    }, [ordens, activeTab, searchTerm, dateFilter]);

    const handleOpenCreateModal = () => {
        if (clientes.length === 0) {
            fetchClientes();
        }
        setCreateModalOpen(true);
    };

    const handleCreateOS = async () => {
        if (selectedClientId === 0) {
            Alert.alert('Atenção', 'Selecione um cliente.');
            return;
        }

        try {
            setIsCreating(true);
            const os = await osService.createOS({
                clienteId: selectedClientId,
                data: osDate,
                dataVencimento: osVencimento,
            });
            setCreateModalOpen(false);
            navigation.navigate('OSDetails', { osId: os.id });
        } catch (error) {
            console.error(error);
            Alert.alert('Erro', 'Falha ao criar OS.');
        } finally {
            setIsCreating(false);
        }
    };

    const formatCurrency = (val?: number) => {
        return (val || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    };

    const formatDate = (dateStr?: string) => {
        if (!dateStr) return '-';
        return new Date(dateStr).toLocaleDateString('pt-BR');
    };

    const renderOS = ({ item }: { item: OrdemServico }) => (
        <TouchableOpacity onPress={() => navigation.navigate('OSDetails', { osId: item.id })}>
            <Card style={{ marginBottom: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', minHeight: 90 }}>
                    {/* ID Box */}
                    <View
                        style={{
                            backgroundColor: 'rgba(255,255,255,0.05)',
                            padding: 12,
                            borderRadius: 4,
                            alignItems: 'center',
                            marginRight: 12,
                            height: 60,
                            justifyContent: 'center',
                        }}
                    >
                        <Text style={{ color: theme.colors.textMuted, fontSize: 9 }}>ID</Text>
                        <Text style={{ color: theme.colors.textWhite, fontSize: 20, fontWeight: '900' }}>#{item.id}</Text>
                    </View>

                    {/* Info */}
                    <View style={{ flex: 1, paddingRight: 8, justifyContent: 'center' }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                            <User size={12} color={theme.colors.primary} />
                            <Text style={{ color: theme.colors.textWhite, fontSize: 15, fontWeight: '700', marginLeft: 6 }} numberOfLines={1}>
                                {item.cliente?.nomeFantasia}
                            </Text>
                        </View>
                        <Text style={{ color: theme.colors.textMuted, fontSize: 11, marginBottom: 8 }} numberOfLines={1}>
                            {item.cliente?.razaoSocial}
                        </Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                            <OSStatusBadge status={item.status} />
                            {item.atrasado && (
                                <View style={{ backgroundColor: 'rgba(239, 68, 68, 0.2)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                                    <Text style={{ color: theme.colors.error, fontSize: 8, fontWeight: '700' }}>ATRASADO</Text>
                                </View>
                            )}
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <Calendar size={12} color={theme.colors.textMuted} />
                                <Text style={{ color: theme.colors.textSecondary, fontSize: 11, marginLeft: 4 }}>{formatDate(item.data)}</Text>
                            </View>
                            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                                <Text style={{ color: theme.colors.textWhite, fontSize: 10 }}>
                                    {item.veiculos?.length || 0} Veículo(s)
                                </Text>
                            </View>
                        </View>
                    </View>

                    {/* Right side */}
                    <View style={{ alignItems: 'flex-end', justifyContent: 'center', minHeight: 60 }}>
                        <Text style={{ color: theme.colors.textMuted, fontSize: 9, letterSpacing: 1, marginBottom: 2 }}>VALOR TOTAL</Text>
                        {item.valorDesconto && item.valorDesconto > 0 ? (
                            <>
                                <Text style={{ color: theme.colors.textMuted, fontSize: 10, textDecorationLine: 'line-through' }}>
                                    {formatCurrency(item.valorTotalSemDesconto || item.valorTotal)}
                                </Text>
                                <Text style={{ color: theme.colors.primary, fontSize: 16, fontWeight: '900' }}>
                                    {formatCurrency(item.valorTotalComDesconto || item.valorTotal)}
                                </Text>
                            </>
                        ) : (
                            <Text style={{ color: theme.colors.primary, fontSize: 16, fontWeight: '900' }}>
                                {formatCurrency(item.valorTotal)}
                            </Text>
                        )}
                    </View>

                    <ChevronRight size={20} color={theme.colors.textMuted} style={{ marginLeft: 8 }} />
                </View>
            </Card>
        </TouchableOpacity>
    );

    return (
        <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
            {/* Header */}
            <View
                style={{
                    paddingTop: 50,
                    paddingHorizontal: 16,
                    paddingBottom: 12,
                    backgroundColor: theme.colors.backgroundSecondary,
                    borderBottomWidth: 1,
                    borderBottomColor: theme.colors.border,
                }}
            >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <FileText size={24} color={theme.colors.primary} />
                        <Text style={{ color: theme.colors.primary, fontSize: 20, fontWeight: '900', marginLeft: 8, letterSpacing: 2 }}>
                            ORDENS DE SERVIÇO
                        </Text>
                    </View>
                    {/* Button removed, now using FAB */}<View />
                </View>

                {/* Tabs */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                    {TABS.map(tab => {
                        const isActive = activeTab === tab.key;
                        const IconComponent = tab.icon;
                        const isAtrasadas = tab.key === 'atrasadas';
                        return (
                            <TouchableOpacity
                                key={tab.key}
                                onPress={() => setActiveTab(tab.key)}
                                style={{
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    paddingHorizontal: 12,
                                    paddingVertical: 8,
                                    marginRight: 8,
                                    borderBottomWidth: isActive ? 2 : 0,
                                    borderBottomColor: isAtrasadas && isActive ? theme.colors.error : theme.colors.primary,
                                }}
                            >
                                <IconComponent size={14} color={isActive ? (isAtrasadas ? theme.colors.error : theme.colors.primary) : theme.colors.textMuted} />
                                <Text
                                    style={{
                                        marginLeft: 6,
                                        fontSize: 11,
                                        fontWeight: '600',
                                        color: isActive ? (isAtrasadas ? theme.colors.error : theme.colors.primary) : theme.colors.textMuted,
                                    }}
                                >
                                    {tab.label}
                                </Text>
                            </TouchableOpacity>
                        );
                    })}
                </ScrollView>

                {/* Filters */}
                <View style={{ flexDirection: 'row', gap: 8 }}>
                    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.4)', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 4, paddingHorizontal: 8 }}>
                        <Search size={14} color={theme.colors.textMuted} />
                        <TextInput
                            placeholder="Buscar por cliente..."
                            placeholderTextColor={theme.colors.textMuted}
                            value={searchTerm}
                            onChangeText={setSearchTerm}
                            style={{ flex: 1, color: theme.colors.text, paddingVertical: 10, paddingHorizontal: 8, fontSize: 12 }}
                        />
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.4)', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 4, paddingHorizontal: 8, width: 130 }}>
                        <Calendar size={14} color={theme.colors.textMuted} />
                        <TextInput
                            placeholder="YYYY-MM-DD"
                            placeholderTextColor={theme.colors.textMuted}
                            value={dateFilter}
                            onChangeText={setDateFilter}
                            style={{ flex: 1, color: theme.colors.text, paddingVertical: 10, paddingHorizontal: 8, fontSize: 11 }}
                        />
                    </View>
                </View>
            </View>

            {/* List */}
            <FlatList
                data={filteredOrdens}
                renderItem={renderOS}
                keyExtractor={(item) => item.id.toString()}
                contentContainerStyle={{ padding: 16 }}
                refreshControl={
                    <RefreshControl refreshing={loading} onRefresh={fetchOrdens} tintColor={theme.colors.primary} />
                }
                ListEmptyComponent={
                    <View style={{ alignItems: 'center', padding: 40 }}>
                        <FileText size={48} color={theme.colors.textMuted} />
                        <Text style={{ color: theme.colors.textMuted, marginTop: 16, fontSize: 14 }}>
                            Nenhuma OS encontrada para este filtro
                        </Text>
                    </View>
                }
            />

            {/* Floating Action Button */}
            <TouchableOpacity
                onPress={handleOpenCreateModal}
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

            {/* Create OS Modal */}
            <Modal visible={createModalOpen} animationType="slide" transparent>
                <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', padding: 24 }}>
                    <View
                        style={{
                            backgroundColor: theme.colors.backgroundSecondary,
                            borderWidth: 1,
                            borderColor: theme.colors.border,
                            borderRadius: 12,
                            padding: 24,
                        }}
                    >
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 24, borderLeftWidth: 4, borderLeftColor: theme.colors.primary, paddingLeft: 12 }}>
                            <Text style={{ color: theme.colors.textWhite, fontSize: 18, fontWeight: '900' }}>INICIAR NOVA OS</Text>
                        </View>

                        {/* Client Selector */}
                        <Text style={{ color: theme.colors.primary, fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 8 }}>CLIENTE</Text>
                        <View style={{ backgroundColor: 'rgba(0,0,0,0.4)', borderWidth: 1, borderColor: theme.colors.border, marginBottom: 16 }}>
                            <ScrollView style={{ maxHeight: 150 }}>
                                {clientes.map(c => (
                                    <TouchableOpacity
                                        key={c.id}
                                        onPress={() => setSelectedClientId(c.id)}
                                        style={{
                                            padding: 12,
                                            borderBottomWidth: 1,
                                            borderBottomColor: theme.colors.border,
                                            backgroundColor: selectedClientId === c.id ? theme.colors.primaryMuted : 'transparent',
                                        }}
                                    >
                                        <Text style={{ color: theme.colors.text, fontWeight: '600' }}>{c.nomeFantasia}</Text>
                                        <Text style={{ color: theme.colors.textMuted, fontSize: 11 }}>{c.razaoSocial}</Text>
                                    </TouchableOpacity>
                                ))}
                            </ScrollView>
                        </View>

                        {/* Date */}
                        <Text style={{ color: theme.colors.primary, fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 8 }}>DATA</Text>
                        <TextInput
                            value={osDate}
                            onChangeText={setOsDate}
                            placeholder="YYYY-MM-DD"
                            placeholderTextColor={theme.colors.textMuted}
                            style={{
                                backgroundColor: 'rgba(0,0,0,0.4)',
                                borderWidth: 1,
                                borderColor: theme.colors.border,
                                color: theme.colors.text,
                                padding: 12,
                                marginBottom: 16,
                            }}
                        />

                        {/* Vencimento */}
                        <Text style={{ color: theme.colors.primary, fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 8 }}>PRAZO DE PAGAMENTO</Text>
                        <TextInput
                            value={osVencimento}
                            onChangeText={setOsVencimento}
                            placeholder="YYYY-MM-DD"
                            placeholderTextColor={theme.colors.textMuted}
                            style={{
                                backgroundColor: 'rgba(0,0,0,0.4)',
                                borderWidth: 1,
                                borderColor: theme.colors.border,
                                color: theme.colors.text,
                                padding: 12,
                                marginBottom: 24,
                            }}
                        />

                        {/* Buttons */}
                        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12 }}>
                            <TouchableOpacity onPress={() => setCreateModalOpen(false)} style={{ padding: 12 }}>
                                <Text style={{ color: theme.colors.textMuted, fontWeight: '600' }}>CANCELAR</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                onPress={handleCreateOS}
                                disabled={isCreating}
                                style={{
                                    backgroundColor: theme.colors.primary,
                                    paddingHorizontal: 20,
                                    paddingVertical: 12,
                                    borderRadius: 4,
                                }}
                            >
                                {isCreating ? (
                                    <ActivityIndicator size="small" color="#000" />
                                ) : (
                                    <Text style={{ color: '#000', fontWeight: '700' }}>CRIAR OS</Text>
                                )}
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        </View>
    );
};
