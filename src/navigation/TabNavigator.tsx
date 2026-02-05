import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, Text } from 'react-native';
import { Home, FileText, DollarSign, Users, User, TrendingDown } from 'lucide-react-native';
import { theme } from '../theme';
import { DashboardScreen } from '../screens/DashboardScreen';
import { OSListScreen } from '../screens/OSListScreen';
import { MyCommissionsScreen } from '../screens/MyCommissionsScreen';
import { ClientesScreen } from '../screens/ClientesScreen';
import { LancamentoScreen } from '../screens/LancamentoScreen';

const Tab = createBottomTabNavigator();

interface TabIconProps {
    focused: boolean;
    icon: React.ReactNode;
    label: string;
}

const TabIcon: React.FC<TabIconProps> = ({ focused, icon, label }) => (
    <View style={{ alignItems: 'center', justifyContent: 'center', paddingTop: 8 }}>
        {icon}
        <Text
            style={{
                fontSize: 9,
                marginTop: 4,
                fontWeight: focused ? '700' : '500',
                color: focused ? theme.colors.primary : theme.colors.textMuted,
                letterSpacing: 0.5,
            }}
        >
            {label}
        </Text>
    </View>
);

import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const TabNavigator = () => {
    const insets = useSafeAreaInsets();

    return (
        <Tab.Navigator
            screenOptions={{
                headerShown: false,
                tabBarShowLabel: false,
                tabBarStyle: {
                    backgroundColor: theme.colors.backgroundSecondary,
                    borderTopWidth: 1,
                    borderTopColor: theme.colors.border,
                    height: 65 + Math.max(insets.bottom, 20),
                    paddingBottom: Math.max(insets.bottom, 20),
                    paddingTop: 8,
                },
                tabBarActiveTintColor: theme.colors.primary,
                tabBarInactiveTintColor: theme.colors.textMuted,
            }}
        >
            <Tab.Screen
                name="Dashboard"
                component={DashboardScreen}
                options={{
                    tabBarIcon: ({ focused }) => (
                        <TabIcon
                            focused={focused}
                            icon={<Home size={22} color={focused ? theme.colors.primary : theme.colors.textMuted} />}
                            label="INÍCIO"
                        />
                    ),
                }}
            />
            <Tab.Screen
                name="OSList"
                component={OSListScreen}
                options={{
                    tabBarIcon: ({ focused }) => (
                        <TabIcon
                            focused={focused}
                            icon={<FileText size={22} color={focused ? theme.colors.primary : theme.colors.textMuted} />}
                            label="OS"
                        />
                    ),
                }}
            />

            <Tab.Screen
                name="Clientes"
                component={ClientesScreen}
                options={{
                    tabBarIcon: ({ focused }) => (
                        <TabIcon
                            focused={focused}
                            icon={<Users size={22} color={focused ? theme.colors.primary : theme.colors.textMuted} />}
                            label="CLIENTES"
                        />
                    ),
                }}
            />
            <Tab.Screen
                name="Lancamento"
                component={LancamentoScreen}
                options={{
                    tabBarIcon: ({ focused }) => (
                        <TabIcon
                            focused={focused}
                            icon={<TrendingDown size={22} color={focused ? theme.colors.primary : theme.colors.textMuted} />}
                            label="DESPESAS"
                        />
                    ),
                }}
            />
            <Tab.Screen
                name="MyCommissions"
                component={MyCommissionsScreen}
                options={{
                    tabBarIcon: ({ focused }) => (
                        <TabIcon
                            focused={focused}
                            icon={<DollarSign size={22} color={focused ? theme.colors.primary : theme.colors.textMuted} />}
                            label="COMISSÕES"
                        />
                    ),
                }}
            />
        </Tab.Navigator>
    );
};
