import React from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, gradients, radius, space, shadow } from '../theme';

// Small "✦ AI" pill used to mark AI-powered surfaces.
export function AIBadge({ label = 'AI', style }) {
  return (
    <LinearGradient colors={gradients.ai} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.badge, style]}>
      <Text style={s.badgeTxt}>✦ {label}</Text>
    </LinearGradient>
  );
}

// Branded screen header — logo wordmark + optional AI badge + optional right slot.
export function Header({ ai = false, right }) {
  return (
    <View style={s.header}>
      <Text style={s.logo}>Resume<Text style={s.logoGold}>Right</Text></Text>
      {ai && <AIBadge style={{ marginLeft: 8 }} />}
      <View style={{ flex: 1 }} />
      {right}
    </View>
  );
}

export function Card({ children, style, glow }) {
  return <View style={[s.card, glow && shadow.glow, style]}>{children}</View>;
}

// Gradient pill button. variant: 'gold' (default) | 'ai' | 'ghost'.
export function GradientButton({ title, onPress, variant = 'gold', loading, disabled, style }) {
  if (variant === 'ghost') {
    return (
      <Pressable onPress={onPress} disabled={disabled || loading} style={[s.ghost, (disabled || loading) && s.dim, style]}>
        <Text style={s.ghostTxt}>{title}</Text>
      </Pressable>
    );
  }
  const cols = variant === 'ai' ? gradients.ai : gradients.gold;
  const txtColor = variant === 'ai' ? '#fff' : colors.bg;
  return (
    <Pressable onPress={onPress} disabled={disabled || loading} style={[(disabled || loading) && s.dim, style]}>
      <LinearGradient colors={cols} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.btn}>
        {loading ? <ActivityIndicator color={txtColor} /> : <Text style={[s.btnTxt, { color: txtColor }]}>{title}</Text>}
      </LinearGradient>
    </Pressable>
  );
}

export function Field({ label, ...props }) {
  return (
    <View style={{ marginBottom: space.md }}>
      {!!label && <Text style={s.label}>{label}</Text>}
      <TextInput {...props} placeholderTextColor={colors.faint} style={[s.input, props.multiline && s.area]} />
    </View>
  );
}

export function Pill({ children, color = colors.muted }) {
  return (
    <View style={[s.pill, { backgroundColor: color + '1F', borderColor: color + '55' }]}>
      <Text style={[s.pillTxt, { color }]}>{children}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  badge: { borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3 },
  badgeTxt: { color: '#fff', fontWeight: '800', fontSize: 11, letterSpacing: 0.5 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingTop: 8, paddingBottom: 14 },
  logo: { color: colors.white, fontSize: 20, fontWeight: '800' },
  logoGold: { color: colors.gold },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: space.lg, ...shadow.card },
  btn: { borderRadius: radius.pill, paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  btnTxt: { fontWeight: '800', fontSize: 16 },
  ghost: { borderRadius: radius.pill, paddingVertical: 15, alignItems: 'center', borderWidth: 1.5, borderColor: colors.border },
  ghostTxt: { color: colors.text, fontWeight: '700', fontSize: 15 },
  dim: { opacity: 0.55 },
  label: { color: colors.muted, fontSize: 12, fontWeight: '700', marginBottom: 7, letterSpacing: 0.3 },
  input: { backgroundColor: colors.bg2, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 15, paddingVertical: 14, color: colors.white, fontSize: 15 },
  area: { height: 100, textAlignVertical: 'top' },
  pill: { borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  pillTxt: { fontSize: 11, fontWeight: '700' },
});
