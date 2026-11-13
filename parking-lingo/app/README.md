# Parking Lingo — iPhone app

Expo SDK 58 (React Native 0.88, React 19.3, expo-router 58), TypeScript, iPhone-first. Point the
camera at a parking sign → the server reads it into a `SignReading` → the app evaluates it locally
with `@parking-lingo/core` and shows the answer at a glance.

## Run

```sh
cd parking-lingo && npm install          # workspace install (app + core + server)
cd app
cp .env.example .env                     # optional: EXPO_PUBLIC_API_URL / EXPO_PUBLIC_APP_TOKEN
npx expo start                           # then press i (iOS simulator, macOS) or scan the QR in Expo Go
npx expo start --web                     # browser preview (no live camera: photo picker + demo signs)
```

- **iPhone via Expo Go:** every native module used (camera, image picker/manipulator, notifications,
  haptics, localization, AsyncStorage) ships in Expo Go for SDK 58. Use your computer's LAN IP in
  `EXPO_PUBLIC_API_URL` (e.g. `http://192.168.1.20:8787`), not `localhost`.
- **Dev/production build:** `npx expo run:ios` (macOS + Xcode) or `npx eas-cli@latest build -p ios`.
  Bundle id `com.milqdigital.parkinglingo`.
- **Server:** `MOCK_VISION=1 npm run dev -w server` (port 8787) returns fixture readings without
  calling Claude. `EXPO_PUBLIC_MOCK_FIXTURE=<fixture id>` makes the app send `x-mock-fixture`.
  For web against a local server also set `CORS_ORIGINS=http://localhost:8081` on the server.
- **Demo mode:** Settings → Demo mode (adds a "Demo signs" button to the camera screen), or the
  web home screen. Each fixture runs on its own demo clock (toggle to use the real time).
  Deep link: `/result?fixture=<id>` (`&clock=now` for the real time). When `EXPO_PUBLIC_API_URL`
  is unset the app offers demo mode automatically.

## Layout

```
src/app/          routes: index (Scan), analysing, result, settings, demo, history
src/api/          client.ts (fetch + timeout/abort), errors.ts (typed AppError + friendly copy)
src/state/        settings (+ → context), history, scanStore (current scan), AppProviders (AsyncStorage)
src/logic/        pure view logic: viewModel (verdict → hero/chips/warnings), timeline, reminder, format
src/components/   VerdictHero, FactChips, SideSelector, TimelineBar, Warnings, EvidenceSection, SignPlate
src/lib/          device glue: photo (resize/JPEG), notifications, haptics + time zone
src/theme/        tokens (light/dark, verdict tones, type scale, 44 pt touch targets)
scripts/          make-icons.js, screenshots.js, e2e-scan.js (Playwright)
docs/screenshots/ iPhone-size (390×844 @2x) renders of the result screen in demo mode
```

## Behaviour notes

- Photos are re-encoded to JPEG (long edge 1600 px, quality 0.7; EXIF stripped) — the server
  rejects HEIC. A 320 px thumbnail is kept for history.
- The server's `reading` is re-validated with the core schema; the verdict is recomputed locally
  every minute and whenever side / holiday / settings change (server verdict is only a fallback).
- Not-a-parking-sign and very low confidence readings (< 0.5) show "That's not a parking sign" /
  "Move closer and rescan" instead of a result. Request timeout is 75 s (server read timeout 60 s);
  after 15 s the progress card says it's taking longer than usual.
- Reminder permission is only requested when the user taps "Set a reminder".

## Checks

```sh
npm run typecheck && npm test && npm run lint
npx expo-doctor
npx expo export --platform ios            # Hermes bytecode bundle incl. core
node scripts/screenshots.js               # with `npx expo start --web` running on :8081
```
