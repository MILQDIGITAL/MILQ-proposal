import type { Side, SideVerdict } from "@parking-lingo/core";
import { Pressable, StyleSheet, View } from "react-native";
import { tapHaptic } from "../lib/device";
import { sideSummary } from "../logic/viewModel";
import { radius, space, usePalette } from "../theme";
import { AppText, Icon } from "./ui";

/** "Which side of the sign are you parking?" — each side shows its own verdict. */
export function SideSelector({
  bySide,
  selected,
  onSelect,
  nowMs,
  timeZone,
}: {
  bySide: { left: SideVerdict; right: SideVerdict };
  selected: Side | "unknown";
  onSelect: (side: Side | "unknown") => void;
  nowMs: number;
  timeZone: string;
}) {
  const p = usePalette();
  const sides: Side[] = ["left", "right"];
  return (
    <View style={[styles.wrap, { backgroundColor: p.tone.side.soft, borderColor: p.tone.side.fill }]} testID="side-selector">
      <AppText variant="headline" style={styles.question} accessibilityRole="header">
        Which side of the sign are you parking?
      </AppText>
      <AppText variant="footnote" muted style={styles.hint}>
        Stand facing the sign. Arrows on the sign point to the kerb they cover.
      </AppText>
      <View style={styles.row} accessibilityRole="radiogroup">
        {sides.map((side) => {
          const s = sideSummary(bySide[side], nowMs, timeZone);
          const c = p.tone[s.tone];
          const isSel = selected === side;
          const label = side === "left" ? "Left of pole" : "Right of pole";
          return (
            <Pressable
              key={side}
              onPress={() => {
                tapHaptic();
                onSelect(isSel ? "unknown" : side);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSel, checked: isSel }}
              accessibilityLabel={`${label}: ${s.word}, ${s.headline}${s.detail ? `, ${s.detail}` : ""}`}
              accessibilityHint={isSel ? "Double tap to clear the side" : "Double tap to see the full answer for this side"}
              style={({ pressed }) => [
                styles.option,
                {
                  backgroundColor: p.surface,
                  borderColor: isSel ? p.focus : p.border,
                  borderWidth: isSel ? 3 : 1.5,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
              testID={`side-${side}`}
            >
              <View style={[styles.sideHead, side === "right" && styles.sideHeadRight]}>
                <Icon name={side === "left" ? "arrow-back" : "arrow-forward"} size={30} color={p.text} />
                <AppText variant="bodyStrong" style={styles.sideLabel}>
                  {side === "left" ? "LEFT" : "RIGHT"}
                </AppText>
              </View>
              <View style={[styles.badge, { backgroundColor: c.fill }]}>
                <Icon name={s.icon} size={18} color={c.onFill} />
                <AppText variant="label" color={c.onFill}>
                  {s.word}
                </AppText>
              </View>
              <AppText variant="bodyStrong" style={styles.headline}>
                {s.headline}
              </AppText>
              {s.detail ? (
                <AppText variant="footnote" muted>
                  {s.detail}
                </AppText>
              ) : null}
              {isSel ? (
                <View style={styles.selected}>
                  <Icon name="checkmark-circle" size={18} color={p.focus} />
                  <AppText variant="footnote" color={p.focus} style={{ fontWeight: "800" }}>
                    Selected
                  </AppText>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.xl, borderWidth: 2, padding: space.lg, gap: space.xs },
  question: { fontWeight: "800" },
  hint: { marginBottom: space.sm },
  row: { flexDirection: "row", gap: space.sm },
  option: { flex: 1, borderRadius: radius.lg, padding: space.md, gap: space.sm, minHeight: 150 },
  sideHead: { flexDirection: "row", alignItems: "center", gap: space.xs },
  sideHeadRight: { flexDirection: "row-reverse", justifyContent: "flex-start" },
  sideLabel: { fontSize: 20, fontWeight: "900", letterSpacing: 1 },
  badge: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill },
  headline: { fontSize: 18 },
  selected: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: "auto" },
});
