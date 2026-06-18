import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, space } from '../theme';
import { Card, Field, GradientButton } from '../components/UI';
import { submitLead } from '../api';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+\s\-()]{7,20}$/;

export default function ContactScreen() {
  const [form, setForm] = useState({ name: '', email: '', phone: '', service: '', message: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');
  const [done, setDone] = useState(false);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  async function send() {
    setErr('');
    if (!form.name.trim())          return setErr('Please enter your name.');
    if (!PHONE_RE.test(form.phone)) return setErr('Please enter a valid WhatsApp number.');
    if (!EMAIL_RE.test(form.email)) return setErr('Please enter a valid email.');
    setBusy(true);
    try {
      await submitLead({ name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim(), service: form.service.trim() || 'App enquiry', message: form.message.trim() });
      setDone(true);
    } catch (e) { setErr('Could not send: ' + e.message); }
    finally { setBusy(false); }
  }

  if (done) {
    return (
      <View style={s.center}>
        <Ionicons name="hand-right" size={60} color={colors.gold} />
        <Text style={s.h2}>Got it!</Text>
        <Text style={s.sub}>We'll reach out on WhatsApp shortly.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ padding: space.lg, paddingBottom: 32 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <Text style={s.h2}>Tell us your goal</Text>
      <Text style={s.sub}>Share a few details and we'll WhatsApp you the right plan.</Text>
      <Card style={{ marginTop: 16 }}>
        <Field label="FULL NAME" value={form.name} onChangeText={set('name')} placeholder="Your name" />
        <Field label="EMAIL" value={form.email} onChangeText={set('email')} placeholder="you@email.com" keyboardType="email-address" autoCapitalize="none" />
        <Field label="WHATSAPP NUMBER" value={form.phone} onChangeText={set('phone')} placeholder="+91…" keyboardType="phone-pad" />
        <Field label="INTERESTED IN" value={form.service} onChangeText={set('service')} placeholder="e.g. Resume, LinkedIn" />
        <Field label="MESSAGE (OPTIONAL)" value={form.message} onChangeText={set('message')} placeholder="Anything we should know?" multiline />
        {!!err && <Text style={s.err}>{err}</Text>}
        <GradientButton title="Send →" loading={busy} onPress={send} />
      </Card>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 30, gap: 10 },
  h2: { color: colors.white, fontSize: 24, fontWeight: '800' },
  sub: { color: colors.muted, fontSize: 13.5, lineHeight: 20, marginTop: 6, textAlign: 'center' },
  err: { color: colors.red, fontSize: 13, marginBottom: 12 },
});
