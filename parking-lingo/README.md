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
│   ├── src/holidays.ts        Australian public holiday calendar (by rule, any year)
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

Guiding rule: the engine never answers `yes` / `yes_with_conditions` on a path where a real
restriction might be in force.

- **No Stopping / Clearway / Bus & Transit lanes / Special event**: can't stop at all during the
  times. Clearways are always treated as tow-away. A prohibition starting within 5 minutes makes
  the answer `no` ("Clearway starts in 2 min — don't park here").
- **No Parking**: "no", with the nuance that you may stop up to 2 minutes to drop off/pick up
  while staying within 3 m of the vehicle (ARR r.168).
- **Timed parking** (`1/4P`, `1P`, `2P`, plain `P`): applies only inside its times. A stay may run
  past the end of the window ("2P ends 6:00 pm — no limit after that"). Arriving before the
  window, the limit counts from window start. Back-to-back limited windows keep counting from
  arrival (conservative); if you'd already be over a stricter limit when it starts, you must move
  by its start ("Move by 12:00 pm — 1/4P limit starts").
- **Zones** (loading, bus, taxi, mail, works, truck, motorbike, car share, EV): treated as
  no-stopping for vehicles they aren't for. Loading zones are allowed only for `commercial` /
  `truck` vehicles, with a default 30-minute limit when none is printed (ARR r.179); some states
  let other vehicles load briefly — we warn instead of allowing.
