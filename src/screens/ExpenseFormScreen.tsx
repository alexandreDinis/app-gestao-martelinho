import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ChevronLeft, DollarSign, FileText, Tag, Calendar, CheckCircle } from 'lucide-react-native';
import { financeiroService } from '../services/financeiroService';
import { despesaService } from '../services/despesaService';
import { cartaoService, Cartao } from '../services/cartaoService';
import { theme } from '../theme';
import { Card, Input, Button } from '../components/ui';
import { DespesaRequest } from '../types';
import { Picker } from '@react-native-picker/picker';

export const ExpenseFormScreen = () => {
    const navigation = useNavigation();

    // Form State
    const [descricao, setDescricao] = useState('');
    const [valor, setValor] = useState(''); // Text input for currency
    const [categoria, setCategoria] = useState('');
    const [formaPagamento, setFormaPagamento] = useState<'DINHEIRO' | 'PIX' | 'CARTAO_CREDITO' | 'CARTAO_DEBITO' | 'TRANSFERENCIA' | 'BOLETO'>('PIX');
    const [loading, setLoading] = useState(false);

    // Credit Card & Installments
    const [cartoes, setCartoes] = useState<Cartao[]>([]);
    const [cartaoId, setCartaoId] = useState<number | undefined>(undefined);
    const [numeroParcelas, setNumeroParcelas] = useState(1);

    React.useEffect(() => {
        cartaoService.listar().then(setCartoes).catch(console.error);
    }, []);

    const valorNumerico = parseFloat(valor.replace(',', '.')) || 0;

    const installmentValue = React.useMemo(() => {
        if (valorNumerico <= 0 || numeroParcelas <= 1) return null;
        return (valorNumerico / numeroParcelas).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }, [valorNumerico, numeroParcelas]);

    const handleSave = async () => {
        if (!descricao || !valor || !categoria) {
            Alert.alert('Atenção', 'Preencha todos os campos obrigatórios.');
            return;
        }

        // Parse monetary value (simple implementation assuming user types number)
        // Ideally use a currency mask library, but keeping it simple for now
        const valorNumerico = parseFloat(valor.replace(',', '.'));
        if (isNaN(valorNumerico) || valorNumerico <= 0) {
            Alert.alert('Erro', 'Valor inválido.');
            return;
        }

        try {
            setLoading(true);

            const payload: DespesaRequest = {
                dataDespesa: new Date().toISOString().split('T')[0],
                valor: valorNumerico,
                categoria: categoria.toUpperCase(),
                descricao: descricao,
                pagoAgora: formaPagamento !== 'CARTAO_CREDITO', // If credit card, it's NOT paid now (invoice)
                meioPagamento: formaPagamento,
                cartaoId: formaPagamento === 'CARTAO_CREDITO' ? cartaoId : undefined,
                numeroParcelas: formaPagamento === 'CARTAO_CREDITO' ? numeroParcelas : undefined
            };

            if (payload.numeroParcelas && payload.numeroParcelas > 1) {
                await despesaService.createParcelada(payload);
            } else {
                await despesaService.create(payload);
            }

            Alert.alert('Sucesso', 'Despesa registrada com sucesso!', [
                { text: 'OK', onPress: () => navigation.goBack() }
            ]);

        } catch (error: any) {
            console.error(error);
            Alert.alert('Erro', error.response?.data?.message || 'Falha ao salvar despesa.');
        } finally {
            setLoading(false);
        }
    };

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
                <View>
                    <Text style={{ color: theme.colors.primary, fontSize: 18, fontWeight: '900', letterSpacing: 1 }}>NOVA DESPESA</Text>
                    <Text style={{ color: theme.colors.textMuted, fontSize: 10, letterSpacing: 1 }}>Registrar saída de caixa</Text>
                </View>
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
                <Card>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 24 }}>
                        <View style={{ width: 40, height: 40, backgroundColor: 'rgba(239, 68, 68, 0.1)', borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                            <DollarSign size={20} color={theme.colors.error} />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '700' }}>Detalhes da Saída</Text>
                            <Text style={{ color: theme.colors.textMuted, fontSize: 11 }}>Informações para controle financeiro</Text>
                        </View>
                    </View>

                    <Input
                        label="DESCRIÇÃO"
                        placeholder="Ex: Compra de Material escritório"
                        value={descricao}
                        onChangeText={setDescricao}
                        icon={<FileText size={16} color={theme.colors.textSecondary} />}
                        containerStyle={{ marginBottom: 16 }}
                    />

                    <Input
                        label="VALOR (R$)"
                        placeholder="0.00"
                        value={valor}
                        onChangeText={setValor}
                        keyboardType="numeric"
                        icon={<DollarSign size={16} color={theme.colors.textSecondary} />}
                        containerStyle={{ marginBottom: 16 }}
                    />

                    <Input
                        label="CATEGORIA"
                        placeholder="Ex: MATERIAL, ALIMENTACAO, COMBUSTIVEL"
                        value={categoria}
                        onChangeText={setCategoria}
                        autoCapitalize="characters"
                        icon={<Tag size={16} color={theme.colors.textSecondary} />}
                        containerStyle={{ marginBottom: 24 }}
                    />

                    {/* Forma de Pagamento */}
                    <View style={{ marginBottom: 24 }}>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: theme.colors.textMuted, marginBottom: 8, letterSpacing: 1 }}>
                            FORMA DE PAGAMENTO
                        </Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                            {(['DINHEIRO', 'PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO'] as const).map((method) => (
                                <TouchableOpacity
                                    key={method}
                                    onPress={() => setFormaPagamento(method)}
                                    style={{
                                        borderWidth: 1,
                                        borderColor: formaPagamento === method ? theme.colors.primary : theme.colors.border,
                                        backgroundColor: formaPagamento === method ? 'rgba(212, 175, 55, 0.1)' : 'transparent',
                                        paddingHorizontal: 16,
                                        paddingVertical: 8,
                                        borderRadius: 20,
                                    }}
                                >
                                    <Text style={{
                                        color: formaPagamento === method ? theme.colors.primary : theme.colors.textMuted,
                                        fontSize: 10,
                                        fontWeight: '700'
                                    }}>
                                        {method.replace('_', ' ')}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                        {/* Credit Card Specific Fields */}
                        {formaPagamento === 'CARTAO_CREDITO' && (
                            <View style={{ marginBottom: 24, padding: 16, backgroundColor: 'rgba(0,0,0,0.03)', borderRadius: 8 }}>
                                <Text style={{ fontSize: 12, fontWeight: '700', color: theme.colors.text, marginBottom: 8 }}>
                                    SELECIONE O CARTÃO
                                </Text>
                                <Picker
                                    selectedValue={cartaoId}
                                    onValueChange={(itemValue) => setCartaoId(itemValue)}
                                    style={{ backgroundColor: theme.colors.background }}
                                >
                                    <Picker.Item label="Selecione um cartão..." value={undefined} />
                                    {cartoes.map(c => (
                                        <Picker.Item key={c.id} label={c.nome} value={c.id} />
                                    ))}
                                </Picker>

                                <Text style={{ fontSize: 12, fontWeight: '700', color: theme.colors.text, marginTop: 16, marginBottom: 8 }}>
                                    PARCELAMENTO
                                </Text>
                                <Picker
                                    selectedValue={numeroParcelas}
                                    onValueChange={(itemValue) => setNumeroParcelas(itemValue)}
                                    style={{ backgroundColor: theme.colors.background }}
                                >
                                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(num => {
                                        const val = valorNumerico > 0
                                            ? (valorNumerico / num).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                                            : '';
                                        return (
                                            <Picker.Item
                                                key={num}
                                                label={`${num}x ${val ? `- ${val}` : ''} ${num === 1 ? '(À Vista)' : ''}`}
                                                value={num}
                                            />
                                        );
                                    })}
                                </Picker>
                            </View>
                        )}
                    </View>

                    {/* Date Info (Read Only for MVP) */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 24 }}>
                        <Calendar size={14} color={theme.colors.textMuted} />
                        <Text style={{ color: theme.colors.textMuted, fontSize: 11, marginLeft: 8 }}>
                            Data do lançamento: {new Date().toLocaleDateString('pt-BR')}
                        </Text>
                    </View>

                    <Button onPress={handleSave} loading={loading} disabled={loading} variant="danger">
                        {loading ? 'REGISTRANDO...' : 'CONFIRMAR DESPESA >>'}
                    </Button>
                </Card>
            </ScrollView>
        </View>
    );
};
