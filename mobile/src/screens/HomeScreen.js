import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { colors } from '../theme';

const STATS = [
  ['500+', 'Clients placed'],
  ['98%', 'ATS pass rate'],
  ['3×', 'More callbacks'],
  ['4.9★', 'Average rating'],
];

export default function HomeScreen({ navigation }) {
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Text style={s.badge}>India's #1 Career Services Platform · 500+ hired</Text>
      <Text style={s.h1}>Don't Wait For Luck. <Text style={s.gold}>Create Your Shot.</Text></Text>
      <Text style={s.sub}>
        75% of resumes are rejected by ATS bots before a human sees them. Fix yours in 24 hours,
        or your money back.
      </Text>

      <Pressable style={s.primary} onPress={() => navigation.navigate('AtsScan')}>
        <Text style={s.primaryTxt}>Get My Free ATS Scan →</Text>
      </Pressable>
      <Pressable style={s.outline} onPress={() => navigation.navigate('VideoPitch')}>
        <Text style={s.outlineTxt}>🎥 Get Interview Coaching</Text>
      </Pressable>

      <View style={s.statsRow}>
        {STATS.map(([n, l]) => (
          <View key={l} style={s.stat}>
            <Text style={s.statNum}>{n}</Text>
            <Text style={s.statLabel}>{l}</Text>
          </View>
        ))}
      </View>

      <View style={s.divider} />

      <Text style={s.sectionTitle}>What we do</Text>
      <Tile title="Free ATS Scan" desc="Score your resume against real ATS rules in 30 seconds." onPress={() => navigation.navigate('AtsScan')} />
      <Tile title="Resume / Naukri / LinkedIn packages" desc="Recruiter-ready rewrites from ₹799." onPress={() => navigation.navigate('Packages')} />
      <Tile title="Video pitch coaching" desc="Record a 60s pitch, get expert interview feedback." onPress={() => navigation.navigate('VideoPitch')} />
      <Tile title="Talk to us" desc="Tell us your goal — we reach out on WhatsApp." onPress={() => navigation.navigate('Contact')} />
    </ScrollView>
  );
}

function Tile({ title, desc, onPress }) {
  return (
    <Pressable style={s.tile} onPress={onPress}>
      <Text style={s.tileTitle}>{title}</Text>
      <Text style={s.tileDesc}>{desc}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.navy },
  content: { padding: 22, paddingBottom: 48 },
  badge: { color: colors.gold, fontSize: 12, fontWeight: '700', marginBottom: 14 },
  h1: { color: colors.white, fontSize: 34, fontWeight: '800', lineHeight: 40, marginBottom: 12 },
  gold: { color: colors.gold },
  sub: { color: colors.muted, fontSize: 15, lineHeight: 22, marginBottom: 22 },
  primary: { backgroundColor: colors.gold, borderRadius: 50, paddingVertical: 15, alignItems: 'center', marginBottom: 12 },
  primaryTxt: { color: colors.navy, fontWeight: '800', fontSize: 16 },
  outline: { borderColor: colors.border, borderWidth: 1.5, borderRadius: 50, paddingVertical: 14, alignItems: 'center' },
  outlineTxt: { color: colors.white, fontWeight: '700', fontSize: 15 },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 28 },
  stat: { width: '48%', marginBottom: 16 },
  statNum: { color: colors.gold, fontSize: 26, fontWeight: '800' },
  statLabel: { color: colors.muted, fontSize: 12 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 22 },
  sectionTitle: { color: colors.white, fontSize: 18, fontWeight: '700', marginBottom: 14 },
  tile: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 16, padding: 18, marginBottom: 12 },
  tileTitle: { color: colors.white, fontSize: 16, fontWeight: '700', marginBottom: 4 },
  tileDesc: { color: colors.muted, fontSize: 13, lineHeight: 19 },
});
