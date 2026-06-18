import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { colors } from '../theme';
import { videoPitch } from '../api';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+\s\-()]{7,20}$/;
const MAX_SECONDS = 90;

export default function VideoPitchScreen() {
  const [name, setName]   = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole]   = useState('');
  const [clip, setClip]   = useState(null);
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState('');
  const [done, setDone]   = useState(false);

  async function record() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return setErr('Camera permission is needed to record your pitch.');
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Videos, videoMaxDuration: MAX_SECONDS, quality: 0.7 });
    if (!res.canceled && res.assets?.[0]) { setClip(res.assets[0]); setErr(''); }
  }

  async function upload() {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Videos, quality: 0.7 });
    if (!res.canceled && res.assets?.[0]) { setClip(res.assets[0]); setErr(''); }
  }

  async function submit() {
    setErr('');
    if (!name.trim())          return setErr('Please enter your name.');
    if (!PHONE_RE.test(phone)) return setErr('Please enter a valid WhatsApp number.');
    if (!EMAIL_RE.test(email)) return setErr('Please enter a valid email.');
    if (!clip)                 return setErr('Please record or upload a short video.');
    setBusy(true);
    try {
      await videoPitch({ file: clip, name: name.trim(), email: email.trim(), phone: phone.trim(), targetRole: role.trim() });
      setDone(true);
    } catch (e) {
      setErr('Upload failed: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <View style={[s.screen, s.center]}>
        <Text style={s.bigCheck}>✅</Text>
        <Text style={s.h2}>Pitch received!</Text>
        <Text style={s.sub}>Our coach will review it and WhatsApp you interview-prep feedback.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Text style={s.h2}>Record a 60-second pitch</Text>
      <Text style={s.sub}>Introduce yourself like you would in an interview. A coach reviews it and sends feedback.</Text>

      <TextInput style={s.input} placeholder="Full name" placeholderTextColor={colors.muted} value={name} onChangeText={setName} />
      <TextInput style={s.input} placeholder="Email" placeholderTextColor={colors.muted} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
      <TextInput style={s.input} placeholder="WhatsApp number" placeholderTextColor={colors.muted} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <TextInput style={s.input} placeholder="Target role (optional)" placeholderTextColor={colors.muted} value={role} onChangeText={setRole} />

      <View style={s.btnRow}>
        <Pressable style={[s.half, s.outline]} onPress={record}><Text style={s.outlineTxt}>🎥 Record</Text></Pressable>
        <Pressable style={[s.half, s.outline]} onPress={upload}><Text style={s.outlineTxt}>📁 Upload</Text></Pressable>
      </View>
      {!!clip && <Text style={s.clip}>✓ Clip ready{clip.duration ? ` · ${Math.round(clip.duration / 1000)}s` : ''}</Text>}
      {!!err && <Text style={s.err}>{err}</Text>}

      <Pressable style={[s.primary, busy && s.disabled]} onPress={submit} disabled={busy}>
        {busy ? <ActivityIndicator color={colors.navy} /> : <Text style={s.primaryTxt}>Submit pitch →</Text>}
      </Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.navy },
  content: { padding: 22, paddingBottom: 48 },
  center: { alignItems: 'center', justifyContent: 'center', padding: 30 },
  bigCheck: { fontSize: 56, marginBottom: 12 },
  h2: { color: colors.white, fontSize: 22, fontWeight: '800', marginBottom: 6, textAlign: 'center' },
  sub: { color: colors.muted, fontSize: 14, marginBottom: 18, textAlign: 'center', lineHeight: 20 },
  input: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 13, color: colors.white, fontSize: 15, marginBottom: 12 },
  btnRow: { flexDirection: 'row', gap: 12, marginTop: 4 },
  half: { flex: 1 },
  outline: { borderColor: colors.border, borderWidth: 1.5, borderRadius: 50, paddingVertical: 14, alignItems: 'center' },
  outlineTxt: { color: colors.white, fontWeight: '700', fontSize: 15 },
  clip: { color: colors.green, marginTop: 12, fontWeight: '600' },
  err: { color: colors.red, fontSize: 13, marginTop: 12 },
  primary: { backgroundColor: colors.gold, borderRadius: 50, paddingVertical: 15, alignItems: 'center', marginTop: 18 },
  primaryTxt: { color: colors.navy, fontWeight: '800', fontSize: 16 },
  disabled: { opacity: 0.6 },
});