- **Vehicle wording**: `allowedVehicles` (structured, "X only") or, failing that, "… only" text in
  `vehicleRestriction`. The text fallback only accepts exact phrases ("Cars only", "Motor cars
  only", "Motor vehicles only", "Motor cycles only", "Buses only", "Taxis only", "Goods vehicles
  only"…); anything with "authorised" is authorised-only; anything else ("Police cars only", "Car
  share vehicles only", "Hire cars only", "Doctors only") is unclear → `unsure`. With "… only
  except …" the "only" clause decides. Structured `["other"]` → `unsure` unless your class is also
  listed. Not your vehicle → `no`. Any vehicle note ("Buses excepted") is shown in the summary and
  caps the answer at `yes_with_conditions`.
- **Disability parking**: only with a disability permit. State concessions (e.g. extra time on
  timed signs for permit holders — rules differ by state) are *not* applied.
- **Permit holders excepted**: only on parking-type panels (timed parking, No Parking that says so,
  permit zones) — never on No Stopping, clearways, bus/transit lanes or special events. Codes are
  tokenised: `"Area 1/2"`, `"Areas 1-2"`, `"Area 1 & 2"` → areas 1 and 2 (not 12);
  `"Permit Area S"` → S; `"Area 012"` → 12. An exemption with no legible area is not assumed.
- **Stacking**: at each instant the most restrictive applicable panel wins
  (no stopping > no parking > limited > free). Arrows filter panels by side; `none`/`both` arrows
  apply to both sides. A *restrictive* panel read with confidence < 0.75 counts for both sides
  (its arrow may be misread). If the side is unknown and panels differ by side, the verdict is
  "Depends on side" (`needsSide: true`) with `bySide` answers (or "No — either side").
- **Overnight windows** (`10pm–6am Fri`) belong to the day they start.
- **Temporary signs** take part in "most restrictive wins", so a temporary prohibition overrides
  the permanent sign, but a temporary *permission* never overrides a permanent prohibition.
  - No legible dates → in force + warning.
  - Doubtful dates on a temporary *prohibition* → `unsure` ("A temporary sign's dates are unclear
    — read it before parking", shortLabel "Check temporary sign"), unless a permanent panel
    already says no. Doubtful = an invalid calendar date, end before start, or dates that would
    put the sign in force now if a year were off by one: either endpoint of a two-sided range
    (shifted range ≤ 120 days), or the only date of a one-sided "from …"/"until …" (shifted date
    within 120 days of now). The 120-day bound is deliberate: without it every dated sign within a
    year of today (e.g. next Monday's roadworks) would count as doubtful.
  - Cleanly past or future (not in force under any plausible shift) → not applied now, but never a
    plain `yes`; the sign and its dates are stated in the summary.
  - A date-only start counts only windows that *start* on or after that date; a date-only end
    includes every window that starts on or before it, to its natural end (a 10pm–6am window on
    the last night still covers 2 am the next morning; the night before the start date doesn't).
  - Dated future signs are listed in `upcomingTemporary`.
- **Public holidays** (architect decision): signed restrictions **apply on public holidays unless
  the sign says otherwise** — the rule in NSW and the safe reading everywhere. A schedule marked
  *excluded* ("except public holidays") is lifted on a holiday; *included* ("Sun & public
  holidays") also applies on holidays; *unspecified* is never lifted (a soft note says sign times
  still apply — some councils differ). When holiday status can't be determined the restrictive
  reading is used for both included and excluded schedules, and a warning is shown only if the
  answer would differ. A restriction lifted only because the built-in calendar says it's a holiday
  (not the user) is capped at `yes_with_conditions` with "Lifted today — <holiday>. Check the
  sign." An "incl. public holidays" panel that isn't in force now adds a regional-holiday caveat
  and caps a plain yes (the calendar can't know local holidays). The user's `isPublicHoliday:
  false` never switches off an "incl. public holidays" schedule on a calendar holiday.
- **Confidence**: overall/panel confidence < 0.5 → `unsure`; < 0.75 → never `yes`
  (a `no` is kept, with a warning). `other` panel kinds and overlapping conflicting time
  limits → `unsure`.
- **Time**: all instants are ISO UTC strings; local math uses the injected IANA zone via `Intl`
  (DST gaps/overlaps handled). User-facing times are 12-hour ("4:00 pm", "8:00 am tomorrow").
  `maxStayMinutes` is only set when you must move within 24 h; otherwise see `leaveBy` (the
  eventual deadline, up to 8 days ahead) and `unrestrictedUntil`.

## Public holiday calendar (`src/holidays.ts`)

`australianPublicHolidays(year, "AU-NSW")`, `isPublicHolidayOn(date, jurisdiction)` compute
holidays by rule for any year; the answer is three-valued (`true` / `false` / `"unknown"`).
`evaluate` uses the calendar when `context.isPublicHoliday` isn't a boolean. Jurisdiction
(`resolveJurisdictions`): an explicit `context.jurisdiction` wins; the reading's
`jurisdictionHint` is trusted only if it agrees with the time zone (or the zone maps to nothing);
otherwise the zone's candidates are used — `Australia/Sydney` = NSW + ACT, Broken Hill / Lord Howe
= NSW, Eucla = WA + SA, Melbourne = VIC, … A day is a holiday only if every candidate agrees,
otherwise "unknown" (e.g. Canberra Day when the ACT was only guessed from the Sydney zone). A
hint that conflicts with the zone makes every disagreeing day "unknown". With no jurisdiction,
every day is unknown. `Verdict.jurisdictionSource` says which path was taken.

Included: New Year's Day, Australia Day (Monday substitute when on a weekend), Good Friday,
Easter Saturday (not WA/TAS), Easter Sunday (NSW, VIC, QLD, WA, ACT), Easter Monday, Anzac Day
(WA Monday substitute only), Christmas/Boxing Day (Proclamation Day in SA) with the standard
weekend substitutes, Labour Day / Eight Hours Day / May Day per state, King's Birthday (2nd Monday
June; QLD 1st Monday October), Adelaide Cup (SA), WA Day, Picnic Day (NT), Canberra Day and
Reconciliation Day (ACT), Melbourne Cup Day (VIC — metro Melbourne only, so reported as
"unknown").

Reported as "unknown" (`scope: "uncertain"`): AFL Grand Final Friday candidates (VIC, the Friday
before the last Saturday in September, from 2015), WA King's Birthday candidates (every Monday
20 Sep – 7 Oct), and the weekend date of a holiday that also gets a weekday substitute (e.g.
Boxing Day on a Saturday) — states differ on whether the weekend day itself is a holiday.

Left out deliberately (can't be known or not certain — "not a holiday" means signed restrictions
apply, so omissions are the conservative direction): regional/local holidays (show days, the
Ekka, Royal Hobart Regatta, council-substituted Melbourne Cup days), AFL Grand Final Friday (date
set each year — only its usual candidate day is "unknown"; a grand final in October is missed),
Easter Sunday in SA/NT/TAS, Anzac Day weekend substitutes outside WA, part-day holidays (Christmas Eve / New
Year's Eve evenings in SA and NT), and one-off proclaimed days. SA's Christmas/Proclamation Day
substitute rules are modelled the same as other states, which may differ in some years. Add
known local holidays via `context.publicHolidayDates`.

## Adding a jurisdiction

`jurisdictionHint` is carried through the reading. Jurisdiction-specific behaviour (holiday
calendars, loading-zone rules, disability concessions) should be added as explicit options to
`evaluate` rather than baked into the panel kinds.
