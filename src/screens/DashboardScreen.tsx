import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, RefreshControl, TextInput, Alert } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import { LogOut, Plus, Users, Search, Wrench, CheckCircle, Car, Package, Activity, DollarSign } from 'lucide-react-native';
import { osService } from '../services/osService';
import { OrdemServico } from '../types';
import { theme } from '../theme';
import { Card } from '../components/ui';
import { VehicleHistoryModal } from '../components/modals/VehicleHistoryModal';
import { CyberpunkAlert, CyberpunkAlertProps } from '../components/ui/CyberpunkAlert';

// Limpar placa helper
const limparPlaca = (placa: string) => placa.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

export const DashboardScreen = () => {
    const navigation = useNavigation<any>();
    const { user, signOut } = useAuth();

    // Plate search state
    type PlateFormat = 'MERC' | 'ANTIGA';
    const [plateFormat, setPlateFormat] = useState<PlateFormat>('MERC');
    const [searchPlate, setSearchPlate] = useState('');
    const [isSearching, setIsSearching] = useState(false);

    // Custom Alert State
    const [alertConfig, setAlertConfig] = useState<Partial<CyberpunkAlertProps>>({ visible: false });

    const [historyModal, setHistoryModal] = useState<{ isOpen: boolean; placa: string; modelo: string }>({
        isOpen: false,
        placa: '',
        modelo: '',
    });

    // Plate validation helper
    const handlePlateChange = (text: string) => {
        // Remove non-alphanumeric chars
        const cleaned = text.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

        let formatted = '';
        const limit = 7;

        for (let i = 0; i < cleaned.length && i < limit; i++) {
            const char = cleaned[i];

            if (plateFormat === 'ANTIGA') {
                // ABC-1234 format: 3 letters, 4 numbers
                if (i < 3) {
                    // Expect Letters
                    if (/[A-Z]/.test(char)) formatted += char;
                } else {
                    // Expect Numbers
                    if (/[0-9]/.test(char)) formatted += char;
                }
            } else {
                // Mercosul (ABC1D23): LLLNLNN
                if (i < 3) { // Letters (ABC)
                    if (/[A-Z]/.test(char)) formatted += char;
                } else if (i === 3) { // Number (1)
                    if (/[0-9]/.test(char)) formatted += char;
                } else if (i === 4) { // Letter (D)
                    if (/[A-Z]/.test(char)) formatted += char;
                } else { // Numbers (23)
                    if (/[0-9]/.test(char)) formatted += char;
                }
            }
        }

        // Add hyphen for presentation if Antiga
        if (plateFormat === 'ANTIGA' && formatted.length > 3) {
            setSearchPlate(formatted.slice(0, 3) + '-' + formatted.slice(3));
        } else {
            setSearchPlate(formatted);
        }
    };

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

    const monthName = new Date().toLocaleDateString('pt-BR', { month: 'short' }).toUpperCase();

    // Determine valid keyboard type based on cursor position/content
    const getKeyboardType = () => {
        const cleanLength = searchPlate.replace(/[^a-zA-Z0-9]/g, '').length;

        if (plateFormat === 'ANTIGA') {
            // ABC-1234: First 3 are letters, rest are numbers
            return cleanLength >= 3 ? 'numeric' : 'default';
        } else {
            // Mercosul (ABC1D23)
            // 0-2 (ABC): Default
            if (cleanLength < 3) return 'default';
            // 3 (1): Numeric
            if (cleanLength === 3) return 'numeric';
            // 4 (D): Default
            if (cleanLength === 4) return 'default';
            // 5-6 (23): Numeric
            return 'numeric';
        }
    };

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
                        {/* Format Toggle */}
                        <View style={{ flexDirection: 'row', marginBottom: 12, backgroundColor: 'rgba(0,0,0,0.2)', padding: 2, borderRadius: 6 }}>
                            <TouchableOpacity
                                onPress={() => { setPlateFormat('MERC'); setSearchPlate(''); }}
                                style={{ flex: 1, paddingVertical: 6, alignItems: 'center', backgroundColor: plateFormat === 'MERC' ? theme.colors.primary : 'transparent', borderRadius: 4 }}
                            >
                                <Text style={{ fontSize: 10, fontWeight: '700', color: plateFormat === 'MERC' ? '#000' : theme.colors.textMuted }}>MERCOSUL</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                onPress={() => { setPlateFormat('ANTIGA'); setSearchPlate(''); }}
                                style={{ flex: 1, paddingVertical: 6, alignItems: 'center', backgroundColor: plateFormat === 'ANTIGA' ? theme.colors.primary : 'transparent', borderRadius: 4 }}
                            >
                                <Text style={{ fontSize: 10, fontWeight: '700', color: plateFormat === 'ANTIGA' ? '#000' : theme.colors.textMuted }}>ANTIGA</Text>
                            </TouchableOpacity>
                        </View>

                        <TextInput
                            placeholder={plateFormat === 'MERC' ? "ABC1D23" : "ABC-1234"}
                            placeholderTextColor={theme.colors.textMuted}
                            value={searchPlate}
                            onChangeText={handlePlateChange}
                            keyboardType={getKeyboardType()}
                            autoCapitalize="characters"
                            style={{
                                backgroundColor: 'rgba(0,0,0,0.4)',
                                borderWidth: 1,
                                borderColor: theme.colors.border,
                                color: theme.colors.text,
                                paddingHorizontal: 12,
                                paddingVertical: 12,
                                fontSize: 14,
                                fontWeight: '700',
                                letterSpacing: 2,
                                marginBottom: 8,
                            }}
                        />
                        <TouchableOpacity
                            onPress={handlePlateSearch}
                            disabled={isSearching}
                            style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                justifyContent: 'center',
                                backgroundColor: theme.colors.primaryMuted,
                                borderWidth: 1,
                                borderColor: 'rgba(212, 175, 55, 0.3)',
                                paddingVertical: 12,
                                borderRadius: 4,
                            }}
                        >
                            <Search size={16} color={theme.colors.primary} />
                            <Text style={{ color: theme.colors.primary, fontWeight: '700', marginLeft: 8, fontSize: 12 }}>
                                {isSearching ? 'BUSCANDO...' : 'VERIFICAR'}
                            </Text>
                        </TouchableOpacity>
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

                {/* Stats Cards */}
                <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
                    {/* Em Execução */}
                    <Card style={{ flex: 1 }} padding="md">
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <Text style={{ color: theme.colors.primary, fontSize: 10, fontWeight: '900', fontStyle: 'italic' }}>
                                EM EXECUÇÃO
                            </Text>
                            <Wrench size={18} color={theme.colors.primary} />
                        </View>
                        <Text style={{ color: theme.colors.textMuted, fontSize: 8, letterSpacing: 1, marginBottom: 4 }}>
                            OS Ativas
                        </Text>
                        <Text style={{ color: theme.colors.textWhite, fontSize: 36, fontWeight: '900', fontStyle: 'italic' }}>
                            {activeOSCount}
                        </Text>
                        <View style={{ height: 3, backgroundColor: theme.colors.primaryMuted, marginTop: 8 }}>
                            <View style={{ height: 3, backgroundColor: theme.colors.primary, width: `${Math.min(activeOSCount * 10, 100)}%` }} />
                        </View>
                    </Card>

                    {/* Finalizadas */}
                    <Card style={{ flex: 1 }} padding="md">
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <Text style={{ color: theme.colors.primary, fontSize: 10, fontWeight: '900', fontStyle: 'italic' }}>
                                FINALIZADAS
                            </Text>
                            <View style={{ backgroundColor: theme.colors.primaryMuted, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: theme.colors.border }}>
                                <Text style={{ color: theme.colors.textMuted, fontSize: 8, fontWeight: '700' }}>{monthName}</Text>
                            </View>
                        </View>
                        <Text style={{ color: theme.colors.textMuted, fontSize: 8, letterSpacing: 1, marginBottom: 4 }}>
                            Este Mês
                        </Text>
                        <Text style={{ color: theme.colors.textWhite, fontSize: 36, fontWeight: '900', fontStyle: 'italic', textAlign: 'right' }}>
                            {completedMonthCount}
                        </Text>
                    </Card>
                </View>

                <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
                    {/* Veículos */}
                    <Card style={{ flex: 1 }} padding="md">
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <Text style={{ color: theme.colors.primary, fontSize: 10, fontWeight: '900', fontStyle: 'italic' }}>
                                VEÍCULOS
                            </Text>
                            <Car size={18} color={theme.colors.primary} />
                        </View>
                        <Text style={{ color: theme.colors.textMuted, fontSize: 8, letterSpacing: 1, marginBottom: 4 }}>
                            Atendidos no Mês
                        </Text>
                        <Text style={{ color: theme.colors.textWhite, fontSize: 36, fontWeight: '900', fontStyle: 'italic' }}>
                            {vehiclesThisMonth}
                        </Text>
                        <View style={{ height: 3, backgroundColor: theme.colors.primaryMuted, marginTop: 8 }}>
                            <View style={{ height: 3, backgroundColor: theme.colors.primary, width: `${Math.min(vehiclesThisMonth * 2, 100)}%` }} />
                        </View>
                    </Card>

                    {/* Peças/Serviços */}
                    <Card style={{ flex: 1 }} padding="md">
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <Text style={{ color: theme.colors.primary, fontSize: 10, fontWeight: '900', fontStyle: 'italic' }}>
                                PEÇAS/SERV.
                            </Text>
                            <Package size={18} color={theme.colors.primary} />
                        </View>
                        <Text style={{ color: theme.colors.textMuted, fontSize: 8, letterSpacing: 1, marginBottom: 4 }}>
                            Volume no Mês
                        </Text>
                        <Text style={{ color: theme.colors.textWhite, fontSize: 36, fontWeight: '900', fontStyle: 'italic' }}>
                            {partsThisMonth}
                        </Text>
                        <View style={{ height: 3, backgroundColor: theme.colors.primaryMuted, marginTop: 8 }}>
                            <View style={{ height: 3, backgroundColor: theme.colors.primary, width: `${Math.min(partsThisMonth, 100)}%` }} />
                        </View>
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
