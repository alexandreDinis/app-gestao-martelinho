import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Modal, TextInput, RefreshControl } from 'react-native';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { ChevronLeft, Calendar, User, Car, Share2, CheckCircle, DollarSign, Wrench, Plus, Trash2, Ban, X, Edit2, Save } from 'lucide-react-native';
import { Picker } from '@react-native-picker/picker';
import { osService } from '../services/osService';
import { userService } from '../services/userService';
import { OrdemServico, OSStatus, VeiculoOS, PecaOS, User as UserType } from '../types';
import { theme } from '../theme';
import { Card, OSStatusBadge } from '../components/ui';
import { PlateInput } from '../components/forms/PlateInput';

interface TipoPeca {
    id: number;
    nome: string;
    valorPadrao: number;
}

export const OSDetailsScreen = () => {
    const route = useRoute<RouteProp<RootStackParamList, 'OSDetails'>>();
    const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
    const { osId } = route.params;

    const [os, setOs] = useState<OrdemServico | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [updating, setUpdating] = useState(false);

    // Catalogo
    const [catalogo, setCatalogo] = useState<TipoPeca[]>([]);

    // Modals
    const [veiculoModal, setVeiculoModal] = useState(false);
    const [pecaModal, setPecaModal] = useState<{ isOpen: boolean; veiculoId: number | null }>({ isOpen: false, veiculoId: null });

    // Forms
    const [veiculoForm, setVeiculoForm] = useState({ placa: '', modelo: '', cor: '' });
    const [pecaForm, setPecaForm] = useState({ tipoPecaId: '', valorCobrado: '', descricao: '' });

    // User Assignment State
    const [users, setUsers] = useState<UserType[]>([]);
    const [isEditingUser, setIsEditingUser] = useState(false);
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

    const handleUpdateOwner = async () => {
        if (!selectedUserId) return;
        try {
            setUpdating(true);
            await osService.updateOS(osId, { usuarioId: selectedUserId });
            Alert.alert('Sucesso', 'Responsável atualizado!');
            setIsEditingUser(false);
            fetchDetails();
        } catch (error) {
            Alert.alert('Erro', 'Falha ao atualizar responsável.');
        } finally {
            setUpdating(false);
        }
    };

    const fetchDetails = useCallback(async () => {
        try {
            const data = await osService.getOSById(osId);
            setOs(data);
        } catch (error) {
            console.error(error);
            Alert.alert('Erro', 'Não foi possível carregar os detalhes da OS.');
            navigation.goBack();
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [osId]);

    const fetchCatalogo = async () => {
        try {
            const data = await osService.listTiposPeca();
            setCatalogo(data);
        } catch (error) {
            console.error('Failed to load catalog:', error);
        }
    };

    useEffect(() => {
        fetchDetails();
        fetchCatalogo();
    }, [fetchDetails]);

    const handleRefresh = () => {
        setRefreshing(true);
        fetchDetails();
    };

    const handleUpdateStatus = async (newStatus: OSStatus) => {
        try {
            setUpdating(true);
            await osService.updateStatus(osId, newStatus);
            Alert.alert('Sucesso', `Status atualizado para ${newStatus}`);
            fetchDetails();
        } catch (error) {
            Alert.alert('Erro', 'Falha ao atualizar status.');
        } finally {
            setUpdating(false);
        }
    };

    const handleSharePdf = async () => {
        await osService.openOSPdf(osId);
    };

    // Plate check state
    const [plateChecked, setPlateChecked] = useState(false);
    const [existingVehicle, setExistingVehicle] = useState<{ modelo: string; cor: string } | null>(null);

    const handleCheckPlate = async () => {
        const placaLimpa = veiculoForm.placa.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
        console.log('[OSDetails] handleCheckPlate called, placa:', placaLimpa);

        if (placaLimpa.length >= 7) {
            try {
                console.log('[OSDetails] Checking plate with API...');
                const check = await osService.verificarPlaca(placaLimpa);
                console.log('[OSDetails] API response:', JSON.stringify(check));

                if (check.existe && check.veiculoExistente) {
                    // Show alert asking if user wants to continue and auto-fill
                    Alert.alert(
                        'Veículo Já Cadastrado',
                        `Este veículo já possui serviços anteriores:\n\n${check.veiculoExistente.modelo} - ${check.veiculoExistente.cor}\n\nDeseja continuar e usar os dados existentes?`,
                        [
                            {
                                text: 'Cancelar',
                                style: 'cancel',
                                onPress: () => {
                                    setVeiculoForm({ placa: '', modelo: '', cor: '' });
                                    setPlateChecked(false);
                                },
                            },
                            {
                                text: 'Sim, Continuar',
                                onPress: () => {
                                    // Auto-fill with existing data
                                    setVeiculoForm({
                                        placa: placaLimpa,
                                        modelo: check.veiculoExistente.modelo,
                                        cor: check.veiculoExistente.cor,
                                    });
                                    setExistingVehicle(check.veiculoExistente);
                                    setPlateChecked(true);
                                },
                            },
                        ]
                    );
                } else {
                    console.log('[OSDetails] Plate not found in system');
                    setPlateChecked(true);
                    setExistingVehicle(null);
                }
            } catch (error) {
                console.error('[OSDetails] Error checking plate:', error);
                setPlateChecked(true);
            }
        } else {
            console.log('[OSDetails] Plate too short:', placaLimpa.length);
        }
    };

    const handleAddVeiculo = async () => {
        const placaLimpa = veiculoForm.placa.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

        // If only plate is filled and model is empty, try to auto-fill from existing vehicle
        if (placaLimpa.length >= 7 && !veiculoForm.modelo) {
            try {
                const check = await osService.verificarPlaca(placaLimpa);
                if (check.existe && check.veiculoExistente) {
                    // Auto-fill and add directly
                    setUpdating(true);
                    await osService.addVeiculo({
                        ordemServicoId: osId,
                        placa: placaLimpa,
                        modelo: check.veiculoExistente.modelo,
                        cor: check.veiculoExistente.cor,
                    });
                    setVeiculoModal(false);
                    setVeiculoForm({ placa: '', modelo: '', cor: '' });
                    setPlateChecked(false);
                    setExistingVehicle(null);
                    fetchDetails();
                    setUpdating(false);
                    return;
                }
            } catch (error) {
                console.log('[OSDetails] Plate check failed, requiring manual input');
            }
        }

        // Standard validation - require both plate and model for new vehicles
        if (!veiculoForm.placa || !veiculoForm.modelo) {
            Alert.alert('Atenção', 'Preencha pelo menos placa e modelo.');
            return;
        }

        try {
            setUpdating(true);
            await osService.addVeiculo({
                ordemServicoId: osId,
                placa: placaLimpa,
                modelo: veiculoForm.modelo,
                cor: veiculoForm.cor,
            });
            setVeiculoModal(false);
            setVeiculoForm({ placa: '', modelo: '', cor: '' });
            setPlateChecked(false);
            setExistingVehicle(null);
            fetchDetails();
        } catch (error: any) {
            Alert.alert('Erro', error.response?.data?.mensagem || 'Falha ao adicionar veículo.');
        } finally {
            setUpdating(false);
        }
    };

    const handleAddPeca = async () => {
        if (!pecaForm.tipoPecaId) {
            Alert.alert('Atenção', 'Selecione um item do catálogo.');
            return;
        }

        try {
            setUpdating(true);
            await osService.addPeca({
                veiculoId: pecaModal.veiculoId!,
                tipoPecaId: parseInt(pecaForm.tipoPecaId),
                valorCobrado: pecaForm.valorCobrado ? parseFloat(pecaForm.valorCobrado) : undefined,
                descricao: pecaForm.descricao || undefined,
            });
            setPecaModal({ isOpen: false, veiculoId: null });
            setPecaForm({ tipoPecaId: '', valorCobrado: '', descricao: '' });
            fetchDetails();
        } catch (error) {
            Alert.alert('Erro', 'Falha ao adicionar serviço.');
        } finally {
            setUpdating(false);
        }
    };

    const handleDeletePeca = (pecaId: number, nomePeca: string) => {
        Alert.alert(
            'Remover Serviço?',
            `Deseja remover "${nomePeca}" deste veículo?`,
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Remover',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await osService.deletePeca(pecaId);
                            fetchDetails();
                        } catch (error) {
                            Alert.alert('Erro', 'Falha ao remover serviço.');
                        }
                    },
                },
            ]
        );
    };

    const handleDeleteVeiculo = (veiculoId: number, placa: string) => {
        Alert.alert(
            'Remover Veículo?',
            `Deseja remover o veículo ${placa}? Todos os serviços associados serão removidos.`,
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Remover',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await osService.deleteVeiculo(veiculoId);
                            fetchDetails();
                        } catch (error) {
                            Alert.alert('Erro', 'Falha ao remover veículo.');
                        }
                    },
                },
            ]
        );
    };

    const handleCancelOS = () => {
        Alert.alert(
            'Cancelar OS?',
            'Deseja cancelar esta OS? Ela será excluída permanentemente.',
            [
                { text: 'Não', style: 'cancel' },
                {
                    text: 'Sim, Cancelar',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await osService.deleteOS(osId);
                            navigation.goBack();
                        } catch (error) {
                            Alert.alert('Erro', 'Falha ao cancelar OS.');
                        }
                    },
                },
            ]
        );
    };

    const formatCurrency = (val?: number) => {
        return (val || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    };

    const onSelectPeca = (id: string) => {
        const item = catalogo.find(t => t.id === parseInt(id));
        setPecaForm(prev => ({
            ...prev,
            tipoPecaId: id,
            valorCobrado: item ? item.valorPadrao.toString() : '',
        }));
    };

    if (loading || !os) {
        return (
            <View style={{ flex: 1, backgroundColor: theme.colors.background, justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator size="large" color={theme.colors.primary} />
            </View>
        );
    }

    const isFinalized = os.status === 'FINALIZADA' || os.status === 'CANCELADA';

    return (
        <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
            {/* Header */}
            <View
                style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: 16,
                    paddingTop: 50,
                    paddingBottom: 16,
                    backgroundColor: theme.colors.backgroundSecondary,
                    borderBottomWidth: 1,
                    borderBottomColor: theme.colors.border,
                }}
            >
                <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginRight: 16 }}>
                    <ChevronLeft size={24} color={theme.colors.primary} />
                </TouchableOpacity>
                <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.colors.textMuted, fontSize: 10, letterSpacing: 1 }}>ORDEM DE SERVIÇO</Text>
                    <Text style={{ color: theme.colors.primary, fontSize: 18, fontWeight: '900' }}>#{os.id}</Text>
                </View>
                <OSStatusBadge status={os.status} />
            </View>

            <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ padding: 16 }}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.colors.primary} />}
            >
                {/* Client Info */}
                <Card style={{ marginBottom: 16 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
                        <User size={18} color={theme.colors.primary} />
                        <Text style={{ color: theme.colors.primary, fontWeight: '700', marginLeft: 8, letterSpacing: 1, fontSize: 12 }}>CLIENTE</Text>
                    </View>
                    <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '700' }}>{os.cliente?.nomeFantasia || os.cliente?.razaoSocial}</Text>
                    <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginTop: 4 }}>{os.cliente?.contato}</Text>
                    <Text style={{ color: theme.colors.textMuted, fontSize: 11, marginTop: 2 }}>{os.cliente?.email}</Text>
                </Card>

                {/* Responsible User */}
                <Card style={{ marginBottom: 16 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <User size={18} color={theme.colors.primary} />
                            <Text style={{ color: theme.colors.primary, fontWeight: '700', marginLeft: 8, letterSpacing: 1, fontSize: 12 }}>RESPONSÁVEL</Text>
                        </View>
                        {!isEditingUser && !isFinalized && (
                            <TouchableOpacity onPress={() => { setIsEditingUser(true); setSelectedUserId(os.usuarioId || null); }}>
                                <Edit2 size={16} color={theme.colors.primary} />
                            </TouchableOpacity>
                        )}
                    </View>

                    {isEditingUser ? (
                        <View>
                            <View style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8, marginBottom: 8 }}>
                                <Picker
                                    selectedValue={selectedUserId}
                                    onValueChange={(itemValue) => setSelectedUserId(itemValue)}
                                    style={{ color: theme.colors.text }}
                                    dropdownIconColor={theme.colors.primary}
                                >
                                    <Picker.Item label="Selecione..." value={null} style={{ color: '#666' }} />
                                    {users.map(u => (
                                        <Picker.Item key={u.id} label={u.name || u.email} value={u.id} style={{ color: '#000' }} />
                                    ))}
                                </Picker>
                            </View>
                            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12 }}>
                                <TouchableOpacity onPress={() => setIsEditingUser(false)} style={{ padding: 8 }}>
                                    <Text style={{ color: theme.colors.error }}>Cancelar</Text>
                                </TouchableOpacity>
                                <TouchableOpacity onPress={handleUpdateOwner} style={{ padding: 8, backgroundColor: theme.colors.primary, borderRadius: 4 }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                        <Save size={14} color="#000" />
                                        <Text style={{ color: '#000', fontWeight: 'bold', marginLeft: 4 }}>Salvar</Text>
                                    </View>
                                </TouchableOpacity>
                            </View>
                        </View>
                    ) : (
                        <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '700' }}>
                            {os.usuarioNome || os.usuarioEmail || 'Não Atribuído'}
                        </Text>
                    )}
                </Card>

                {/* Date & Value Summary */}
                <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
                    <Card style={{ flex: 1 }} padding="md">
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                            <Calendar size={14} color={theme.colors.textSecondary} />
                            <Text style={{ color: theme.colors.textMuted, fontSize: 9, marginLeft: 6, letterSpacing: 1 }}>DATA</Text>
                        </View>
                        <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '700' }}>
                            {new Date(os.data).toLocaleDateString('pt-BR')}
                        </Text>
                    </Card>
                    <Card style={{ flex: 1, backgroundColor: theme.colors.primaryMuted }} padding="md">
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                            <DollarSign size={14} color={theme.colors.primary} />
                            <Text style={{ color: theme.colors.textMuted, fontSize: 9, marginLeft: 6, letterSpacing: 1 }}>TOTAL</Text>
                        </View>
                        <Text style={{ color: theme.colors.primary, fontSize: 18, fontWeight: '900' }}>
                            {formatCurrency(os.valorTotal)}
                        </Text>
                    </Card>
                </View>

                {/* Vehicles & Services Header */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <Text style={{ color: theme.colors.primary, fontSize: 12, fontWeight: '700', letterSpacing: 2 }}>
                        VEÍCULOS E SERVIÇOS
                    </Text>
                    {!isFinalized && (
                        <TouchableOpacity
                            onPress={() => setVeiculoModal(true)}
                            style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                backgroundColor: theme.colors.primaryMuted,
                                borderWidth: 1,
                                borderColor: 'rgba(212, 175, 55, 0.3)',
                                paddingHorizontal: 10,
                                paddingVertical: 6,
                                borderRadius: 4,
                            }}
                        >
                            <Plus size={14} color={theme.colors.primary} />
                            <Text style={{ color: theme.colors.primary, fontSize: 10, fontWeight: '700', marginLeft: 4 }}>VEÍCULO</Text>
                        </TouchableOpacity>
                    )}
                </View>

                {/* Vehicles List */}
                {os.veiculos?.length === 0 ? (
                    <View style={{ alignItems: 'center', padding: 32, borderWidth: 1, borderColor: theme.colors.border, borderStyle: 'dashed', borderRadius: 8 }}>
                        <Car size={32} color={theme.colors.textMuted} />
                        <Text style={{ color: theme.colors.textMuted, marginTop: 12, textAlign: 'center' }}>
                            Nenhum veículo adicionado
                        </Text>
                    </View>
                ) : (
                    os.veiculos?.map((veiculo) => (
                        <Card key={veiculo.id} style={{ marginBottom: 12 }}>
                            {/* Vehicle Header */}
                            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
                                <View style={{ width: 36, height: 36, backgroundColor: 'rgba(168, 85, 247, 0.15)', borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                                    <Car size={18} color="#a855f7" />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '700' }}>{veiculo.modelo}</Text>
                                    <Text style={{ color: theme.colors.textMuted, fontSize: 11 }}>{veiculo.placa} • {veiculo.cor}</Text>
                                </View>
                                <Text style={{ color: theme.colors.success, fontSize: 14, fontWeight: '700' }}>
                                    {formatCurrency(veiculo.valorTotal)}
                                </Text>
                                {!isFinalized && (
                                    <TouchableOpacity onPress={() => handleDeleteVeiculo(veiculo.id, veiculo.placa)} style={{ marginLeft: 8, padding: 4 }}>
                                        <Trash2 size={16} color={theme.colors.error} />
                                    </TouchableOpacity>
                                )}
                            </View>

                            {/* Parts List */}
                            {veiculo.pecas?.map((peca) => (
                                <View
                                    key={peca.id}
                                    style={{
                                        flexDirection: 'row',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        backgroundColor: 'rgba(0,0,0,0.3)',
                                        padding: 10,
                                        borderRadius: 4,
                                        marginTop: 6,
                                    }}
                                >
                                    <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                                        <Wrench size={12} color={theme.colors.textMuted} />
                                        <View style={{ marginLeft: 8 }}>
                                            <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>{peca.nomePeca}</Text>
                                            {peca.descricao && (
                                                <Text style={{ color: theme.colors.textMuted, fontSize: 10, fontStyle: 'italic' }}>{peca.descricao}</Text>
                                            )}
                                        </View>
                                    </View>
                                    <Text style={{ color: theme.colors.success, fontSize: 13, fontWeight: '600' }}>
                                        {formatCurrency(peca.valorCobrado)}
                                    </Text>
                                    {!isFinalized && (
                                        <TouchableOpacity onPress={() => handleDeletePeca(peca.id, peca.nomePeca)} style={{ marginLeft: 8, padding: 4 }}>
                                            <Trash2 size={14} color={theme.colors.error} />
                                        </TouchableOpacity>
                                    )}
                                </View>
                            ))}

                            {/* Add Service Button */}
                            {!isFinalized && (
                                <TouchableOpacity
                                    onPress={() => setPecaModal({ isOpen: true, veiculoId: veiculo.id })}
                                    style={{
                                        marginTop: 12,
                                        padding: 12,
                                        borderWidth: 1,
                                        borderColor: theme.colors.border,
                                        borderStyle: 'dashed',
                                        borderRadius: 4,
                                        alignItems: 'center',
                                        flexDirection: 'row',
                                        justifyContent: 'center',
                                    }}
                                >
                                    <Plus size={14} color={theme.colors.textMuted} />
                                    <Text style={{ color: theme.colors.textMuted, marginLeft: 6, fontSize: 12 }}>Adicionar Serviço/Peça</Text>
                                </TouchableOpacity>
                            )}
                        </Card>
                    ))
                )}
            </ScrollView>

            {/* Bottom Actions */}
            <View
                style={{
                    padding: 16,
                    backgroundColor: theme.colors.backgroundSecondary,
                    borderTopWidth: 1,
                    borderTopColor: theme.colors.border,
                }}
            >
                <View style={{ flexDirection: 'row', gap: 12 }}>
                    <TouchableOpacity
                        onPress={handleSharePdf}
                        style={{
                            flex: 1,
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: 'transparent',
                            borderWidth: 1,
                            borderColor: theme.colors.border,
                            paddingVertical: 14,
                            borderRadius: 8,
                        }}
                    >
                        <Share2 size={18} color={theme.colors.text} />
                        <Text style={{ color: theme.colors.text, fontWeight: '700', marginLeft: 8 }}>PDF</Text>
                    </TouchableOpacity>

                    {os.status === 'ABERTA' && (
                        <>
                            <TouchableOpacity
                                onPress={handleCancelOS}
                                style={{
                                    paddingHorizontal: 16,
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    backgroundColor: 'rgba(239, 68, 68, 0.15)',
                                    borderWidth: 1,
                                    borderColor: 'rgba(239, 68, 68, 0.3)',
                                    paddingVertical: 14,
                                    borderRadius: 8,
                                }}
                            >
                                <Ban size={18} color={theme.colors.error} />
                            </TouchableOpacity>
                            <TouchableOpacity
                                onPress={() => handleUpdateStatus('EM_EXECUCAO')}
                                disabled={updating}
                                style={{
                                    flex: 1,
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    backgroundColor: 'rgba(59, 130, 246, 0.9)',
                                    paddingVertical: 14,
                                    borderRadius: 8,
                                }}
                            >
                                <Wrench size={18} color="#fff" />
                                <Text style={{ color: '#fff', fontWeight: '700', marginLeft: 8 }}>INICIAR</Text>
                            </TouchableOpacity>
                        </>
                    )}

                    {os.status === 'EM_EXECUCAO' && (
                        <TouchableOpacity
                            onPress={() => handleUpdateStatus('FINALIZADA')}
                            disabled={updating}
                            style={{
                                flex: 1,
                                flexDirection: 'row',
                                alignItems: 'center',
                                justifyContent: 'center',
                                backgroundColor: updating ? 'rgba(34, 197, 94, 0.5)' : theme.colors.success,
                                paddingVertical: 14,
                                borderRadius: 8,
                            }}
                        >
                            <CheckCircle size={18} color="#fff" />
                            <Text style={{ color: '#fff', fontWeight: '700', marginLeft: 8 }}>
                                {updating ? 'ATUALIZANDO...' : 'FINALIZAR'}
                            </Text>
                        </TouchableOpacity>
                    )}
                </View>
            </View>

            {/* Add Vehicle Modal */}
            <Modal visible={veiculoModal} animationType="slide" transparent>
                <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'flex-end' }}>
                    <View
                        style={{
                            backgroundColor: theme.colors.backgroundSecondary,
                            borderTopLeftRadius: 24,
                            borderTopRightRadius: 24,
                            padding: 24,
                            borderWidth: 1,
                            borderColor: theme.colors.border,
                        }}
                    >
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                            <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: '900' }}>Novo Veículo</Text>
                            <TouchableOpacity onPress={() => setVeiculoModal(false)}>
                                <X size={24} color={theme.colors.textMuted} />
                            </TouchableOpacity>
                        </View>

                        <PlateInput
                            value={veiculoForm.placa}
                            onChange={(val) => setVeiculoForm({ ...veiculoForm, placa: val })}
                            onBlur={handleCheckPlate}
                        />
                        {existingVehicle && (
                            <Text style={{ color: theme.colors.warning, fontSize: 10, marginBottom: 16, textAlign: 'center' }}>
                                ⚠️ Dados preenchidos automaticamente de serviço anterior
                            </Text>
                        )}

                        <Text style={{ color: theme.colors.primary, fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 6 }}>MODELO</Text>
                        <TextInput
                            placeholder="Ex: Civic, Corolla..."
                            placeholderTextColor={theme.colors.textMuted}
                            value={veiculoForm.modelo}
                            onChangeText={(val) => setVeiculoForm({ ...veiculoForm, modelo: val })}
                            style={{
                                backgroundColor: 'rgba(0,0,0,0.4)',
                                borderWidth: 1,
                                borderColor: theme.colors.border,
                                color: theme.colors.text,
                                padding: 12,
                                marginBottom: 16,
                            }}
                        />

                        <Text style={{ color: theme.colors.primary, fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 6 }}>COR</Text>
                        <TextInput
                            placeholder="Ex: Prata, Preto..."
                            placeholderTextColor={theme.colors.textMuted}
                            value={veiculoForm.cor}
                            onChangeText={(val) => setVeiculoForm({ ...veiculoForm, cor: val })}
                            style={{
                                backgroundColor: 'rgba(0,0,0,0.4)',
                                borderWidth: 1,
                                borderColor: theme.colors.border,
                                color: theme.colors.text,
                                padding: 12,
                                marginBottom: 24,
                            }}
                        />

                        <TouchableOpacity
                            onPress={handleAddVeiculo}
                            disabled={updating}
                            style={{
                                backgroundColor: theme.colors.primary,
                                padding: 16,
                                borderRadius: 8,
                                alignItems: 'center',
                            }}
                        >
                            <Text style={{ color: '#000', fontWeight: '700', fontSize: 14 }}>
                                {updating ? 'ADICIONANDO...' : 'ADICIONAR VEÍCULO'}
                            </Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>

            {/* Add Service Modal */}
            <Modal visible={pecaModal.isOpen} animationType="slide" transparent>
                <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'flex-end' }}>
                    <View
                        style={{
                            backgroundColor: theme.colors.backgroundSecondary,
                            borderTopLeftRadius: 24,
                            borderTopRightRadius: 24,
                            padding: 24,
                            borderWidth: 1,
                            borderColor: theme.colors.border,
                            maxHeight: '80%',
                        }}
                    >
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                            <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: '900' }}>Adicionar Serviço</Text>
                            <TouchableOpacity onPress={() => setPecaModal({ isOpen: false, veiculoId: null })}>
                                <X size={24} color={theme.colors.textMuted} />
                            </TouchableOpacity>
                        </View>

                        <Text style={{ color: theme.colors.primary, fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 6 }}>ITEM DO CATÁLOGO</Text>
                        <ScrollView style={{ maxHeight: 200, backgroundColor: 'rgba(0,0,0,0.4)', borderWidth: 1, borderColor: theme.colors.border, marginBottom: 16 }}>
                            {catalogo.map((item) => (
                                <TouchableOpacity
                                    key={item.id}
                                    onPress={() => onSelectPeca(item.id.toString())}
                                    style={{
                                        padding: 12,
                                        borderBottomWidth: 1,
                                        borderBottomColor: theme.colors.border,
                                        backgroundColor: pecaForm.tipoPecaId === item.id.toString() ? theme.colors.primaryMuted : 'transparent',
                                    }}
                                >
                                    <Text style={{ color: theme.colors.text, fontWeight: '600' }}>{item.nome}</Text>
                                    <Text style={{ color: theme.colors.textMuted, fontSize: 11 }}>{formatCurrency(item.valorPadrao)}</Text>
                                </TouchableOpacity>
                            ))}
                        </ScrollView>

                        <Text style={{ color: theme.colors.primary, fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 6 }}>VALOR COBRADO (R$)</Text>
                        <TextInput
                            placeholder="Deixe vazio para usar padrão"
                            placeholderTextColor={theme.colors.textMuted}
                            value={pecaForm.valorCobrado}
                            onChangeText={(val) => setPecaForm({ ...pecaForm, valorCobrado: val })}
                            keyboardType="numeric"
                            style={{
                                backgroundColor: 'rgba(0,0,0,0.4)',
                                borderWidth: 1,
                                borderColor: theme.colors.border,
                                color: theme.colors.text,
                                padding: 12,
                                marginBottom: 16,
                            }}
                        />

                        <Text style={{ color: theme.colors.primary, fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 6 }}>OBSERVAÇÕES</Text>
                        <TextInput
                            placeholder="Opcional..."
                            placeholderTextColor={theme.colors.textMuted}
                            value={pecaForm.descricao}
                            onChangeText={(val) => setPecaForm({ ...pecaForm, descricao: val })}
                            multiline
                            style={{
                                backgroundColor: 'rgba(0,0,0,0.4)',
                                borderWidth: 1,
                                borderColor: theme.colors.border,
                                color: theme.colors.text,
                                padding: 12,
                                marginBottom: 24,
                                minHeight: 60,
                            }}
                        />

                        <TouchableOpacity
                            onPress={handleAddPeca}
                            disabled={updating}
                            style={{
                                backgroundColor: theme.colors.primary,
                                padding: 16,
                                borderRadius: 8,
                                alignItems: 'center',
                            }}
                        >
                            <Text style={{ color: '#000', fontWeight: '700', fontSize: 14 }}>
                                {updating ? 'ADICIONANDO...' : 'ADICIONAR SERVIÇO'}
                            </Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>
        </View>
    );
};
