import { StyleSheet, View } from "react-native";
import { formatCountdown } from "../logic/format";
import type { ChipTone, FactChip } from "../logic/viewModel";
import { radius, space, usePalette, type Palette } from "../theme";
import { AppText, Icon } from "./ui";

function chipColors(p: Palette, tone: ChipTone) {
  switch (tone) {
    case "good":
      return p.tone.yes;
    case "caution":
      return p.tone.conditional;
    case "danger":
      return p.tone.no;
    case "info":
      return p.tone.side;
  }
}

/**
 * Key facts as big tiles. Time-critical facts ("Leave by 4:00 pm") get a full-width tile
 * with a large live countdown; the rest pair up two per row.
 */
export function FactChips({ chips, nowMs }: { chips: FactChip[]; nowMs: number }) {
  const p = usePalette();
  if (chips.length === 0) return null;
  return (
    <View style={styles.grid}>
      {chips.map((chip) => {
        const c = chipColors(p, chip.tone);
        const msLeft = chip.countdownTo ? Date.parse(chip.countdownTo) - nowMs : null;
        const wide = chip.countdownTo !== null;
        const danger = chip.tone === "danger";
        const countdown = msLeft === null ? null : msLeft <= 0 ? "Now" : formatCountdown(msLeft);
        return (
          <View
            key={chip.key}
            style={[
              styles.tile,
              wide && styles.wide,
              {
                backgroundColor: danger ? c.soft : p.surface,
                borderColor: danger || wide ? c.fill : p.border,
                borderWidth: danger || wide ? 2 : 1,
              },
            ]}
            accessible
            accessibilityLabel={[chip.label, countdown ? `${countdown} left` : null, chip.detail].filter(Boolean).join(", ")}
            testID={`chip-${chip.key}`}
          >
            <View style={[styles.iconWrap, { backgroundColor: c.fill }]}>
              <Icon name={chip.icon} size={22} color={c.onFill} />
            </View>
            <View style={styles.text}>
              {wide && chip.caption && chip.value ? (
                <>
                  <AppText variant="footnote" muted style={styles.countdownCaption}>
                    {chip.caption.toUpperCase()}
                  </AppText>
                  <AppText style={[styles.wideValue, chip.value.length > 9 && styles.wideValueLong, { color: p.text }]} maxFontSizeMultiplier={1.4}>
                    {chip.value}
                  </AppText>
                </>
              ) : (
                <AppText variant="headline" style={styles.label} maxFontSizeMultiplier={1.6}>
                  {chip.label}
                </AppText>
              )}
              {!wide && chip.detail ? (
                <AppText variant="footnote" muted maxFontSizeMultiplier={1.6}>
                  {chip.detail}
                </AppText>
              ) : null}
            </View>
            {wide && countdown ? (
              <View style={styles.countdown}>
                <AppText variant="footnote" muted style={styles.countdownCaption}>
                  {chip.key === "leaveBy" ? "TIME LEFT" : "ALLOWED IN"}
                </AppText>
                <AppText style={[styles.countdownValue, { color: p.text }]} maxFontSizeMultiplier={1.4} numberOfLines={1}>
                  {countdown}
                </AppText>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  tile: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "45%",
    minHeight: 64,
    borderRadius: radius.lg,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
  },
  wide: { flexBasis: "100%", minHeight: 76 },
  iconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  text: { flex: 1 },
  label: { fontWeight: "800", fontSize: 17, lineHeight: 21 },
  wideValue: { fontSize: 24, lineHeight: 29, fontWeight: "900" },
  wideValueLong: { fontSize: 19, lineHeight: 24 },
  countdown: { alignItems: "flex-end" },
  countdownCaption: { fontWeight: "800", letterSpacing: 0.6, fontSize: 11 },
  countdownValue: { fontSize: 24, lineHeight: 29, fontWeight: "900", fontVariant: ["tabular-nums"] },
});
