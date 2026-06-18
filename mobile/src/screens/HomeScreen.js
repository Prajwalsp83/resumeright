import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors, gradients, radius, space, shadow } from '../theme';
import { Header, AIBadge, GradientButton, Card } from '../components/UI';

const FEATURES = [
  { icon: 'scan-outline',        title: 'AI ATS Scan',       desc: 'Score your resume against real ATS rules in seconds.', tab: 'Scan' },
  { icon: 'documents-outline',   title: 'Expert Rewrites',   desc: 'Recruiter-ready resume, Naukri & LinkedIn from ₹799.',  tab: 'Plans' },
  { icon: 'videocam-outline',    title: 'Interview Coaching', desc: 'Record a 60s pitch, get pro feedback.',                tab: 'Coach' },
];

const STATS = [['500+', 'Hired'], ['98%', 'ATS pass'], ['3×', 'Callbacks'], ['4.9★', 'Rating']];

export default function HomeScreen({ navigation }) {
  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
      <Header ai right={<Pressable onPress={() => navigation.navigate('Contact')}><Ionicons name="chatbubble-ellipses-outline" size={22} color={colors.muted} /></Pressable>} />

      {/* Hero */}
      <LinearGradient colors={gradients.hero} style={s.hero}>
        <AIBadge label="AI-POWERED" />
        <Text style={s.h1}>Beat the bots.{'\n'}<Text style={s.gold}>Land the interview.</Text></Text>
        <Text style={s.sub}>75% of resumes are rejected by ATS before a human sees them. Our AI shows you exactly why — and fixes it.</Text>
        <GradientButton title="Scan my resume with AI →" variant="ai" onPress={() => navigation.navigate('Scan')} style={{ marginTop: 18 }} />
        <View style={s.statsRow}>
          {STATS.map(([n, l]) => (
            <View key={l} style={s.stat}><Text style={s.statNum}>{n}</Text><Text style={s.statLabel}>{l}</Text></View>
          ))}
        </View>
      </LinearGradient>

      {/* Features */}
      <View style={{ paddingHorizontal: space.lg }}>
        <Text style={s.sectionTitle}>Everything you need to get hired</Text>
        {FEATURES.map((f) => (
          <Pressable key={f.title} onPress={() => navigation.navigate(f.tab)}>
            <Card style={s.feature}>
              <View style={s.featIcon}><Ionicons name={f.icon} size={22} color={colors.gold} /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.featTitle}>{f.title}</Text>
                <Text style={s.featDesc}>{f.desc}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.faint} />
            </Card>
          </Pressable>
        ))}

        {/* AI deep-scan highlight */}
        <LinearGradient colors={gradients.ai} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.aiCard, shadow.glow]}>
          <Text style={s.aiKicker}>✦ NEW · AI DEEP SCAN</Text>
          <Text style={s.aiTitle}>Line-by-line rewrites, written by AI</Text>
          <Text style={s.aiDesc}>Run the free scan first, then unlock an AI report with prioritised fixes, before/after bullet rewrites and a projected score.</Text>
          <Pressable style={s.aiBtn} onPress={() => navigation.navigate('Scan')}>
            <Text style={s.aiBtnTxt}>Start with a free scan →</Text>
          </Pressable>
        </LinearGradient>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  hero: { margin: space.lg, marginTop: 6, borderRadius: radius.lg, padding: space.lg, borderColor: colors.border, borderWidth: 1 },
  h1: { color: colors.white, fontSize: 32, fontWeight: '800', lineHeight: 38, marginTop: 14 },
  gold: { color: colors.gold },
  sub: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 12 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 22, borderTopColor: colors.border, borderTopWidth: 1, paddingTop: 16 },
  stat: { alignItems: 'center' },
  statNum: { color: colors.gold, fontSize: 19, fontWeight: '800' },
  statLabel: { color: colors.faint, fontSize: 11, marginTop: 2 },
  sectionTitle: { color: colors.white, fontSize: 17, fontWeight: '700', marginBottom: 14 },
  feature: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, paddingVertical: 16 },
  featIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: 'rgba(232,160,32,0.12)', alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  featTitle: { color: colors.white, fontSize: 15, fontWeight: '700' },
  featDesc: { color: colors.muted, fontSize: 12.5, marginTop: 3, lineHeight: 18 },
  aiCard: { borderRadius: radius.lg, padding: space.lg, marginTop: 8 },
  aiKicker: { color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },
  aiTitle: { color: '#fff', fontSize: 20, fontWeight: '800', marginTop: 8 },
  aiDesc: { color: 'rgba(255,255,255,0.9)', fontSize: 13.5, lineHeight: 20, marginTop: 8 },
  aiBtn: { backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: radius.pill, paddingVertical: 13, alignItems: 'center', marginTop: 16 },
  aiBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 14 },
});
