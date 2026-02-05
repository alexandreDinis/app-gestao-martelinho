import React, { useState, useEffect } from 'react';
import { View, Text, Modal, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { X, Calendar, DollarSign, Car, ChevronRight, Wrench, Hash } from 'lucide-react-native';
import { theme } from '../../theme';
import { Card, OSStatusBadge } from '../ui';
import { osService } from '../../services/osService';
import { OSStatus } from '../../types';
import { useNavigation } from '@react-navigation/native';

interface HistoricoItem {
    ordemServicoId: number;
    data: string;
    status: OSStatus;
    valorTotalServico: number;
    pecasOuServicos: string[];
}

interface VehicleHistoryModalProps {
    isOpen: boolean;
    onClose: () => void;
    placa: string;
    modelo: string;
}

export const VehicleHistoryModal: React.FC<VehicleHistoryModalProps> = ({
    isOpen,
    onClose,
    placa,
    modelo,
}) => {
    const navigation = useNavigation<any>();
    const [historico, setHistorico] = useState<HistoricoItem[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (isOpen && placa) {
            fetchHistorico();
        }
    }, [isOpen, placa]);

    const fetchHistorico = async () => {
        try {
            setLoading(true);
            const data = await osService.getHistoricoVeiculo(placa);
            setHistorico(data);
        } catch (error) {
            console.error('Failed to load vehicle history:', error);
        } finally {
            setLoading(false);
        }
    };

    const formatCurrency = (val?: number) => {
        return (val || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    };

    const formatDate = (dateStr?: string) => {
        if (!dateStr) return '-';
        return new Date(dateStr).toLocaleDateString('pt-BR');
    };

    const handleSelectOS = (osId: number) => {
        onClose();
        navigation.navigate('OSDetails', { osId });
    };

    return (
        <Modal visible={isOpen} animationType="slide" transparent>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', paddingTop: 60 }}>
                <View
                    style={{
                        flex: 1,
                        backgroundColor: theme.colors.backgroundSecondary,
                        borderTopLeftRadius: 24,
                        borderTopRightRadius: 24,
                        borderWidth: 1,
                        borderColor: theme.colors.border,
                    }}
                >
                    {/* Header */}
                    <View
                        style={{
                            flexDirection: 'row',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: 16,
                            borderBottomWidth: 1,
                            borderBottomColor: theme.colors.border,
                        }}
                    >
                        <View>
                            <Text style={{ color: theme.colors.textMuted, fontSize: 10, letterSpacing: 1 }}>
                                HISTÓRICO DO VEÍCULO
                            </Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                                <Car size={18} color={theme.colors.primary} />
                                <Text style={{ color: theme.colors.primary, fontSize: 18, fontWeight: '900', marginLeft: 8 }}>
                                    {placa}
                                </Text>
                                <Text style={{ color: theme.colors.textSecondary, fontSize: 14, marginLeft: 8 }}>
                                    {modelo}
                                </Text>
                            </View>
                        </View>
                        <TouchableOpacity onPress={onClose} style={{ padding: 8 }}>
                            <X size={24} color={theme.colors.textMuted} />
                        </TouchableOpacity>
                    </View>

                    {/* Content */}
                    {loading ? (
                        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                            <ActivityIndicator size="large" color={theme.colors.primary} />
                        </View>
                    ) : (
                        <ScrollView contentContainerStyle={{ padding: 16 }}>
                            {historico.length === 0 ? (
                                <View style={{ alignItems: 'center', padding: 40 }}>
                                    <Car size={48} color={theme.colors.textMuted} />
                                    <Text style={{ color: theme.colors.textMuted, marginTop: 16, textAlign: 'center' }}>
                                        Nenhuma OS encontrada para este veículo
                                    </Text>
                                </View>
                            ) : (
                                historico.map((item) => (
                                    <TouchableOpacity key={item.ordemServicoId} onPress={() => handleSelectOS(item.ordemServicoId)}>
                                        <Card style={{ marginBottom: 16 }}>
                                            {/* OS Header */}
                                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
                                                <View style={{ flex: 1 }}>
                                                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                                                        <Hash size={12} color={theme.colors.textMuted} />
                                                        <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '900', marginLeft: 2 }}>{item.ordemServicoId}</Text>
                                                        <OSStatusBadge status={item.status} style={{ marginLeft: 8 }} />
                                                    </View>
                                                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 16 }}>
                                                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                                            <Calendar size={12} color={theme.colors.textMuted} />
                                                            <Text style={{ color: theme.colors.textMuted, fontSize: 11, marginLeft: 4 }}>
                                                                {formatDate(item.data)}
                                                            </Text>
                                                        </View>
                                                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                                            <DollarSign size={12} color={theme.colors.primary} />
                                                            <Text style={{ color: theme.colors.primary, fontSize: 13, fontWeight: '700', marginLeft: 2 }}>
                                                                {formatCurrency(item.valorTotalServico)}
                                                            </Text>
                                                        </View>
                                                    </View>
                                                </View>
                                                <ChevronRight size={20} color={theme.colors.textMuted} />
                                            </View>

                                            {/* Services List */}
                                            {item.pecasOuServicos && item.pecasOuServicos.length > 0 ? (
                                                <View>
                                                    <Text style={{ color: theme.colors.textMuted, fontSize: 9, letterSpacing: 1, marginBottom: 8 }}>
                                                        SERVIÇOS REALIZADOS
                                                    </Text>
                                                    {item.pecasOuServicos.map((servico, idx) => (
                                                        <View
                                                            key={idx}
                                                            style={{
                                                                flexDirection: 'row',
                                                                alignItems: 'center',
                                                                backgroundColor: 'rgba(0,0,0,0.3)',
                                                                padding: 10,
                                                                borderRadius: 4,
                                                                marginBottom: 6,
                                                            }}
                                                        >
                                                            <Wrench size={12} color={theme.colors.textMuted} />
                                                            <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginLeft: 8 }}>
                                                                {servico}
                                                            </Text>
                                                        </View>
                                                    ))}
                                                </View>
                                            ) : (
                                                <Text style={{ color: theme.colors.textMuted, fontSize: 11, fontStyle: 'italic' }}>
                                                    Nenhum serviço registrado
                                                </Text>
                                            )}
                                        </Card>
                                    </TouchableOpacity>
                                ))
                            )}
                        </ScrollView>
                    )}
                </View>
            </View>
        </Modal>
    );
};
