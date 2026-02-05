import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, RefreshControl, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { TrendingUp, Percent, Landmark, ReceiptText, ArrowUpRight, AlertTriangle, CheckCircle, RefreshCw } from 'lucide-react-native';
import { theme } from '../theme';
import { Card } from '../components/ui';
import { comissaoService } from '../services/comissaoService';
import { ComissaoCalculada } from '../types';

export const MyCommissionsScreen = () => {
    const today = new Date();
    const [ano, setAno] = useState(today.getFullYear());
    const [mes, setMes] = useState(today.getMonth() + 1);
    const [comissao, setComissao] = useState<ComissaoCalculada | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notEligible, setNotEligible] = useState(false);

    const fetchComissao = async () => {
        try {
            setLoading(true);
            setError(null);
            setNotEligible(false);
            const data = await comissaoService.obterComissaoMensal(ano, mes);
            setComissao(data);
        } catch (err: any) {
            console.error('Failed to load commission:', err);
            setComissao(null);

            if (err.response?.status === 400) {
                // Usuário não participa de comissão
                setNotEligible(true);
            } else if (err.response?.status !== 404) {
                setError('Falha ao carregar dados.');
            }
        } finally {
            setLoading(false);
        }
    };

    useFocusEffect(
        useCallback(() => {
            fetchComissao();
        }, [ano, mes])
    );

    const handlePreviousMonth = () => {
        if (mes === 1) {
            setMes(12);
            setAno(ano - 1);
        } else {
            setMes(mes - 1);
        }
    };

    const handleNextMonth = () => {
        if (mes === 12) {
            setMes(1);
            setAno(ano + 1);
        } else {
            setMes(mes + 1);
        }
    };

    const handleForceSync = async () => {
        try {
            setLoading(true);
            await comissaoService.forceSync(ano, mes);
            await fetchComissao();
        } catch (err) {
            console.error('Failed to sync:', err);
        }
    };

    const formatCurrency = (val?: number) => {
        return (val || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    };

    const formatPercentage = (val?: number) => {
        return `${(val || 0).toFixed(1)}%`;
    };

    const isPositivo = (comissao?.saldoAReceber || 0) >= 0;

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
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <View style={{ flex: 1, marginRight: 12 }}>
                        <Text style={{ color: theme.colors.textMuted, fontSize: 9, letterSpacing: 2 }}>SISTEMA_UNIFICADO_V2</Text>
                        <Text style={{ color: theme.colors.primary, fontSize: 22, fontWeight: '900', fontStyle: 'italic', letterSpacing: 0.5 }}>
                            Painel Unificado
                        </Text>
                    </View>

                    {/* Month Navigation */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.4)', borderWidth: 1, borderColor: theme.colors.border, height: 40 }}>
                        <TouchableOpacity onPress={handlePreviousMonth} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
                            <Text style={{ color: theme.colors.primary, fontSize: 18, fontWeight: '900' }}>{'<'}</Text>
                        </TouchableOpacity>
                        <View style={{ paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' }}>
                            <Text style={{ color: theme.colors.textMuted, fontSize: 10, fontWeight: '700' }}>
                                {mes.toString().padStart(2, '0')}.{ano}
                            </Text>
                        </View>
                        <TouchableOpacity onPress={handleNextMonth} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
                            <Text style={{ color: theme.colors.primary, fontSize: 18, fontWeight: '900' }}>{'>'}</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* Sync Button */}
                <TouchableOpacity
                    onPress={handleForceSync}
                    disabled={loading}
                    style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: theme.colors.primaryMuted,
                        borderWidth: 1,
                        borderColor: 'rgba(212, 175, 55, 0.3)',
                        paddingVertical: 8,
                        borderRadius: 4
                    }}
                >
                    <RefreshCw size={12} color={theme.colors.primary} />
                    <Text style={{ color: theme.colors.primary, fontWeight: '700', marginLeft: 8, fontSize: 10 }}>
                        {loading ? 'SINCRONIZANDO...' : 'FORÇAR SINCRONIZAÇÃO'}
                    </Text>
                </TouchableOpacity>
            </View>

            <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ padding: 16 }}
                refreshControl={
                    <RefreshControl refreshing={loading} onRefresh={fetchComissao} tintColor={theme.colors.primary} />
                }
            >
                {/* Error */}
                {error && (
                    <Card style={{ marginBottom: 16, backgroundColor: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.3)' }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.error, marginRight: 8 }} />
                            <Text style={{ color: theme.colors.error, fontWeight: '700', fontSize: 12 }}>Exceção_Crítica_Detectada</Text>
                        </View>
                        <Text style={{ color: theme.colors.error, fontSize: 11, marginTop: 4 }}>{error}</Text>
                    </Card>
                )}

                {loading ? (
                    <View style={{ alignItems: 'center', padding: 40 }}>
                        <ActivityIndicator size="large" color={theme.colors.primary} />
                        <Text style={{ color: theme.colors.textMuted, marginTop: 16, fontSize: 11, letterSpacing: 2 }}>
                            Descriptografando fluxos seguros...
                        </Text>
                    </View>
                ) : notEligible ? (
                    <Card style={{ backgroundColor: 'rgba(0,0,0,0.4)', padding: 32 }}>
                        <View style={{ alignItems: 'center' }}>
                            <View style={{
                                width: 64,
                                height: 64,
                                borderRadius: 32,
                                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                alignItems: 'center',
                                justifyContent: 'center',
                                marginBottom: 24,
                                borderWidth: 1,
                                borderColor: theme.colors.border
                            }}>
                                <Percent size={24} color={theme.colors.textMuted} style={{ opacity: 0.5 }} />
                            </View>

                            <Text style={{
                                color: theme.colors.textSecondary,
                                fontSize: 13,
                                fontWeight: '900',
                                letterSpacing: 2,
                                marginBottom: 12,
                                textAlign: 'center'
                            }}>
                                SISTEMA_NÃO_HABILITADO
                            </Text>

                            <Text style={{
                                color: theme.colors.textMuted,
                                fontSize: 11,
                                textAlign: 'center',
                                lineHeight: 20,
                                maxWidth: '80%'
                            }}>
                                Este perfil não está configurado para participar do programa de comissões e bonificações.
                            </Text>

                            <View style={{ marginTop: 24, flexDirection: 'row', alignItems: 'center' }}>
                                <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: theme.colors.primaryMuted, marginRight: 8 }} />
                                <Text style={{ color: theme.colors.textMuted, fontSize: 9 }}>STATUS: OPERACIONAL</Text>
                            </View>
                        </View>
                    </Card>
                ) : comissao ? (
                    <Card>
                        {/* Header - Refactored to stacking for better space management */}
                        <View style={{ marginBottom: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <View style={{ flex: 1 }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                        <View style={{ backgroundColor: theme.colors.primaryMuted, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: theme.colors.border }}>
                                            <Text style={{ color: theme.colors.textMuted, fontSize: 8, fontWeight: '700' }}>FEED_ESTÁVEL</Text>
                                        </View>
                                        {comissao.quitado && (
                                            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(34, 197, 94, 0.15)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                                                <CheckCircle size={10} color={theme.colors.success} />
                                                <Text style={{ color: theme.colors.success, fontSize: 8, fontWeight: '700', marginLeft: 4 }}>QUITADO</Text>
                                            </View>
                                        )}
                                    </View>
                                    <View style={{ marginTop: 8 }}>
                                        <Text style={{ color: theme.colors.primary, fontSize: 24, fontWeight: '900', fontStyle: 'italic' }}>
                                            CRYSTAL_{comissao.anoMesReferencia}
                                        </Text>
                                    </View>
                                </View>

                                <View style={{ alignItems: 'flex-end', marginLeft: 12, maxWidth: '40%' }}>
                                    <Text style={{ color: theme.colors.textMuted, fontSize: 8, letterSpacing: 1, textAlign: 'right' }}>NÍVEL_CÁLCULO</Text>
                                    <Text style={{ color: theme.colors.primary, fontSize: 16, fontWeight: '900', fontStyle: 'italic', textAlign: 'right', flexWrap: 'wrap' }}>
                                        {comissao.faixaComissao || '-'}
                                    </Text>
                                </View>
                            </View>
                        </View>

                        {/* Saldo Anterior */}
                        {comissao.saldoAnterior && comissao.saldoAnterior !== 0 && (
                            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(245, 158, 11, 0.1)', borderWidth: 1, borderColor: 'rgba(245, 158, 11, 0.3)', padding: 12, marginBottom: 16 }}>
                                <AlertTriangle size={16} color={theme.colors.warning} />
                                <View style={{ marginLeft: 12 }}>
                                    <Text style={{ color: theme.colors.warning, fontSize: 9, letterSpacing: 1 }}>SALDO_ANTERIOR (CARRYOVER)</Text>
                                    <Text style={{ color: theme.colors.warning, fontSize: 16, fontWeight: '900', fontStyle: 'italic' }}>
                                        {formatCurrency(comissao.saldoAnterior)}
                                    </Text>
                                </View>
                            </View>
                        )}

                        {/* Stats Grid */}
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
                            {[
                                { label: 'FATUR_GERAL', value: formatCurrency(comissao.faturamentoMensal), icon: TrendingUp },
                                { label: 'TAXA_RENDIM', value: formatPercentage(comissao.porcentagemComissao), icon: Percent },
                                { label: 'ALOC_BRUTA', value: formatCurrency(comissao.valorBrutoComissao), icon: ReceiptText },
                                { label: 'SAQUE_PRÉVIO', value: formatCurrency(comissao.valorAdiantado), icon: Landmark },
                            ].map((stat, idx) => (
                                <View key={idx} style={{ width: '47%', backgroundColor: 'rgba(0,0,0,0.4)', borderWidth: 1, borderColor: theme.colors.border, padding: 16 }}>
                                    <stat.icon size={14} color={theme.colors.textMuted} style={{ marginBottom: 8 }} />
                                    <Text style={{ color: theme.colors.textMuted, fontSize: 7, letterSpacing: 1 }}>{stat.label}</Text>
                                    <Text style={{ color: theme.colors.primary, fontSize: 16, fontWeight: '900', fontStyle: 'italic', marginTop: 4 }}>{stat.value}</Text>
                                </View>
                            ))}
                        </View>

                        {/* Saldo A Receber */}
                        <View
                            style={{
                                backgroundColor: 'rgba(0,0,0,0.6)',
                                borderWidth: 2,
                                borderColor: isPositivo ? theme.colors.primary : theme.colors.error,
                                padding: 24,
                                flexDirection: 'row',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                            }}
                        >
                            <View>
                                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: isPositivo ? theme.colors.primary : theme.colors.error }} />
                                    <Text style={{ color: isPositivo ? theme.colors.textSecondary : theme.colors.error, fontSize: 9, letterSpacing: 1, marginLeft: 8 }}>
                                        LIQUIDAÇÃO_LÍQUIDA_A_PAGAR
                                    </Text>
                                </View>
                                <Text style={{ color: isPositivo ? theme.colors.primary : theme.colors.error, fontSize: 36, fontWeight: '900', fontStyle: 'italic' }}>
                                    {formatCurrency(comissao.saldoAReceber)}
                                </Text>
                                {comissao.quitado && comissao.dataQuitacao && (
                                    <Text style={{ color: theme.colors.success, fontSize: 10, marginTop: 8 }}>
                                        Quitado em: {new Date(comissao.dataQuitacao).toLocaleDateString('pt-BR')}
                                    </Text>
                                )}
                            </View>
                            <View style={{ backgroundColor: isPositivo ? theme.colors.primaryMuted : 'rgba(239, 68, 68, 0.1)', borderWidth: 2, borderColor: isPositivo ? theme.colors.border : 'rgba(239, 68, 68, 0.3)', padding: 16 }}>
                                <ArrowUpRight size={32} color={isPositivo ? theme.colors.primary : theme.colors.error} style={!isPositivo ? { transform: [{ rotate: '90deg' }] } : undefined} />
                            </View>
                        </View>
                    </Card>
                ) : (
                    <Card style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
                        <View style={{ alignItems: 'center', padding: 40 }}>
                            <Text style={{ color: theme.colors.textSecondary, fontSize: 12, fontWeight: '900', fontStyle: 'italic', letterSpacing: 2, marginBottom: 16 }}>
                                Exceção_Dados_Nulos
                            </Text>
                            <View style={{ width: 40, height: 1, backgroundColor: theme.colors.border, marginBottom: 16 }} />
                            <Text style={{ color: theme.colors.textMuted, fontSize: 10, textAlign: 'center', lineHeight: 18 }}>
                                Nenhuma comissão encontrada para o período. Inicialize os módulos de faturamento para prosseguir.
                            </Text>
                        </View>
                    </Card>
                )}
            </ScrollView>
        </View>
    );
};
