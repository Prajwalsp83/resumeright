import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { colors } from '../theme';
import { submitLead } from '../api';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+\s\-()]{7,20}$/;

export default function ContactScreen() {
  const [name, setName]       = useState('');
  const [email, setEmail]     = useState('');
  const [phone, setPhone]     = useState('');
  const [service, setService] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState('');
  const [done, setDone]       = useState(false);

  async function send() {
    setErr('');
    if (!name.trim())          return setErr('Please enter your name.');
    if (!PHONE_RE.test(phone)) return setErr('Please enter a valid WhatsApp number.');
    if (!EMAIL_RE.test(email)) return setErr('Please enter a valid email.');
    setBusy(true);
    try {
      await submitLead({ name: name.trim(), email: email.trim(), phone: phone.trim(), service: service.trim() || 'App enquiry', message: message.trim() });
      setDone(true);
    } catch (e) {
      setErr('Could not send: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <View style={[s.screen, s.center]}>
        <Text style={s.bigCheck}>🙌</Text>
        <Text style={s.h2}>Got it!</Text>
        <Text style={s.sub}>We'll reach out on WhatsApp shortly.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Text style={s.h2}>Tell us your goal</Text>
      <Text style={s.sub}>Share a few details and we'll WhatsApp you with the right plan.</Text>

      <TextInput style={s.input} placeholder="Full name" placeholderTextColor={colors.muted} value={name} onChangeText={setName} />
      <TextInput style={s.input} placeholder="Email" placeholderTextColor={colors.muted} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
      <TextInput style={s.input} placeholder="WhatsApp number" placeholderTextColor={colors.muted} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <TextInput style={s.input} placeholder="Interested in (e.g. Resume, LinkedIn)" placeholderTextColor={colors.muted} value={service} onChangeText={setService} />
      <TextInput style={[s.input, s.area]} placeholder="Anything we should know? (optional)" placeholderTextColor={colors.muted} value={message} onChangeText={setMessage} multiline />

      {!!err && <Text style={s.err}>{err}</Text>}
      <Pressable style={[s.primary, busy && s.disabled]} onPress={send} disabled={busy}>
        {busy ? <ActivityIndicator color={colors.navy} /> : <Text style={s.primaryTxt}>Send →</Text>}
      </Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.navy },
  content: { padding: 22, paddingBottom: 48 },
  center: { alignItems: 'center', justifyContent: 'center', padding: 30 },
  bigCheck: { fontSize: 56, marginBottom: 12 },
  h2: { color: colors.white, fontSize: 22, fontWeight: '800', marginBottom: 6 },
  sub: { color: colors.muted, fontSize: 14, marginBottom: 18, lineHeight: 20 },
  input: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 13, color: colors.white, fontSize: 15, marginBottom: 12 },
  area: { height: 96, textAlignVertical: 'top' },
  err: { color: colors.red, fontSize: 13, marginBottom: 12 },
  primary: { backgroundColor: colors.gold, borderRadius: 50, paddingVertical: 15, alignItems: 'center' },
  primaryTxt: { color: colors.navy, fontWeight: '800', fontSize: 16 },
  disabled: { opacity: 0.6 },
});
