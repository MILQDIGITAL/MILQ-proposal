# Parking Lingo

Point your iPhone camera at a parking sign; find out at a glance whether you can park there.
Australia first (all states), designed so other jurisdictions can be added later.

## Architecture

```
parking-lingo/                 npm workspace root (private)
├── packages/core              @parking-lingo/core — pure TypeScript, no I/O
│   ├── src/schema.ts          SignReading zod schema (the vision-model contract)
│   ├── src/jsonSchema.ts      JSON Schema exports for Claude structured output
│   ├── src/engine.ts          evaluate(reading, context) -> Verdict (deterministic rules)
│   ├── src/types.ts           ParkingContext, Verdict, TimelineSegment, ...
│   ├── src/time.ts            Intl-based, DST-correct time math
│   ├── src/fixtures.ts        Realistic sign readings (@parking-lingo/core/fixtures)
│   └── test/                  vitest suite
├── server/                    (phase 2) photo -> Claude vision -> SignReading
└── app/                       (phase 3) Expo React Native app rendering the Verdict
```

**The LLM only reads; deterministic code decides.** The server asks Claude to transcribe the
photo into a `SignReading` (validate with `parseSignReading` / `safeParseSignReading`). The
engine turns that plus a `ParkingContext` (injected `now`, IANA time zone, side of pole,
permits, vehicle…) into a `Verdict` with a status (`yes` / `yes_with_conditions` / `no` /
`unsure`), a ≤4-word headline, a one-line summary, `leaveBy`, a 24-hour timeline and reasons.
The engine is conservative: shaky or contradictory readings give `unsure`, never `yes`.

`@parking-lingo/core` ships TypeScript source (`main`/`types`/`exports` → `src/*.ts`), so Metro
and `tsx`/vitest consume it with no build step. Imports inside the package are extensionless,
so Node's built-in type stripping (`node --experimental-strip-types`) won't work — use `tsx` on
the server.

For structured output use `signReadingStructuredOutputSchema` (constraints Claude doesn't
support — min/max, pattern — are stripped and every object is closed); always re-validate the
response with `parseSignReading`.

## Scripts

```sh
npm install          # from parking-lingo/
npm test             # vitest in every workspace
npm run typecheck    # tsc --noEmit in every workspace
```

## Rule interpretations (Australian Road Rules + conservative choices)

- **No Stopping / Clearway / Bus & Transit lanes / Special event**: can't stop at all during the
  times. Clearways are always treated as tow-away.
- **No Parking**: "no", with the nuance that you may stop up to 2 minutes to drop off/pick up
  while staying within 3 m of the vehicle (ARR r.168).
- **Timed parking** (`1/4P`, `1P`, `2P`, plain `P`): applies only inside its times. A stay may run
  past the end of the window. Arriving before the window, the limit counts from window start.
  If two limited windows are back-to-back the clock keeps running from arrival (conservative).
- **Zones** (loading, bus, taxi, mail, works, truck, motorbike, car share, EV): treated as
  no-stopping for vehicles they aren't for. Loading zones are allowed only for `commercial` /
  `truck` vehicles; some states let other vehicles load briefly — we warn instead of allowing.
- **Disability parking**: only with a disability permit. State concessions (e.g. extra time on
  timed signs for permit holders in NSW/VIC/QLD — rules differ by state) are *not* applied.
- **Permit holders excepted**: exempt only if the user holds a permit whose normalised area code
  matches (`"Area 012"` = `"12"`). An exemption with no legible area is not assumed. Permits never
  exempt from a clearway.
- **Stacking**: at each instant the most restrictive applicable panel wins
  (no stopping > no parking > limited > free). Arrows filter panels by side; `none`/`both` arrows
  apply to both sides. If the side is unknown and panels differ by side, the verdict is
  "Depends on side" with `bySide` answers (or "No — either side" if both are no).
- **Overnight windows** (`10pm–6am Fri`) belong to the day they start.
- **Temporary signs** take part in "most restrictive wins", so a temporary prohibition overrides
  the permanent sign, but a temporary *permission* never overrides a permanent prohibition.
  No legible dates → in force + warning. Dates in the past → not applied, warning that it may be
  stale/misread, and the answer is never a plain `yes`. Dated future signs are listed in
  `upcomingTemporary`.
- **Public holidays**: schedule says *included* → applies on holidays; *excluded* → doesn't.
  *Unspecified* on a known holiday: "soft" restrictions (timed, paid, zones) are assumed lifted
  with a double-check warning; tow-away/clearway/no-stopping/temporary panels stay in force.
  Whether signed restrictions apply on public holidays differs between states and councils,
  hence the warning. Unknown holiday status → restrictions assumed to apply, with a warning.
  Days other than today are assumed not to be holidays unless listed in `publicHolidayDates`.
- **Confidence**: overall/panel confidence < 0.5 → `unsure`; < 0.75 → never `yes`
  (a `no` is kept, with a warning). `other` panel kinds and overlapping conflicting time
  limits → `unsure`.
- **Time**: all instants are ISO UTC strings; local math uses the injected IANA zone via `Intl`
  (DST gaps/overlaps handled). User-facing times are 12-hour ("4:00 pm", "8:00 am tomorrow").

## Adding a jurisdiction

`jurisdictionHint` is carried through the reading. Jurisdiction-specific behaviour (holiday
defaults, loading-zone rules, disability concessions) should be added as explicit options to
`evaluate` rather than baked into the panel kinds.
