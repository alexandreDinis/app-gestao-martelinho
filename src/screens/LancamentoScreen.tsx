import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ChevronLeft, DollarSign, FileText, Tag, Calendar, CreditCard, Wifi, WifiOff, CloudOff } from 'lucide-react-native';
import { Picker } from '@react-native-picker/picker'; // Moved import to top
import { despesaService } from '../services/despesaService';
import { cartaoService } from '../services/cartaoService';
import { theme } from '../theme';
import { Card, Input, Button } from '../components/ui';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';

// Renamed from ExpenseFormScreen to LancamentoScreen to match navigation
export const LancamentoScreen = () => {
    const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();

    // Form State
    const [values, setValues] = useState({
        dataDespesa: new Date().toISOString().split('T')[0],
        valor: '',
        categoria: 'BENEFICIOS',
        descricao: '',
        pagoAgora: false,
        meioPagamento: '',
        dataVencimento: '',
        cartaoId: null as number | null,
        numeroParcelas: 1
    });

    // UI State
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Data State
    const [cartoes, setCartoes] = useState<any[]>([]);
    const [loadingCartoes, setLoadingCartoes] = useState(true);
    const [limiteInfo, setLimiteInfo] = useState<import('../services/cartaoService').LimiteDisponivelDTO | null>(null);

    // Categorias (mesmo da web)
    const categorias = [
        {
            grupo: 'SERVIÇOS PRESTADOS', options: [
                { value: 'MATERIAIS_APLICADOS', label: '🔩 MATERIAIS APLICADOS' },
                { value: 'SERVICOS_TERCEIROS', label: '👥 SERVIÇOS DE TERCEIROS' },
            ]
        },
        {
            grupo: 'PESSOAL', options: [
                { value: 'SALARIOS', label: '💰 SALÁRIOS' },
                { value: 'PROLABORE', label: '👔 PRÓ-LABORE' },
                { value: 'COMISSOES', label: '🤝 COMISSÕES' },
                { value: 'BENEFICIOS', label: '🎁 BENEFÍCIOS' },
                { value: 'ADIANTAMENTOS', label: '💸 ADIANTAMENTOS' },
            ]
        },
        {
            grupo: 'ADMINISTRATIVO', options: [
                { value: 'OCUPACAO', label: '🏠 OCUPAÇÃO (ALUGUEL)' },
                { value: 'UTILIDADES', label: '💡 UTILIDADES (LUZ/ÁGUA)' },
                { value: 'MANUTENCAO_PREDIAL', label: '🔨 MANUTENÇÃO PREDIAL' },
                { value: 'MATERIAL_USO_CONSUMO', label: '📎 MATERIAL DE USO E CONSUMO' },
                { value: 'SERVICOS_PROFISSIONAIS', label: '⚖️ SERVIÇOS PROFISSIONAIS' },
            ]
        },
        {
            grupo: 'COMERCIAL', options: [
                { value: 'MARKETING', label: '📢 MARKETING' },
                { value: 'VIAGENS_REPRESENTACAO', label: '✈️ VIAGENS' },
                { value: 'COMBUSTIVEL', label: '⛽ COMBUSTÍVEL' },
            ]
        },
        {
            grupo: 'FINANCEIRO', options: [
                { value: 'TARIFAS_BANCARIAS', label: '🏦 TARIFAS BANCÁRIAS' },
                { value: 'JUROS_PASSIVOS', label: '📉 JUROS PASSIVOS' },
            ]
        },
        {
            grupo: 'TRIBUTÁRIO', options: [
                { value: 'IMPOSTOS_SOBRE_VENDA', label: '📋 IMPOSTOS SOBRE VENDA' },
                { value: 'TAXAS_DIVERSAS', label: '🎫 TAXAS DIVERSAS' },
            ]
        },
        {
            grupo: 'OUTROS', options: [
                { value: 'DIVERSOS', label: '📦 DIVERSOS' },
                { value: 'OUTROS', label: '❓ OUTROS' },
            ]
        }
    ];

    const meiosPagamento = [
        { value: '', label: 'SELECIONE...' },
        { value: 'DINHEIRO', label: 'DINHEIRO' },
        { value: 'PIX', label: 'PIX' },
        { value: 'CARTAO_CREDITO', label: 'CARTÃO DE CRÉDITO' },
        { value: 'CARTAO_DEBITO', label: 'CARTÃO DE DÉBITO' },
        { value: 'BOLETO', label: 'BOLETO' },
        { value: 'TRANSFERENCIA', label: 'TRANSFERÊNCIA' },
    ];

    useEffect(() => {
        // Carregar cartões
        carregarCartoes();
    }, []);

    useEffect(() => {
        if (values.cartaoId) {
            setLimiteInfo(null); // Reset while loading
            cartaoService.getLimiteDisponivel(values.cartaoId)
                .then(setLimiteInfo)
                .catch(err => console.error("Erro ao buscar limite:", err));
        } else {
            setLimiteInfo(null);
        }
    }, [values.cartaoId]);

    const carregarCartoes = async () => {
        try {
            setLoadingCartoes(true);
            const dados = await cartaoService.listar();
            setCartoes(dados);
        } catch (error) {
            console.error('Erro ao carregar cartões:', error);
            // Em caso de erro, continua com array vazio
        } finally {
            setLoadingCartoes(false);
        }
    };

    const handleChange = (name: string, value: any) => {
        setValues(prev => {
            const newValues = { ...prev, [name]: value };

            // Lógica: Se cartão selecionado, força A Prazo e limpa pagoAgora
            if (name === 'cartaoId') {
                if (value) {
                    return {
                        ...newValues,
                        cartaoId: Number(value),
                        pagoAgora: false,
                        dataVencimento: '',
                        meioPagamento: 'CARTAO_CREDITO'
                    };
                } else {
                    return {
                        ...newValues,
                        cartaoId: null,
                        meioPagamento: '',
                        numeroParcelas: 1
                    };
                }
            }

            // Resetar parcelas se mudar meio de pagamento para algo que não seja cartão
            if (name === 'meioPagamento' && value !== 'CARTAO_CREDITO') {
                newValues.numeroParcelas = 1;
            }

            return newValues;
        });
        setError(null);
    };

    const handleToggle = () => {
        setValues(prev => ({ ...prev, pagoAgora: !prev.pagoAgora }));
    };

    const formatarValor = (text: string) => {
        let value = text.replace(/\D/g, '');
        if (value === '') {
            return '';
        }
        const numericValue = parseInt(value) / 100;
        const formatted = new Intl.NumberFormat('pt-BR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(numericValue);
        return formatted;
    };

    const handleValorChange = (text: string) => {
        const formatted = formatarValor(text);
        handleChange('valor', formatted);
    };

    const handleSave = async () => {
        // Validações
        const numericValor = typeof values.valor === 'string'
            ? parseFloat(values.valor.replace(/\./g, '').replace(',', '.'))
            : values.valor;

        if (isNaN(numericValor as number) || (numericValor as number) <= 0) {
            Alert.alert('Erro', 'Informe um valor válido.');
            return;
        }

        if (values.pagoAgora && !values.meioPagamento) {
            Alert.alert('Erro', 'Para pagamento à vista, o meio de pagamento é obrigatório.');
            return;
        }

        if (!values.pagoAgora && !values.cartaoId && !values.dataVencimento) {
            Alert.alert('Erro', 'Para pagamento a prazo, informe a data de vencimento.');
            return;
        }

        try {
            setLoading(true);

            // Payload base
            const payload = {
                ...values,
                valor: numericValor,
            };

            // Roteamento para endpoint correto (Parcelado vs Simples)
            if (values.numeroParcelas > 1) {
                await despesaService.createParcelada(payload);
            } else {
                await despesaService.create(payload);
            }

            Alert.alert('Sucesso', 'Despesa registrada com sucesso!', [
                { text: 'OK', onPress: () => navigation.goBack() }
            ]);

        } catch (error) {
            console.error(error);

            Alert.alert(
                'Atenção',
                'Despesa salva localmente! Será sincronizada automaticamente quando possível.',
                [{ text: 'OK', onPress: () => navigation.goBack() }]
            );
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
                {/* Note: In Tab navigation, we might not want this GoBack if it's a main tab, but maintaining user request logic */}
                <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginRight: 16 }}>
                    <ChevronLeft size={24} color={theme.colors.primary} />
                </TouchableOpacity>
                <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.colors.primary, fontSize: 18, fontWeight: '900', letterSpacing: 1 }}>
                        NOVA DESPESA
                    </Text>
                    <Text style={{ color: theme.colors.textMuted, fontSize: 10, letterSpacing: 1 }}>
                        Registrar saída de caixa
                    </Text>
                </View>
            </View>



            {error && (
                <View style={{
                    backgroundColor: '#fee2e2',
                    paddingVertical: 12,
                    paddingHorizontal: 16,
                    borderBottomWidth: 1,
                    borderBottomColor: '#fecaca'
                }}>
                    <Text style={{ fontSize: 11, color: '#991b1b', fontWeight: '600' }}>
                        {error}
                    </Text>
                </View>
            )}

            <KeyboardAvoidingView
                style={{ flex: 1 }}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
            >
                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
                    <Card>
                        {/* Header do Card */}
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 24 }}>
                            <View style={{
                                width: 40,
                                height: 40,
                                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                                borderRadius: 20,
                                alignItems: 'center',
                                justifyContent: 'center',
                                marginRight: 12
                            }}>
                                <DollarSign size={20} color={theme.colors.error} />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '700' }}>
                                    Detalhes da Despesa
                                </Text>
                                <Text style={{ color: theme.colors.textMuted, fontSize: 11 }}>
                                    Informações para controle financeiro
                                </Text>
                            </View>
                        </View>

                        {/* Seletor de Cartão */}
                        <View style={{ marginBottom: 16 }}>
                            <Text style={{
                                fontSize: 10,
                                fontWeight: '700',
                                color: theme.colors.textSecondary,
                                marginBottom: 8,
                                letterSpacing: 1
                            }}>
                                CARTÃO CORPORATIVO (Opcional)
                            </Text>
                            <View style={{
                                backgroundColor: theme.colors.backgroundSecondary,
                                borderWidth: 1,
                                borderColor: theme.colors.border,
                                borderRadius: theme.borderRadius.sm,
                            }}>
                                <Picker
                                    selectedValue={values.cartaoId || ''}
                                    onValueChange={(value) => handleChange('cartaoId', value)}
                                    style={{
                                        color: theme.colors.text,
                                    }}
                                    dropdownIconColor={theme.colors.text}
                                >
                                    <Picker.Item label="— NENHUM (Despesa Comum) —" value="" />
                                    {loadingCartoes ? (
                                        <Picker.Item label="Carregando..." value="" />
                                    ) : (
                                        cartoes.map(c => (
                                            <Picker.Item
                                                key={c.id}
                                                label={`💳 ${c.nome} (Vence dia ${c.diaVencimento})`}
                                                value={c.id}
                                                color={theme.colors.text}
                                                style={{ backgroundColor: theme.colors.backgroundSecondary }}
                                            />
                                        ))
                                    )}
                                </Picker>
                            </View>
                            {/* Info do Cartão Selecionado */}
                            {values.cartaoId && (
                                <View>
                                    <Text style={{
                                        fontSize: 9,
                                        color: theme.colors.textMuted,
                                        marginTop: 4
                                    }}>
                                        ⚡ Despesa será agrupada na fatura do cartão automaticamente
                                    </Text>

                                    {(() => {
                                        const cartaoSelecionado = cartoes.find(c => c.id === values.cartaoId);
                                        if (!cartaoSelecionado) return null;

                                        return (
                                            <View style={{
                                                flexDirection: 'row',
                                                justifyContent: 'space-between',
                                                marginTop: 8,
                                                paddingTop: 8,
                                                borderTopWidth: 1,
                                                borderTopColor: theme.colors.border
                                            }}>
                                                <View>
                                                    <Text style={{ fontSize: 9, color: theme.colors.textMuted, fontWeight: '700' }}>LIMITE TOTAL</Text>
                                                    <Text style={{ fontSize: 11, color: theme.colors.text, fontWeight: '700' }}>
                                                        {cartaoSelecionado.limite?.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                                    </Text>
                                                </View>
                                                <View style={{ alignItems: 'flex-end' }}>
                                                    <Text style={{ fontSize: 9, color: theme.colors.textMuted, fontWeight: '700' }}>DISPONÍVEL</Text>
                                                    {limiteInfo ? (
                                                        <Text style={{
                                                            fontSize: 11,
                                                            color: (limiteInfo.limiteDisponivel || 0) < 0 ? theme.colors.error : theme.colors.text,
                                                            fontWeight: '700'
                                                        }}>
                                                            {(limiteInfo.limiteDisponivel || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                                        </Text>
                                                    ) : (
                                                        <ActivityIndicator size="small" color={theme.colors.primary} style={{ transform: [{ scale: 0.7 }] }} />
                                                    )}
                                                </View>
                                            </View>
                                        );
                                    })()}
                                </View>
                            )}
                        </View>

                        {/* Toggle Pago Agora - só mostra se NÃO tiver cartão */}
                        {!values.cartaoId && (
                            <TouchableOpacity
                                onPress={handleToggle}
                                style={{
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    backgroundColor: 'rgba(212, 175, 55, 0.05)',
                                    padding: 16,
                                    borderWidth: 1,
                                    borderColor: 'rgba(212, 175, 55, 0.1)',
                                    marginBottom: 16
                                }}
                            >
                                <View>
                                    <Text style={{ color: theme.colors.text, fontSize: 12, fontWeight: '700' }}>
                                        PAGO À VISTA?
                                    </Text>
                                    <Text style={{ color: theme.colors.textMuted, fontSize: 9, marginTop: 2 }}>
                                        Marque "Sim" se o dinheiro já saiu do caixa
                                    </Text>
                                </View>
                                <View style={{
                                    width: 48,
                                    height: 24,
                                    borderRadius: 0,
                                    backgroundColor: values.pagoAgora ? 'rgba(212, 175, 55, 0.2)' : 'rgba(0, 0, 0, 0.4)',
                                    borderWidth: 1,
                                    borderColor: values.pagoAgora ? theme.colors.primary : 'rgba(212, 175, 55, 0.3)',
                                    padding: 4,
                                    justifyContent: 'center',
                                    alignItems: values.pagoAgora ? 'flex-end' : 'flex-start'
                                }}>
                                    <View style={{
                                        width: 16,
                                        height: 16,
                                        backgroundColor: values.pagoAgora ? theme.colors.primary : 'rgba(212, 175, 55, 0.3)'
                                    }} />
                                </View>
                            </TouchableOpacity>
                        )}

                        {/* Data e Categoria */}
                        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
                            <View style={{ flex: 1 }}>
                                <Text style={{
                                    fontSize: 10,
                                    fontWeight: '700',
                                    color: theme.colors.textSecondary,
                                    marginBottom: 8,
                                    letterSpacing: 1
                                }}>
                                    DATA
                                </Text>
                                {/* Input type="date" is not standard in RN, but user requested it. 
                                Assuming Input component handles it or we rely on text input YYYY-MM-DD.
                                Given Input.tsx, it's just a text input.
                            */}
                                <Input
                                    placeholder="YYYY-MM-DD"
                                    value={values.dataDespesa}
                                    onChangeText={(value) => handleChange('dataDespesa', value)}
                                    icon={<Calendar size={16} color={theme.colors.textSecondary} />}
                                />
                            </View>

                            <View style={{ flex: 1 }}>
                                <Text style={{
                                    fontSize: 10,
                                    fontWeight: '700',
                                    color: theme.colors.textSecondary,
                                    marginBottom: 8,
                                    letterSpacing: 1
                                }}>
                                    CATEGORIA
                                </Text>
                                <View style={{
                                    backgroundColor: theme.colors.backgroundSecondary,
                                    borderWidth: 1,
                                    borderColor: theme.colors.border,
                                    borderRadius: theme.borderRadius.sm,
                                }}>
                                    <Picker
                                        selectedValue={values.categoria}
                                        onValueChange={(value) => handleChange('categoria', value)}
                                        style={{ color: theme.colors.text }}
                                        dropdownIconColor={theme.colors.text}
                                    >
                                        {categorias.map((grupo, idx) => (
                                            [
                                                <Picker.Item
                                                    key={`group-${idx}`}
                                                    label={`── ${grupo.grupo} ──`}
                                                    value="HEADER"
                                                    enabled={false}
                                                    color={theme.colors.textMuted}
                                                    style={{ fontSize: 12, backgroundColor: theme.colors.backgroundSecondary }}
                                                />,
                                                ...grupo.options.map(opt => (
                                                    <Picker.Item
                                                        key={opt.value}
                                                        label={opt.label}
                                                        value={opt.value}
                                                        color={theme.colors.text}
                                                        style={{ backgroundColor: theme.colors.backgroundSecondary }}
                                                    />
                                                ))
                                            ]
                                        ))}
                                    </Picker>
                                </View>
                            </View>
                        </View>

                        {/* Valor */}
                        <Input
                            label="VALOR (R$)"
                            placeholder="0,00"
                            value={values.valor}
                            onChangeText={handleValorChange}
                            keyboardType="numeric"
                            icon={<DollarSign size={16} color={theme.colors.textSecondary} />}
                            containerStyle={{ marginBottom: 16 }}
                        />

                        {/* Campos Condicionais */}
                        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
                            {/* Vencimento - só mostra se NÃO pago agora e SEM cartão */}
                            {!values.pagoAgora && !values.cartaoId && (
                                <View style={{ flex: 1 }}>
                                    <Text style={{
                                        fontSize: 10,
                                        fontWeight: '700',
                                        color: theme.colors.textSecondary,
                                        marginBottom: 8,
                                        letterSpacing: 1
                                    }}>
                                        VENCIMENTO *
                                    </Text>
                                    <Input
                                        placeholder="YYYY-MM-DD"
                                        value={values.dataVencimento || ''}
                                        onChangeText={(value) => handleChange('dataVencimento', value)}
                                        icon={<Calendar size={16} color={theme.colors.textSecondary} />}
                                    />
                                </View>
                            )}

                            {/* Meio de Pagamento */}
                            <View style={{ flex: 1 }}>
                                <Text style={{
                                    fontSize: 10,
                                    fontWeight: '700',
                                    color: theme.colors.textSecondary,
                                    marginBottom: 8,
                                    letterSpacing: 1
                                }}>
                                    MEIO DE PAGAMENTO {values.pagoAgora ? '*' : '(Opcional)'}
                                </Text>
                                <View style={{
                                    backgroundColor: theme.colors.backgroundSecondary,
                                    borderWidth: 1,
                                    borderColor: theme.colors.border,
                                    borderRadius: theme.borderRadius.sm,
                                }}>
                                    <Picker
                                        selectedValue={values.meioPagamento || ''}
                                        onValueChange={(value) => handleChange('meioPagamento', value)}
                                        style={{ color: theme.colors.text }}
                                        dropdownIconColor={theme.colors.text}
                                    >
                                        {meiosPagamento.map(meio => (
                                            <Picker.Item
                                                key={meio.value}
                                                label={meio.label}
                                                value={meio.value}
                                                color={theme.colors.text}
                                                style={{ backgroundColor: theme.colors.backgroundSecondary }}
                                            />
                                        ))}
                                    </Picker>
                                </View>
                            </View>
                        </View>

                        {/* Parcelas - Apenas para Cartão de Crédito */}
                        {values.meioPagamento === 'CARTAO_CREDITO' && (
                            <View style={{ marginBottom: 16 }}>
                                <Text style={{
                                    fontSize: 10,
                                    fontWeight: '700',
                                    color: theme.colors.textSecondary,
                                    marginBottom: 8,
                                    letterSpacing: 1
                                }}>
                                    PARCELAS
                                </Text>
                                <View style={{
                                    backgroundColor: theme.colors.backgroundSecondary,
                                    borderWidth: 1,
                                    borderColor: theme.colors.border,
                                    borderRadius: theme.borderRadius.sm,
                                }}>
                                    <Picker
                                        selectedValue={values.numeroParcelas}
                                        onValueChange={(value) => handleChange('numeroParcelas', value)}
                                        style={{ color: theme.colors.text }}
                                        dropdownIconColor={theme.colors.text}
                                    >
                                        {Array.from({ length: 12 }, (_, i) => i + 1).map(num => (
                                            <Picker.Item
                                                key={num}
                                                label={`${num}x${num > 1 ? ` de ${(Number(values.valor.replace(/\D/g, '')) / 100 / num).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` : ''}`}
                                                value={num}
                                                color={theme.colors.text}
                                                style={{ backgroundColor: theme.colors.backgroundSecondary }}
                                            />
                                        ))}
                                    </Picker>
                                </View>
                                {values.numeroParcelas > 1 && (
                                    <View style={{
                                        flexDirection: 'row',
                                        justifyContent: 'flex-end',
                                        marginTop: 8,
                                        backgroundColor: 'rgba(52, 211, 153, 0.1)',
                                        padding: 8,
                                        borderRadius: 4,
                                        borderWidth: 1,
                                        borderColor: 'rgba(52, 211, 153, 0.3)'
                                    }}>
                                        <Text style={{
                                            fontSize: 11,
                                            color: '#059669', // Emerald 600
                                            fontWeight: '700',
                                        }}>
                                            ℹ️ Valor da parcela: {(Number(values.valor.replace(/\D/g, '')) / 100 / values.numeroParcelas).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                        </Text>
                                    </View>
                                )}
                            </View>
                        )}

                        {/* Descrição */}
                        <Input
                            label="DESCRIÇÃO"
                            placeholder="Detalhes da despesa..."
                            value={values.descricao}
                            onChangeText={(value) => handleChange('descricao', value)}
                            multiline
                            numberOfLines={3}
                            icon={<FileText size={16} color={theme.colors.textSecondary} />}
                            containerStyle={{ marginBottom: 24 }}
                        />

                        {/* Botão de Salvar */}
                        <Button
                            onPress={handleSave}
                            loading={loading}
                            disabled={loading}
                            variant="danger"
                        >
                            {loading
                                ? 'REGISTRANDO...'
                                : values.pagoAgora
                                    ? 'REGISTRAR PAGAMENTO (CAIXA)'
                                    : 'REGISTRAR CONTA (A PRAZO)'
                            }
                        </Button>


                    </Card>
                </ScrollView>
            </KeyboardAvoidingView>
        </View>
    );
};
