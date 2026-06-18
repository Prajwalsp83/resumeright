import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, ActivityIndicator, StyleSheet } from 'react-native';
import { colors } from '../theme';
import { createOrder, verifyPayment } from '../api';

// react-native-razorpay is a NATIVE module — it works in an EAS dev/production
// build, NOT in Expo Go. We require it lazily so Expo Go doesn't crash on import;
// if it's unavailable we fall back to routing the buyer to Contact.
let RazorpayCheckout = null;
try { RazorpayCheckout = require('react-native-razorpay').default; } catch (_e) { /* Expo Go */ }

// Display catalog. Price is shown for UX only — the SERVER decides what to charge
// from packageId (mirrors the web PACKAGES catalog). Keep ids in sync with backend.
const PACKAGES = [
  { id: 'resume-basic',      label: 'ATS Resume Basic',          price: '₹999' },
  { id: 'resume-pro',        label: 'ATS Resume Professional',   price: '₹1,999' },
  { id: 'resume-premium',    label: 'ATS Resume Premium',        price: '₹3,499' },
  { id: 'naukri-setup',      label: 'Naukri One-Time Setup',     price: '₹799' },
  { id: 'naukri-power',      label: 'Naukri 3-Month Power Plan', price: '₹3,999' },
  { id: 'linkedin-makeover', label: 'LinkedIn Profile Makeover', price: '₹999' },
  { id: 'linkedin-growth',   label: 'LinkedIn Growth Package',   price: '₹2,499' },
  { id: 'bundle-starter',    label: 'Starter Bundle',            price: '₹1,999' },
  { id: 'bundle-pro',        label: 'Pro Bundle',                price: '₹4,999' },
  { id: 'bundle-elite',      label: 'Elite Bundle',              price: '₹9,999' },
];

export default function PackagesScreen({ navigation }) {
  const [name, setName]   = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [busyId, setBusyId] = useState(null);

  async function buy(pkg) {
    if (!name.trim() || !email.trim() || !phone.trim()) {
      return Alert.alert('Almost there', 'Please fill name, email and WhatsApp number first.');
    }
    if (!RazorpayCheckout) {
      return Alert.alert(
        'Checkout unavailable in preview',
        'Razorpay needs a full build (EAS), not Expo Go. We\'ll connect you on WhatsApp instead.',
        [{ text: 'OK', onPress: () => navigation.navigate('Contact') }],
      );
    }
    setBusyId(pkg.id);
    try {
      const order = await createOrder({ packageId: pkg.id, name: name.trim(), email: email.trim(), phone: phone.trim() });
      const result = await RazorpayCheckout.open({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: 'ResumeRight',
        description: pkg.label,
        prefill: { name: name.trim(), email: email.trim(), contact: phone.trim() },
        theme: { color: colors.gold },
      });
      await verifyPayment({
        orderId: result.razorpay_order_id,
        paymentId: result.razorpay_payment_id,
        signature: result.razorpay_signature,
        leadId: order.leadId,
      });
      Alert.alert('Payment successful ✅', 'We\'ll reach out on WhatsApp within 2 hours.');
    } catch (e) {
      // Razorpay throws { code, description } on cancel/failure.
      const msg = e?.description || e?.message || 'Payment was cancelled.';
      Alert.alert('Checkout', msg);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Text style={s.h2}>Pick your package</Text>
      <Text style={s.sub}>Pay securely via UPI / cards. 7-day refund window.</Text>

      <TextInput style={s.input} placeholder="Full name" placeholderTextColor={colors.muted} value={name} onChangeText={setName} />
      <TextInput style={s.input} placeholder="Email" placeholderTextColor={colors.muted} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
      <TextInput style={s.input} placeholder="WhatsApp number" placeholderTextColor={colors.muted} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />

      {PACKAGES.map((p) => (
        <View key={p.id} style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.pkgLabel}>{p.label}</Text>
            <Text style={s.pkgPrice}>{p.price}</Text>
          </View>
          <Pressable style={[s.buy, busyId === p.id && s.disabled]} onPress={() => buy(p)} disabled={!!busyId}>
            {busyId === p.id ? <ActivityIndicator color={colors.navy} /> : <Text style={s.buyTxt}>Buy</Text>}
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.navy },
  content: { padding: 22, paddingBottom: 48 },
  h2: { color: colors.white, fontSize: 22, fontWeight: '800', marginBottom: 6 },
  sub: { color: colors.muted, fontSize: 14, marginBottom: 18 },
  input: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 13, color: colors.white, fontSize: 15, marginBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 16, marginBottom: 10 },
  pkgLabel: { color: colors.white, fontSize: 15, fontWeight: '700' },
  pkgPrice: { color: colors.gold, fontSize: 14, marginTop: 2 },
  buy: { backgroundColor: colors.gold, borderRadius: 50, paddingVertical: 10, paddingHorizontal: 22, minWidth: 70, alignItems: 'center' },
  buyTxt: { color: colors.navy, fontWeight: '800' },
  disabled: { opacity: 0.6 },
});
