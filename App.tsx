/// <reference types="nativewind/types" />
import 'react-native-get-random-values'; // 🔧 Polyfill para crypto.getRandomValues() (necessário para UUID)
import "./global.css";
import 'react-native-gesture-handler';
import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { AuthProvider, useAuth } from './src/contexts/AuthContext';
import { LoginScreen } from './src/screens/LoginScreen';
import { TabNavigator } from './src/navigation/TabNavigator';
import { OSDetailsScreen } from './src/screens/OSDetailsScreen';
import { CreateOSScreen } from './src/screens/CreateOSScreen';
import { ClientFormScreen } from './src/screens/ClientFormScreen';
import { RootStackParamList } from './src/navigation/types';
import { theme } from './src/theme';
import { NetworkStatusIndicator } from './src/components/NetworkStatusIndicator';
import { Logger } from './src/services/Logger';

const Stack = createStackNavigator<RootStackParamList>();

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return null;
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {user ? (
        <>
          <Stack.Screen name="Main" component={TabNavigator} />
          <Stack.Screen name="OSDetails" component={OSDetailsScreen} />
          <Stack.Screen name="CreateOS" component={CreateOSScreen} />
          <Stack.Screen name="ClientForm" component={ClientFormScreen} />

        </>
      ) : (
        <Stack.Screen name="Login" component={LoginScreen} />
      )}
    </Stack.Navigator>
  );
}

import { databaseService } from './src/services/database/DatabaseService';
import { ActivityIndicator, View } from 'react-native';
import Toast from 'react-native-toast-message';

export default function App() {
  const [dbReady, setDbReady] = React.useState(false);

  React.useEffect(() => {
    async function init() {
      try {
        await databaseService.initialize();

        // 🔧 TEMPORÁRIO: Resetar banco para aplicar migration v2 (uuid)
        // REMOVA APÓS EXECUTAR UMA VEZ!
        console.log('🔧 Verificando se precisa resetar banco...');
        const needsReset = await checkNeedsReset();
        if (needsReset) {
          console.log('🔄 Resetando banco para aplicar migrations...');
          await databaseService.resetDatabase();
          await databaseService.setMetadata('reset_applied', 'true');
        }
      } catch (e) {
        console.error("Erro ao iniciar DB:", e);
      } finally {
        setDbReady(true);
      }
    }

    async function checkNeedsReset() {
      try {
        const resetApplied = await databaseService.getMetadata('reset_applied');
        return !resetApplied; // Se nunca resetou, precisa resetar
      } catch {
        return true; // Em caso de erro, resetar
      }
    }

    init();
  }, []);

  if (!dbReady) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.colors.background }}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer
        onStateChange={(state) => {
          const currentRouteName = state?.routes[state.index].name;
          Logger.info(`Navigation: Navigated to ${currentRouteName}`, state);
        }}
      >
        <AuthProvider>
          <StatusBar style="light" backgroundColor={theme.colors.background} />
          <NetworkStatusIndicator />
          <AppRoutes />
        </AuthProvider>
      </NavigationContainer>
      <Toast />
    </SafeAreaProvider>
  );
}
