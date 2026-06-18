import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space, severityColor } from '../theme';
import { Header, AIBadge, Card, Field, GradientButton, Pill } from '../components/UI';
import { atsScore } from '../api';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+\s\-()]{7,20}$/;

export default function AtsScanScreen({ navigation }) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', role: '' });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');
  const [result, setResult] = useState(null);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  async function pickPdf() {
    const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
    if (!res.canceled && res.assets?.[0]) { setFile(res.assets[0]); setErr(''); }
  }

  async function run() {
    setErr('');
    if (!form.name.trim())          return setErr('Please enter your name.');
    if (!PHONE_RE.test(form.phone)) return setErr('Please enter a valid WhatsApp number.');
    if (!EMAIL_RE.test(form.email)) return setErr('Please enter a valid email.');
    if (!file)                      return setErr('Please attach your resume PDF.');
    setBusy(true);
    try {
      setResult(await atsScore({ file, name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim(), targetRole: form.role.trim() }));
    } catch (e) { setErr('Scan failed: ' + e.message); }
    finally { setBusy(false); }
  }

  if (result) return <Result d={result} onReset={() => { setResult(null); setFile(null); }} navigation={navigation} />;

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <Header ai />
      <View style={s.body}>
        <Text style={s.h2}>AI ATS Scan</Text>
        <Text style={s.sub}>Free · instant. See exactly why bots reject your resume — and how to fix it.</Text>

        <Card style={{ marginTop: 18 }}>
          <Field label="FULL NAME" value={form.name} onChangeText={set('name')} placeholder="Your name" />
          <Field label="EMAIL" value={form.email} onChangeText={set('email')} placeholder="you@email.com" keyboardType="email-address" autoCapitalize="none" />
          <Field label="WHATSAPP NUMBER" value={form.phone} onChangeText={set('phone')} placeholder="+91…" keyboardType="phone-pad" />
          <Field label="TARGET ROLE (OPTIONAL)" value={form.role} onChangeText={set('role')} placeholder="e.g. Backend Engineer" />

          <Pressable style={[s.file, file && s.fileOn]} onPress={pickPdf}>
            <Ionicons name={file ? 'document-text' : 'cloud-upload-outline'} size={22} color={file ? colors.gold : colors.muted} />
            <Text style={s.fileTxt} numberOfLines={1}>{file ? file.name : 'Tap to attach resume (PDF)'}</Text>
          </Pressable>

          {!!err && <Text style={s.err}>{err}</Text>}
          <GradientButton title="Analyze with AI →" variant="ai" loading={busy} onPress={run} style={{ marginTop: 4 }} />
        </Card>
      </View>
    </ScrollView>
  );
}

function Result({ d, onReset, navigation }) {
  const score = Math.max(0, Math.min(100, d.score || 0));
  const c = score >= 80 ? colors.green : score >= 60 ? colors.gold : colors.red;
  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
      <Header ai />
      <View style={s.body}>
        <Card glow style={{ alignItems: 'center' }}>
          <AIBadge label="ATS REPORT" />
          <Text style={[s.score, { color: c }]}>{score}</Text>
          <Text style={s.scoreOf}>out of 100 · Grade {d.grade || '–'}</Text>
          {!!d.keywordMatch && <Pill color={colors.gold}>{d.keywordMatch.percent}% keyword match</Pill>}
        </Card>

        {Array.isArray(d.issues) && d.issues.length > 0 && (
          <Card style={{ marginTop: 14 }}>
            <Text style={s.cardTitle}>What's holding you back</Text>
            {d.issues.map((it, i) => (
              <View key={i} style={s.issueRow}>
                <View style={[s.dot, { backgroundColor: severityColor[it.severity] || colors.muted }]} />
                <Text style={s.issueMsg}>{it.message}</Text>
              </View>
            ))}
          </Card>
        )}

        {Array.isArray(d.strengths) && d.strengths.length > 0 && (
          <Card style={{ marginTop: 14 }}>
            <Text style={[s.cardTitle, { color: colors.green }]}>What's working</Text>
            {d.strengths.map((str, i) => (
              <View key={i} style={s.issueRow}>
                <Ionicons name="checkmark-circle" size={16} color={colors.green} style={{ marginRight: 8, marginTop: 1 }} />
                <Text style={s.issueMsg}>{str}</Text>
              </View>
            ))}
          </Card>
        )}

        <Card style={{ marginTop: 14 }}>
          <Text style={s.cardTitle}>Get every issue fixed for you</Text>
          <Text style={s.sub}>Our writers turn this into a recruiter-ready resume in 24–72h, ₹999 onwards.</Text>
          <GradientButton title="See packages →" onPress={() => navigation.navigate('Plans')} style={{ marginTop: 14 }} />
          <GradientButton title="Scan another resume" variant="ghost" onPress={onReset} style={{ marginTop: 10 }} />
        </Card>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { paddingHorizontal: space.lg },
  h2: { color: colors.white, fontSize: 24, fontWeight: '800' },
  sub: { color: colors.muted, fontSize: 13.5, lineHeight: 20, marginTop: 6 },
  file: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.bg2, borderColor: colors.borderGold, borderWidth: 1, borderStyle: 'dashed', borderRadius: radius.md, padding: 16, marginBottom: 14, marginTop: 4 },
  fileOn: { borderStyle: 'solid' },
  fileTxt: { color: colors.text, fontSize: 14, flex: 1 },
  tapHint: { height: 0 },
  err: { color: colors.red, fontSize: 13, marginBottom: 10 },
  score: { fontSize: 78, fontWeight: '900', lineHeight: 84, marginTop: 12 },
  scoreOf: { color: colors.muted, fontSize: 14, marginBottom: 12 },
  cardTitle: { color: colors.white, fontSize: 16, fontWeight: '700', marginBottom: 12 },
  issueRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6, marginRight: 10 },
  issueMsg: { color: colors.text, fontSize: 13.5, flex: 1, lineHeight: 20 },
});
