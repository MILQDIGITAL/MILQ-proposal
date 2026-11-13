import type { UpcomingRestriction } from "@parking-lingo/core";
import { formatInstant } from "@parking-lingo/core";
import { Pressable, StyleSheet, View } from "react-native";
import type { TemporaryAlert, WarningItem, WarningKind } from "../logic/viewModel";
import { radius, space, usePalette } from "../theme";
import { AppText, Icon } from "./ui";

/** Yellow/black roadworks-style stripe, so temporary signs look like temporary signs. */
function HazardStripe({ color, height = 10 }: { color: string; height?: number }) {
  return (
    <View style={[styles.stripe, { height }]} accessible={false} importantForAccessibility="no-hide-descendants">
      {Array.from({ length: 40 }).map((_, i) => (
        <View key={i} style={[styles.stripeBar, { backgroundColor: color, height: height * 3 }]} />
      ))}
    </View>
  );
}

export function TemporaryBanner({ alert }: { alert: TemporaryAlert }) {
  const p = usePalette();
  const t = p.temporary;
  return (
    <View
      style={[styles.temp, { backgroundColor: t.fill, borderColor: t.stripe }]}
      accessible
      accessibilityRole="alert"
      accessibilityLabel={`${alert.title}. ${alert.detail}`}
      testID="temporary-banner"
    >
      <HazardStripe color={t.stripe} />
      <View style={styles.tempBody}>
        <Icon name="construct" size={34} color={t.onFill} />
        <View style={{ flex: 1 }}>
          <AppText variant="headline" color={t.onFill} style={styles.tempTitle}>
            {alert.title.toUpperCase()}
          </AppText>
          <AppText variant="body" color={t.onFill} style={{ fontWeight: "600" }}>
            {alert.detail}
          </AppText>
        </View>
      </View>
      <HazardStripe color={t.stripe} />
    </View>
  );
}

const KIND_ICON: Record<WarningKind, string> = {
  temporary: "construct",
  tow: "car-sport",
  legibility: "eye-outline",
  holiday: "calendar-outline",
  general: "information-circle-outline",
};

export function WarningsList({
  warnings,
  isPublicHoliday,
  onSetPublicHoliday,
}: {
  warnings: WarningItem[];
  isPublicHoliday: boolean | "unknown";
  onSetPublicHoliday: (v: boolean | "unknown") => void;
}) {
  const p = usePalette();
  if (warnings.length === 0) return null;
  return (
    <View style={{ gap: space.sm }}>
      {warnings.map((w) => {
        const strong = w.kind === "temporary" || w.kind === "tow";
        const colors =
          w.kind === "temporary"
            ? { bg: p.temporary.fill, fg: p.temporary.onFill, border: p.temporary.stripe }
            : w.kind === "tow"
              ? { bg: p.tone.no.soft, fg: p.tone.no.onSoft, border: p.tone.no.fill }
              : { bg: p.surface, fg: p.text, border: p.border };
        return (
          <View key={w.text} style={[styles.warning, { backgroundColor: colors.bg, borderColor: colors.border, borderWidth: strong ? 2 : 1 }]}>
            <View style={styles.warningRow} accessible accessibilityLabel={`Warning: ${w.text}`}>
              <Icon name={KIND_ICON[w.kind]} size={24} color={w.kind === "general" || w.kind === "holiday" || w.kind === "legibility" ? p.textMuted : colors.fg} />
              <AppText variant={strong ? "bodyStrong" : "callout"} color={colors.fg} style={{ flex: 1 }}>
                {w.text}
              </AppText>
            </View>
            {w.kind === "holiday" ? <HolidayToggle value={isPublicHoliday} onChange={onSetPublicHoliday} /> : null}
          </View>
        );
      })}
    </View>
  );
}

/** Lets the user answer the engine's "is today a public holiday?" doubt in place. */
function HolidayToggle({ value, onChange }: { value: boolean | "unknown"; onChange: (v: boolean | "unknown") => void }) {
  const p = usePalette();
  const opts: { v: boolean | "unknown"; label: string }[] = [
    { v: false, label: "Not a holiday" },
    { v: true, label: "Public holiday" },
  ];
  return (
    <View style={styles.holidayRow} accessibilityRole="radiogroup" accessibilityLabel="Is today a public holiday?">
      {opts.map((o) => {
        const sel = value === o.v;
        return (
          <Pressable
            key={String(o.v)}
            onPress={() => onChange(sel ? "unknown" : o.v)}
            accessibilityRole="radio"
            accessibilityState={{ selected: sel, checked: sel }}
            style={[styles.holidayBtn, { borderColor: sel ? p.focus : p.borderStrong, backgroundColor: sel ? p.tone.side.soft : "transparent" }]}
          >
            <AppText variant="callout" color={sel ? p.focus : p.text} style={{ fontWeight: "700" }}>
              {o.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

export function UpcomingTemporaryList({ items, nowMs, timeZone }: { items: UpcomingRestriction[]; nowMs: number; timeZone: string }) {
  const p = usePalette();
  if (items.length === 0) return null;
  return (
    <View style={{ gap: space.sm }}>
      {items.map((u) => (
        <View
          key={`${u.panelIndex}-${u.from}`}
          style={[styles.upcoming, { backgroundColor: p.surface, borderColor: p.temporary.fill }]}
          accessible
          accessibilityLabel={`${u.label} from ${formatInstant(Date.parse(u.from), nowMs, timeZone)}${u.to ? ` to ${formatInstant(Date.parse(u.to), nowMs, timeZone)}` : ""}`}
        >
          <View style={[styles.upIcon, { backgroundColor: p.temporary.fill }]}>
            <Icon name="calendar" size={20} color={p.temporary.onFill} />
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="bodyStrong">{u.label}</AppText>
            <AppText variant="callout" muted>
              {formatInstant(Date.parse(u.from), nowMs, timeZone)}
              {u.to ? ` → ${formatInstant(Date.parse(u.to), nowMs, timeZone)}` : ""}
            </AppText>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  temp: { borderRadius: radius.lg, borderWidth: 2, overflow: "hidden" },
  tempBody: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.lg },
  tempTitle: { fontWeight: "900", letterSpacing: 0.6 },
  stripe: { flexDirection: "row", overflow: "hidden", gap: 10, alignItems: "center" },
  stripeBar: { width: 10, transform: [{ rotate: "35deg" }] },
  warning: { borderRadius: radius.md, padding: space.md, gap: space.sm },
  warningRow: { flexDirection: "row", gap: space.md, alignItems: "flex-start" },
  holidayRow: { flexDirection: "row", gap: space.sm, paddingLeft: 36 },
  holidayBtn: { minHeight: 44, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1.5, justifyContent: "center" },
  upcoming: { flexDirection: "row", gap: space.md, alignItems: "center", padding: space.md, borderRadius: radius.md, borderWidth: 2 },
  upIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
});
