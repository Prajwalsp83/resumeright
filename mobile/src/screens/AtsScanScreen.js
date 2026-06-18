import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { colors, severityColor } from '../theme';
import { atsScore } from '../api';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+\s\-()]{7,20}$/;

export default function AtsScanScreen() {
  const [name, setName]   = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole]   = useState('');
  const [file, setFile]   = useState(null);
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState('');
  const [result, setResult] = useState(null);

  async function pickPdf() {
    const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
    if (!res.canceled && res.assets?.[0]) setFile(res.assets[0]);
  }

  async function run() {
    setErr('');
    if (!name.trim())            return setErr('Please enter your name.');
    if (!PHONE_RE.test(phone))   return setErr('Please enter a valid WhatsApp number.');
    if (!EMAIL_RE.test(email))   return setErr('Please enter a valid email.');
    if (!file)                   return setErr('Please attach your resume PDF.');
    setBusy(true);
    try {
      const d = await atsScore({ file, name: name.trim(), email: email.trim(), phone: phone.trim(), targetRole: role.trim() });
      setResult(d);
    } catch (e) {
      setErr('Scan failed: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  if (result) return <ResultCard d={result} onReset={() => { setResult(null); setFile(null); }} />;

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Text style={s.h2}>Scan your resume against <Text style={s.gold}>real ATS rules</Text></Text>
      <Text style={s.sub}>Free · instant · no credit card. We'll WhatsApp you the fixes.</Text>

      <Field label="Full name" value={name} onChangeText={setName} placeholder="Your name" />
      <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@email.com" keyboardType="email-address" autoCapitalize="none" />
      <Field label="WhatsApp number" value={phone} onChangeText={setPhone} placeholder="+91…" keyboardType="phone-pad" />
      <Field label="Target role (optional)" value={role} onChangeText={setRole} placeholder="e.g. Backend Engineer" />

      <Pressable style={s.file} onPress={pickPdf}>
        <Text style={s.fileTxt}>{file ? `📄 ${file.name}` : 'Tap to attach your resume (PDF)'}</Text>
      </Pressable>

      {!!err && <Text style={s.err}>{err}</Text>}

      <Pressable style={[s.primary, busy && s.disabled]} onPress={run} disabled={busy}>
        {busy ? <ActivityIndicator color={colors.navy} /> : <Text style={s.primaryTxt}>Scan My Resume →</Text>}
      </Pressable>
    </ScrollView>
  );
}

function ResultCard({ d, onReset }) {
  const score = Math.max(0, Math.min(100, d.score || 0));
  const grade = d.grade || '–';
  const scoreColor = score >= 80 ? colors.green : score >= 60 ? colors.gold : colors.red;
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <View style={s.scoreWrap}>
        <Text style={[s.score, { color: scoreColor }]}>{score}</Text>
        <Text style={s.scoreOf}>/ 100 · Grade {grade}</Text>
      </View>
      {!!d.keywordMatch && (
        <Text style={s.kw}>{d.keywordMatch.percent}% keyword match — {d.keywordMatch.matched}/{d.keywordMatch.total} found</Text>
      )}

      {Array.isArray(d.issues) && d.issues.length > 0 && (
        <>
          <Text style={s.listTitle}>What's holding you back</Text>
          {d.issues.map((it, i) => (
            <View key={i} style={s.issueRow}>
              <View style={[s.tag, { backgroundColor: (severityColor[it.severity] || colors.muted) + '22' }]}>
                <Text style={[s.tagTxt, { color: severityColor[it.severity] || colors.muted }]}>{it.severity}</Text>
              </View>
              <Text style={s.issueMsg}>{it.message}</Text>
            </View>
          ))}
        </>
      )}

      {Array.isArray(d.strengths) && d.strengths.length > 0 && (
        <>
          <Text style={[s.listTitle, { color: colors.green }]}>What's working</Text>
          {d.strengths.map((str, i) => <Text key={i} style={s.strength}>✓ {str}</Text>)}
        </>
      )}

      <View style={s.ctaBox}>
        <Text style={s.ctaH}>Want us to fix every issue for you?</Text>
        <Text style={s.ctaP}>Our writers turn this into a recruiter-ready resume in 24–72h, ₹999 onwards.</Text>
      </View>
      <Pressable style={s.outline} onPress={onReset}>
        <Text style={s.outlineTxt}>Scan another resume</Text>
      </Pressable>
    </ScrollView>
  );
}

function Field(props) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={s.label}>{props.label}</Text>
      <TextInput
        {...props}
        style={s.input}
        placeholderTextColor={colors.muted}
      />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.navy },
  content: { padding: 22, paddingBottom: 48 },
  h2: { color: colors.white, fontSize: 22, fontWeight: '800', marginBottom: 6 },
  gold: { color: colors.gold },
  sub: { color: colors.muted, fontSize: 14, marginBottom: 20 },
  label: { color: colors.muted, fontSize: 12, fontWeight: '600', marginBottom: 6 },
  input: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 13, color: colors.white, fontSize: 15 },
  file: { backgroundColor: colors.card, borderColor: colors.gold, borderWidth: 1, borderStyle: 'dashed', borderRadius: 12, padding: 18, alignItems: 'center', marginTop: 6, marginBottom: 14 },
  fileTxt: { color: colors.white, fontSize: 14 },
  err: { color: colors.red, fontSize: 13, marginBottom: 12 },
  primary: { backgroundColor: colors.gold, borderRadius: 50, paddingVertical: 15, alignItems: 'center' },
  primaryTxt: { color: colors.navy, fontWeight: '800', fontSize: 16 },
  disabled: { opacity: 0.6 },
  scoreWrap: { alignItems: 'center', marginVertical: 18 },
  score: { fontSize: 72, fontWeight: '800', lineHeight: 78 },
  scoreOf: { color: colors.muted, fontSize: 15 },
  kw: { color: colors.gold2, textAlign: 'center', marginBottom: 12, fontWeight: '600' },
  listTitle: { color: colors.red, fontSize: 15, fontWeight: '700', marginTop: 18, marginBottom: 10 },
  issueRow: { flexDirection: 'row', marginBottom: 12, alignItems: 'flex-start' },
  tag: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, marginRight: 10 },
  tagTxt: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  issueMsg: { color: colors.white, fontSize: 13, flex: 1, lineHeight: 19 },
  strength: { color: colors.muted, fontSize: 13, marginBottom: 8, lineHeight: 19 },
  ctaBox: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 16, padding: 18, marginTop: 24, marginBottom: 12 },
  ctaH: { color: colors.white, fontSize: 16, fontWeight: '700', marginBottom: 6 },
  ctaP: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  outline: { borderColor: colors.border, borderWidth: 1.5, borderRadius: 50, paddingVertical: 14, alignItems: 'center' },
  outlineTxt: { color: colors.white, fontWeight: '700', fontSize: 15 },
});
