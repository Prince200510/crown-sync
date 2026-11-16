# Crown Sync

Personal Android-to-laptop notification bridge using **React + TypeScript + Vite**, **Capacitor**, **Kotlin**, and **Firebase** (Auth, Firestore, Cloud Messaging, Hosting, and one authenticated Cloud Function).

## Architecture

- **Android Companion (`android/`)**:
  - `CrownSyncNotificationListener` (`NotificationListenerService`) captures posted, updated, and removed notifications for user-selected apps, excluding Crown Sync itself to prevent loops.
  - `CrownSyncCallReceiver` (`BroadcastReceiver` on `PHONE_STATE`) detects cellular ringing and transitions out of ringing (`OFFHOOK` / `IDLE`). Caller identity is optional and defaults to `"Incoming call"` without requiring `READ_CALL_LOG`.
  - `EventRelayClient` sends events directly from native Kotlin to the `relayEvent` Cloud Function, independent of the Capacitor WebView.
  - **Internet calls (WhatsApp, Telegram, etc.)**: Not covered by cellular call-state APIs; enable those apps in the app allowlist to forward their notifications.
- **Backend (`functions/`, `firestore.rules`)**:
  - Single authenticated callable function `relayEvent` verifies Firebase Auth UID and device ownership, validates payloads, drops stale events (>30s for `call_ringing`, >120s for others), deduplicates by `eventId`, enforces call event ordering (`callSeq`), rate-limits per user, and sends data-only Web Push messages via FCM Admin SDK.
  - Notification bodies and call history are **not** stored in Firestore or logged.
- **Laptop Web App (`src/`, `public/firebase-messaging-sw.js`)**:
  - Desktop Chrome/Edge visits the Firebase Hosting URL, signs in, and enables Web Push.
  - `firebase-messaging-sw.js` displays system notifications even when the tab is closed, uses a stable `tag` per call (`call-<callId>`) with `requireInteraction: true`, and closes the notification on `call_ended`.

## Firebase Billing Notice

- **Cloud Functions (v2)** requires upgrading the Firebase project to the **Blaze (pay-as-you-go)** billing plan (Cloud Build / Artifact Registry / Cloud Run).
- Firebase Authentication, Firestore, Hosting, and Cloud Messaging include free usage tiers, but **this setup is not a guaranteed zero-cost/no-card deployment** because of Cloud Functions v2. Set a budget alert in Google Cloud Billing.

## Firebase Console Setup

1. Create a Firebase project in the [Firebase Console](https://console.firebase.google.com/).
2. Upgrade the project to the **Blaze** plan.
3. Enable **Authentication** -> Sign-in providers: **Email/Password** and **Google**.
4. Create a **Firestore Database** in production mode.
5. In **Project Settings -> Cloud Messaging -> Web configuration**, generate a **Web Push certificate (VAPID key)**.
6. Register a **Web App** in Project Settings and copy the config values into `.env` (see `.env.example`).
7. Register an **Android App** (`com.crownsync.app`) in Project Settings, download `google-services.json`, and place it at `android/app/google-services.json`.

## Build & Deploy (Website, Function, Rules)

```bash
# 1. Install dependencies
npm install
npm --prefix functions install

# 2. Build the frontend
npm run build

# 3. Log in and select your Firebase project (one-time)
firebase login
firebase use --add

# 4. Deploy Hosting, Cloud Function, and Firestore Rules in one command
firebase deploy
```

## Build & Install Signed Android APK

1. Sync web assets into Android:
   ```bash
   npx cap sync android
   ```
2. Open `android/` in Android Studio (or use Gradle CLI).
3. Generate a signing keystore (one-time):
   ```bash
   keytool -genkey -v -keystore crown-sync-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias crown-sync
   ```
4. In Android Studio: **Build -> Generate Signed Bundle / APK -> APK**, select `crown-sync-release.jks`, and build `release`.
5. Install on your phone via USB (`adb install app-release.apk`) or transfer the APK and allow installation from unknown sources.

## Reliability & Limitations

- **No guaranteed real-time delivery**: Android Doze mode, OEM battery savers (Xiaomi/Samsung/OnePlus), force-stopping the app, lost internet, laptop sleep, browser shutdown, Do Not Disturb, or corporate firewall/office policies can delay or prevent delivery.
- **On-screen visibility**: `requireInteraction: true` and `call_ended` dismissal are best-effort; OS notification centers (Windows/macOS) may still collapse or retain notifications depending on user settings.

## Real-Device Test Checklist

1. **Ordinary notification**: Lock phone, send a message to an allowlisted app, verify laptop shows `AppName: Title` + body.
2. **Caller identity unavailable**: Call the phone with caller ID hidden/unavailable; verify laptop shows `"Incoming call"`.
3. **Answered / rejected call**: Answer or reject a ringing call on the phone; verify the laptop's `"Incoming call"` notification closes/updates.
4. **Closed website tab**: Close the browser tab (keep browser/OS running), send a test notification or phone notification; verify Web Push still delivers it.
5. **Locked phone (long idle)**: Leave phone locked for 15+ minutes, then trigger a notification to verify Doze/battery exemption behavior.
6. **Reconnect**: Toggle Airplane Mode on the phone off and on, then send a test event.
7. **Expired event**: Send a `call_ringing` payload with a timestamp >35s old; verify `relayEvent` returns `dropped_stale` and no alert appears.
8. **Unauthorized user access**: Attempt to read/write another user's `users/{otherUid}/devices` in Firestore or call `relayEvent` with an unregistered `sourceDeviceId`; verify `permission-denied`.
