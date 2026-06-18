import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { colors } from './src/theme';
import HomeScreen from './src/screens/HomeScreen';
import AtsScanScreen from './src/screens/AtsScanScreen';
import PackagesScreen from './src/screens/PackagesScreen';
import VideoPitchScreen from './src/screens/VideoPitchScreen';
import ContactScreen from './src/screens/ContactScreen';

const Stack = createNativeStackNavigator();

const navTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: colors.navy, card: colors.navy, text: colors.white, border: colors.border, primary: colors.gold },
};

const screenOptions = {
  headerStyle: { backgroundColor: colors.navy },
  headerTintColor: colors.gold,
  headerTitleStyle: { color: colors.white, fontWeight: '700' },
  contentStyle: { backgroundColor: colors.navy },
};

export default function App() {
  return (
    <NavigationContainer theme={navTheme}>
      <StatusBar style="light" />
      <Stack.Navigator screenOptions={screenOptions}>
        <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'ResumeRight' }} />
        <Stack.Screen name="AtsScan" component={AtsScanScreen} options={{ title: 'Free ATS Scan' }} />
        <Stack.Screen name="Packages" component={PackagesScreen} options={{ title: 'Packages' }} />
        <Stack.Screen name="VideoPitch" component={VideoPitchScreen} options={{ title: 'Video Pitch' }} />
        <Stack.Screen name="Contact" component={ContactScreen} options={{ title: 'Talk to us' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
