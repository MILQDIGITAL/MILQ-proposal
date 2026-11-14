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
src/logic/        pure view logic: viewModel (verdict → hero/chips/warnings), resolveVerdict, intlCheck, timeline, reminder, format
src/components/   VerdictHero, FactChips, SideSelector, TimelineBar, Warnings (+ SpecialUnsureCard), EvidenceSection, SignPlate
src/dev/          extra demo readings (tests + dev-only deep links)
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
- Verdicts are computed locally only if the startup Intl self-check passes (AM/PM/midnight/DST
  probes in `src/logic/intlCheck.ts`). Otherwise — or if local evaluation throws — the app shows
  the server's verdict only while it is < 90 s old (with a notice), else an error with Rescan
  (`src/logic/resolveVerdict.ts`). Dev: `/result?fixture=<id>&intl=fail` simulates the failure.
- `EXPO_PUBLIC_MOCK_DEMO_TIME=1` (with the server in mock mode) sends `x-mock-demo-time: 1` and runs
  the result on the fixture's demo clock.
- Display semantics come from core: `needsSide` (side picker), `shortLabel` (hero line),
  `maxStayMinutes` / `leaveBy` / `unrestrictedUntil` (tiles, incl. "No limit until …"), and core's
  warnings for the temporary-sign banner ("overrides the regular sign" only when core says so).
- "Read the sign" unsure states get their own treatment instead of "move closer and rescan":
  "Check temporary sign" (unclear temporary dates) → yellow/black hero + the temporary panel as
  read; unclear vehicle wording → the sign's vehicle note quoted prominently.
- Public holidays: core's calendar (jurisdiction from context → sign → time zone). The inline
  holiday toggle appears only on core's "not sure / partial-state / local holidays" caveats (with
  Undo); a named holiday shows as a note; "How we read the sign" states which calendar was used,
  including the sign-vs-time-zone conflict case.
- Dev-only extra readings for states with no core fixture: `src/dev/devFixtures.ts`
  (`/result?fixture=dev-temporary-dates-unclear`, `dev-vehicle-note-unclear`, `dev-jurisdiction-conflict`).
- Reminder permission is only requested when the user taps "Set a reminder".

## Checks

```sh
npm run typecheck && npm test && npm run lint
npx expo-doctor
npx expo export --platform ios            # Hermes bytecode bundle incl. core
node scripts/screenshots.js               # with `npx expo start --web` running on :8081
```
