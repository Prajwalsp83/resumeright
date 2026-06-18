# ResumeRight — Mobile App (Expo / React Native)

A native iOS + Android app for the ResumeRight funnel. It reuses the **same backend**
as the website (`https://api.resumeright.co.in`) — there are **no backend changes**.
The website (`frontend/`, `backend/`) is unaffected; this lives entirely in `mobile/`.

## Screens (v1)
- **Home** — hero + entry points
- **Free ATS Scan** — pick a PDF → `POST /tools/ats-score` → native score card *(the lead magnet)*
- **Packages** — Razorpay checkout → `POST /payments/order` → `/payments/verify` (server owns the price; app sends only `packageId`)
- **Video Pitch** — record/upload → `POST /tools/video-pitch`
- **Contact** — lead form → `POST /submit`

(Admin stays web-only.)

## Run it on your phone (fastest — preview)
```bash
cd mobile
npm install            # or: npx expo install --fix   (reconciles versions to the Expo SDK)
npx expo start
```
Then open **Expo Go** (App Store / Play Store) and scan the QR code.

> ⚠️ **Two features need a real build, not Expo Go:**
> - **Razorpay checkout** (`react-native-razorpay` is a native module). In Expo Go the Packages screen detects this and routes the buyer to Contact instead.
> - Camera video recording is most reliable in a dev build.
>
> Everything else (ATS scan, contact, lead capture) works in Expo Go.

## Point at a local backend (optional)
```bash
EXPO_PUBLIC_API_URL=http://<your-LAN-ip>:5000 npx expo start
```
Defaults to production (`https://api.resumeright.co.in`) when unset.

## Build installable binaries (EAS — no Xcode/Android Studio needed)
```bash
npm install -g eas-cli
eas login
eas build:configure
# Android test APK:
eas build -p android --profile preview
# Store builds:
eas build -p android --profile production
eas build -p ios --profile production
```

## Ship to the stores
- **Google Play** — one-time ~$25 developer account, then `eas submit -p android`.
- **Apple App Store** — $99/yr Apple Developer account, then `eas submit -p ios`.
- Bundle id / package: `in.co.resumeright.app` (set in `app.json` — change if you prefer).

## TODO before store release
- Add `assets/icon.png` (1024×1024) and a splash image; reference them in `app.json`
  (`expo.icon`, `expo.splash.image`). Currently using Expo defaults.
- A real Razorpay payment requires a production build + your live keys (already returned
  by the backend's `/payments/order`, so nothing to hardcode here).
- Privacy policy URL (you have `frontend/privacy.html`) is required by both stores.
