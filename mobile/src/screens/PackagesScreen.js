import React, { useState } from 'react';
import { View, Text, ScrollView, Alert, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space } from '../theme';
import { Header, Card, Field, GradientButton, Pill } from '../components/UI';
import { createOrder, verifyPayment } from '../api';

// Native module — works in an EAS build, not Expo Go. Lazy-require so Expo Go
// doesn't crash; the buy flow falls back to Contact when it's unavailable.
let RazorpayCheckout = null;
try { RazorpayCheckout = require('react-native-razorpay').default; } catch (_e) {}

// Display only — the SERVER decides the price from packageId.
const PACKAGES = [
  { id: 'resume-basic',      label: 'ATS Resume Basic',          price: '₹999' },
  { id: 'resume-pro',        label: 'ATS Resume Professional',   price: '₹1,999', popular: true },
  { id: 'resume-premium',    label: 'ATS Resume Premium',        price: '₹3,499' },
  { id: 'naukri-setup',      label: 'Naukri One-Time Setup',     price: '₹799' },
  { id: 'naukri-power',      label: 'Naukri 3-Month Power Plan', price: '₹3,999' },
  { id: 'linkedin-makeover', label: 'LinkedIn Profile Makeover', price: '₹999' },
  { id: 'linkedin-growth',   label: 'LinkedIn Growth Package',   price: '₹2,499' },
  { id: 'bundle-starter',    label: 'Starter Bundle',            price: '₹1,999' },
  { id: 'bundle-pro',        label: 'Pro Bundle',                price: '₹4,999', popular: true },
  { id: 'bundle-elite',      label: 'Elite Bundle',              price: '₹9,999' },
];

export default function PackagesScreen({ navigation }) {
  const [form, setForm] = useState({ name: '', email: '', phone: '' });
  const [busyId, setBusyId] = useState(null);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  async function buy(pkg) {
    if (!form.name.trim() || !form.email.trim() || !form.phone.trim())
      return Alert.alert('Almost there', 'Please fill name, email and WhatsApp number first.');
    if (!RazorpayCheckout)
      return Alert.alert('Checkout needs the full app', 'Payments require the installed build (not the Expo Go preview). We\'ll connect you on WhatsApp.', [{ text: 'OK', onPress: () => navigation.navigate('Contact') }]);
    setBusyId(pkg.id);
    try {
      const order = await createOrder({ packageId: pkg.id, name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim() });
      const r = await RazorpayCheckout.open({ key: order.keyId, order_id: order.orderId, amount: order.amount, currency: order.currency, name: 'ResumeRight', description: pkg.label, prefill: { name: form.name.trim(), email: form.email.trim(), contact: form.phone.trim() }, theme: { color: colors.gold } });
      await verifyPayment({ orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature, leadId: order.leadId });
      Alert.alert('Payment successful ✅', "We'll reach out on WhatsApp within 2 hours.");
    } catch (e) {
      Alert.alert('Checkout', e?.description || e?.message || 'Payment was cancelled.');
    } finally { setBusyId(null); }
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <Header />
      <View style={s.body}>
        <Text style={s.h2}>Pick your package</Text>
        <Text style={s.sub}>Secure UPI / card payment · 7-day refund window.</Text>

        <Card style={{ marginTop: 16, marginBottom: 16 }}>
          <Field label="FULL NAME" value={form.name} onChangeText={set('name')} placeholder="Your name" />
          <Field label="EMAIL" value={form.email} onChangeText={set('email')} placeholder="you@email.com" keyboardType="email-address" autoCapitalize="none" />
          <Field label="WHATSAPP NUMBER" value={form.phone} onChangeText={set('phone')} placeholder="+91…" keyboardType="phone-pad" />
        </Card>

        {PACKAGES.map((p) => (
          <Card key={p.id} style={[s.row, p.popular && s.popular]}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={s.pkgLabel}>{p.label}</Text>
                {p.popular && <Pill color={colors.gold}>Popular</Pill>}
              </View>
              <Text style={s.pkgPrice}>{p.price}</Text>
            </View>
            <GradientButton title={busyId === p.id ? '…' : 'Buy'} loading={busyId === p.id} disabled={!!busyId} onPress={() => buy(p)} style={{ minWidth: 92 }} />
          </Card>
        ))}

        <View style={s.note}>
          <Ionicons name="lock-closed" size={13} color={colors.faint} />
          <Text style={s.noteTxt}>Payments are processed by Razorpay. Price is set server-side.</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { paddingHorizontal: space.lg },
  h2: { color: colors.white, fontSize: 24, fontWeight: '800' },
  sub: { color: colors.muted, fontSize: 13.5, marginTop: 6 },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, paddingVertical: 16 },
  popular: { borderColor: colors.borderGold },
  pkgLabel: { color: colors.white, fontSize: 15, fontWeight: '700' },
  pkgPrice: { color: colors.gold, fontSize: 15, marginTop: 4, fontWeight: '700' },
  note: { flexDirection: 'row', alignItems: 'center', gap: 7, justifyContent: 'center', marginTop: 8 },
  noteTxt: { color: colors.faint, fontSize: 11.5 },
});
