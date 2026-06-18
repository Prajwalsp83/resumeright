import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';

import { colors } from './src/theme';
import HomeScreen from './src/screens/HomeScreen';
import AtsScanScreen from './src/screens/AtsScanScreen';
import PackagesScreen from './src/screens/PackagesScreen';
import VideoPitchScreen from './src/screens/VideoPitchScreen';
import ContactScreen from './src/screens/ContactScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const navTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: colors.bg, card: colors.bg, text: colors.text, border: colors.border, primary: colors.gold },
};

const ICONS = {
  Home: 'sparkles',
  Scan: 'scan',
  Plans: 'pricetags',
  Coach: 'videocam',
};

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.gold,
        tabBarInactiveTintColor: colors.faint,
        tabBarStyle: { backgroundColor: colors.bg2, borderTopColor: colors.border, height: 86, paddingTop: 8, paddingBottom: 28 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarIcon: ({ color, size }) => <Ionicons name={ICONS[route.name] || 'ellipse'} size={size} color={color} />,
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Scan" component={AtsScanScreen} options={{ title: 'AI Scan' }} />
      <Tab.Screen name="Plans" component={PackagesScreen} />
      <Tab.Screen name="Coach" component={VideoPitchScreen} options={{ title: 'Coaching' }} />
    </Tab.Navigator>
  );
}

export default function App() {
  return (
    <NavigationContainer theme={navTheme}>
      <StatusBar style="light" />
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg }, headerTintColor: colors.gold,
          headerTitleStyle: { color: colors.white, fontWeight: '700' }, contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="Main" component={Tabs} options={{ headerShown: false }} />
        <Stack.Screen name="Contact" component={ContactScreen} options={{ title: 'Talk to us' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
