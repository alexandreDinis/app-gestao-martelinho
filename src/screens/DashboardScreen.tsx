import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, RefreshControl, TextInput, Alert } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import { LogOut, Plus, Users, Search, Wrench, CheckCircle, Car, Package, Activity, DollarSign, FileText } from 'lucide-react-native';
import { osService } from '../services/osService';
import { OrdemServico } from '../types';
import { theme } from '../theme';
import { Card } from '../components/ui';
import { VehicleHistoryModal } from '../components/modals/VehicleHistoryModal';
import { CyberpunkAlert, CyberpunkAlertProps } from '../components/ui/CyberpunkAlert';
import { SimplePlateInput } from '../components/forms/SimplePlateInput';

// Limpar placa helper
const limparPlaca = (placa: string) => placa.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

export const DashboardScreen = () => {
    const navigation = useNavigation<any>();
    const { user, signOut } = useAuth();

    // Plate search state
    const [searchPlate, setSearchPlate] = useState('');
    const [isSearching, setIsSearching] = useState(false);

    // Stats state
    const [osList, setOsList] = useState<OrdemServico[]>([]);
    const [refreshing, setRefreshing] = useState(false);

    const fetchData = async () => {
        try {
            const data = await osService.listOS();
            setOsList(data);
        } catch (error) {
            console.error('Failed to load OS:', error);
        } finally {
            setRefreshing(false);
        }
    };

    useFocusEffect(
        useCallback(() => {
            fetchData();
        }, [])
    );

    const onRefresh = () => {
        setRefreshing(true);
        fetchData();
    };

    // Plate search handler
    const handlePlateSearch = async () => {
        const placaLimpa = limparPlaca(searchPlate);
        if (placaLimpa.length < 3) {
            Alert.alert('Atenção', 'Digite pelo menos 3 caracteres da placa.');
            return;
        }

        setIsSearching(true);
        try {
            const check = await osService.verificarPlaca(placaLimpa);
            if (check.existe && check.veiculoExistente) {
                setHistoryModal({
                    isOpen: true,
                    placa: placaLimpa,
                    modelo: check.veiculoExistente.modelo || 'Veículo',
                });
                setSearchPlate('');
            } else {
                setAlertConfig({
                    visible: true,
                    title: 'VEÍCULO NÃO ENCONTRADO',
                    message: `A placa ${placaLimpa} não consta em nossa base de dados.`,
                    type: 'warning',
                    actions: [
                        {
                            text: 'CANCELAR',
                            onPress: () => setAlertConfig({ visible: false }),
                            variant: 'secondary'
                        },
                        {
                            text: 'CADASTRAR',
                            onPress: () => {
                                setAlertConfig({ visible: false });
                                navigation.navigate('CreateOS', { prefillPlaca: placaLimpa });
                            }
                        }
                    ]
                });
            }
        } catch (error) {
            console.error(error);
            setAlertConfig({
                visible: true,
                title: 'ERRO DE SISTEMA',
                message: 'Não foi possível verificar a placa. Falha na conexão neural.',
                type: 'error',
                onClose: () => setAlertConfig({ visible: false })
            });
        } finally {
            setIsSearching(false);
        }
    };

    // Calculate stats
    const currentMonth = new Date().getMonth();
    const activeOSCount = osList.filter(os => os.status === 'ABERTA' || os.status === 'EM_EXECUCAO').length;
    const finalizedThisMonth = osList.filter(os => os.status === 'FINALIZADA' && new Date(os.data).getMonth() === currentMonth);
    const completedMonthCount = finalizedThisMonth.length;
    const vehiclesThisMonth = finalizedThisMonth.reduce((acc, os) => acc + (os.veiculos?.length || 0), 0);
    const partsThisMonth = finalizedThisMonth.reduce((acc, os) => {
        const partsInOS = os.veiculos?.reduce((vAcc, v) => vAcc + (v.pecas?.length || 0), 0) || 0;
        return acc + partsInOS;
    }, 0);

    // Totais Gerais para bater com Web
    const totalOSCount = osList.length;
    const totalVehiclesCount = osList.reduce((acc, os) => acc + (os.veiculos?.length || 0), 0);

    const monthName = new Date().toLocaleDateString('pt-BR', { month: 'short' }).toUpperCase();

    // Custom Alert State
    const [alertConfig, setAlertConfig] = useState<Partial<CyberpunkAlertProps>>({ visible: false });

    const [historyModal, setHistoryModal] = useState<{ isOpen: boolean; placa: string; modelo: string }>({
        isOpen: false,
        placa: '',
        modelo: '',
    });

    return (
        <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
            {/* Header */}
            <View
                style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingHorizontal: 16,
                    paddingTop: 50,
                    paddingBottom: 16,
                    backgroundColor: theme.colors.backgroundSecondary,
                    borderBottomWidth: 1,
                    borderBottomColor: theme.colors.border,
                }}
            >
                <View>
                    <Text style={{ color: theme.colors.textMuted, fontSize: 9, letterSpacing: 2, fontWeight: '700' }}>
                        SISTEMA_COMISSÃO_V2
                    </Text>
                    <Text style={{ color: theme.colors.primary, fontSize: 20, fontWeight: '900', letterSpacing: 2, fontStyle: 'italic' }}>
                        PAINEL OPERACIONAL
                    </Text>
                </View>
                <TouchableOpacity
                    onPress={signOut}
                    style={{
                        padding: 10,
                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                        borderWidth: 1,
                        borderColor: 'rgba(239, 68, 68, 0.3)',
                        borderRadius: 8,
                    }}
                >
                    <LogOut size={20} color={theme.colors.error} />
                </TouchableOpacity>
            </View>

            <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ padding: 16 }}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />
                }
            >
                {/* Quick Actions Card */}
                <Card style={{ marginBottom: 16, position: 'relative' }}>
                    <View style={{ position: 'absolute', top: 8, right: 8 }}>
                        <Activity size={16} color={theme.colors.textMuted} />
                    </View>
                    <Text style={{ color: theme.colors.primary, fontSize: 14, fontWeight: '900', fontStyle: 'italic', marginBottom: 4 }}>
                        AÇÕES RÁPIDAS
                    </Text>
                    <Text style={{ color: theme.colors.textMuted, fontSize: 9, letterSpacing: 1, marginBottom: 16 }}>
                        INICIAR FLUXO OPERACIONAL
                    </Text>

                    {/* Plate Search */}
                    <View style={{ marginBottom: 16 }}>
                        <SimplePlateInput
                            value={searchPlate}
                            onChange={setSearchPlate}
                            onSearch={handlePlateSearch}
                            isSearching={isSearching}
                            buttonLabel="VERIFICAR"
                        />
                    </View>

                    {/* Quick Action Buttons */}
                    <TouchableOpacity
                        onPress={() => navigation.navigate('CreateOS')}
                        style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            backgroundColor: theme.colors.primary,
                            padding: 14,
                            borderRadius: 4,
                            marginBottom: 8,
                        }}
                    >
                        <Plus size={14} color="#000" />
                        <Text style={{ color: '#000', fontWeight: '700', marginLeft: 8, fontSize: 12 }}>
                            NOVA ORDEM DE SERVIÇO
                        </Text>
                    </TouchableOpacity>


                    <TouchableOpacity
                        onPress={() => navigation.navigate('Clientes')}
                        style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            backgroundColor: 'transparent',
                            borderWidth: 1,
                            borderColor: 'rgba(212, 175, 55, 0.3)',
                            padding: 14,
                            borderRadius: 4,
                        }}
                    >
                        <Users size={14} color={theme.colors.textSecondary} />
                        <Text style={{ color: theme.colors.textSecondary, fontWeight: '700', marginLeft: 8, fontSize: 12 }}>
                            CADASTRAR CLIENTE
                        </Text>
                    </TouchableOpacity>
                </Card>

                {/* Elegant Overview Header */}
                <View style={{ marginBottom: 24, padding: 16, backgroundColor: 'rgba(212, 175, 55, 0.05)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(212, 175, 55, 0.1)' }}>
                    <Text style={{ color: theme.colors.primary, fontSize: 10, fontWeight: '700', letterSpacing: 2, marginBottom: 12, textAlign: 'center' }}>
                        PANORAMA GERAL
                    </Text>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
                        <View style={{ alignItems: 'center' }}>
                            <Text style={{ color: theme.colors.textMuted, fontSize: 9, letterSpacing: 1, marginBottom: 4 }}>TOTAL VEÍCULOS</Text>
                            <Text style={{ color: theme.colors.textWhite, fontSize: 24, fontWeight: '900' }}>{totalVehiclesCount}</Text>
                        </View>
                        <View style={{ width: 1, height: '100%', backgroundColor: theme.colors.border }} />
                        <View style={{ alignItems: 'center' }}>
                            <Text style={{ color: theme.colors.textMuted, fontSize: 9, letterSpacing: 1, marginBottom: 4 }}>TOTAL DE O.S.</Text>
                            <Text style={{ color: theme.colors.textWhite, fontSize: 24, fontWeight: '900' }}>{totalOSCount}</Text>
                        </View>
                    </View>
                </View>

                {/* Subtitle for Monthly stats */}
                <Text style={{ color: theme.colors.primary, fontSize: 11, fontWeight: '700', letterSpacing: 2, marginBottom: 16 }}>
                    METAS E VOLUME MENSAL
                </Text>

                {/* Monthly Stats Clean Grid */}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                    {/* Em Execução */}
                    <Card style={{ width: '48%', marginBottom: 4 }} padding="md">
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <Text style={{ color: theme.colors.primary, fontSize: 9, fontWeight: '900' }}>EM EXECUÇÃO</Text>
                            <Wrench size={16} color={theme.colors.primary} />
                        </View>
                        <Text style={{ color: theme.colors.textWhite, fontSize: 28, fontWeight: '900' }}>{activeOSCount}</Text>
                        <Text style={{ color: theme.colors.textMuted, fontSize: 8, marginTop: 4 }}>OS Ativas</Text>
                    </Card>

                    {/* Finalizadas Mês */}
                    <Card style={{ width: '48%', marginBottom: 4 }} padding="md">
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <Text style={{ color: theme.colors.primary, fontSize: 9, fontWeight: '900' }}>FINALIZADAS</Text>
                            <CheckCircle size={16} color={theme.colors.primary} />
                        </View>
                        <Text style={{ color: theme.colors.textWhite, fontSize: 28, fontWeight: '900' }}>{completedMonthCount}</Text>
                        <Text style={{ color: theme.colors.textMuted, fontSize: 8, marginTop: 4 }}>{monthName}</Text>
                    </Card>

                    {/* Veículos Mês */}
                    <Card style={{ width: '48%' }} padding="md">
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <Text style={{ color: theme.colors.primary, fontSize: 9, fontWeight: '900' }}>VEÍCULOS</Text>
                            <Car size={16} color={theme.colors.primary} />
                        </View>
                        <Text style={{ color: theme.colors.textWhite, fontSize: 28, fontWeight: '900' }}>{vehiclesThisMonth}</Text>
                        <Text style={{ color: theme.colors.textMuted, fontSize: 8, marginTop: 4 }}>Mês atual</Text>
                    </Card>

                    {/* Volume de Serviços */}
                    <Card style={{ width: '48%' }} padding="md">
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <Text style={{ color: theme.colors.primary, fontSize: 9, fontWeight: '900' }}>SERVIÇOS</Text>
                            <Package size={16} color={theme.colors.primary} />
                        </View>
                        <Text style={{ color: theme.colors.textWhite, fontSize: 28, fontWeight: '900' }}>{partsThisMonth}</Text>
                        <Text style={{ color: theme.colors.textMuted, fontSize: 8, marginTop: 4 }}>Concluídos</Text>
                    </Card>
                </View>
            </ScrollView>

            {/* Vehicle History Modal */}
            <VehicleHistoryModal
                isOpen={historyModal.isOpen}
                onClose={() => setHistoryModal({ ...historyModal, isOpen: false })}
                placa={historyModal.placa}
                modelo={historyModal.modelo}
            />

            {/* Custom Cyberpunk Alert */}
            <CyberpunkAlert
                visible={!!alertConfig.visible}
                title={alertConfig.title || ''}
                message={alertConfig.message || ''}
                type={alertConfig.type}
                onClose={() => setAlertConfig({ visible: false })}
                actions={alertConfig.actions}
            />
        </View>
    );
};
