import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space } from '../theme';
import { Header, Card, Field, GradientButton } from '../components/UI';
import { videoPitch } from '../api';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+\s\-()]{7,20}$/;
const MAX_SECONDS = 90;

export default function VideoPitchScreen() {
  const [form, setForm] = useState({ name: '', email: '', phone: '', role: '' });
  const [clip, setClip] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');
  const [done, setDone] = useState(false);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  async function record() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return setErr('Camera permission is needed to record your pitch.');
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['videos'], videoMaxDuration: MAX_SECONDS, quality: 0.7 });
    if (!res.canceled && res.assets?.[0]) { setClip(res.assets[0]); setErr(''); }
  }
  async function upload() {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], quality: 0.7 });
    if (!res.canceled && res.assets?.[0]) { setClip(res.assets[0]); setErr(''); }
  }
  async function submit() {
    setErr('');
    if (!form.name.trim())          return setErr('Please enter your name.');
    if (!PHONE_RE.test(form.phone)) return setErr('Please enter a valid WhatsApp number.');
    if (!EMAIL_RE.test(form.email)) return setErr('Please enter a valid email.');
    if (!clip)                      return setErr('Please record or upload a short video.');
    setBusy(true);
    try {
      await videoPitch({ file: clip, name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim(), targetRole: form.role.trim() });
      setDone(true);
    } catch (e) { setErr('Upload failed: ' + e.message); }
    finally { setBusy(false); }
  }

  if (done) {
    return (
      <View style={s.screen}><Header />
        <View style={s.center}>
          <Ionicons name="checkmark-circle" size={64} color={colors.green} />
          <Text style={s.h2}>Pitch received!</Text>
          <Text style={[s.sub, { textAlign: 'center' }]}>A coach will review it and WhatsApp you interview-prep feedback.</Text>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <Header />
      <View style={s.body}>
        <Text style={s.h2}>Interview coaching</Text>
        <Text style={s.sub}>Record a 60-second pitch. A coach reviews it and sends you feedback.</Text>

        <Card style={{ marginTop: 16 }}>
          <Field label="FULL NAME" value={form.name} onChangeText={set('name')} placeholder="Your name" />
          <Field label="EMAIL" value={form.email} onChangeText={set('email')} placeholder="you@email.com" keyboardType="email-address" autoCapitalize="none" />
          <Field label="WHATSAPP NUMBER" value={form.phone} onChangeText={set('phone')} placeholder="+91…" keyboardType="phone-pad" />
          <Field label="TARGET ROLE (OPTIONAL)" value={form.role} onChangeText={set('role')} placeholder="e.g. Product Manager" />

          <View style={s.btnRow}>
            <GradientButton title="🎥 Record" variant="ghost" onPress={record} style={{ flex: 1 }} />
            <GradientButton title="📁 Upload" variant="ghost" onPress={upload} style={{ flex: 1 }} />
          </View>
          {!!clip && (
            <View style={s.clip}>
              <Ionicons name="checkmark-circle" size={16} color={colors.green} />
              <Text style={s.clipTxt}>Clip ready{clip.duration ? ` · ${Math.round(clip.duration / 1000)}s` : ''}</Text>
            </View>
          )}
          {!!err && <Text style={s.err}>{err}</Text>}
          <GradientButton title="Submit pitch →" loading={busy} onPress={submit} style={{ marginTop: 14 }} />
        </Card>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { paddingHorizontal: space.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30, gap: 10 },
  h2: { color: colors.white, fontSize: 24, fontWeight: '800', marginTop: 8 },
  sub: { color: colors.muted, fontSize: 13.5, lineHeight: 20, marginTop: 6 },
  btnRow: { flexDirection: 'row', gap: 12, marginTop: 4 },
  clip: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 14 },
  clipTxt: { color: colors.green, fontWeight: '700', fontSize: 13 },
  err: { color: colors.red, fontSize: 13, marginTop: 12 },
});
