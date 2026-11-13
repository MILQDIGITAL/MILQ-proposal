import { panelLabel, type Side, type SideVerdict, type SignReading } from "@parking-lingo/core";
import { Pressable, StyleSheet, View } from "react-native";
import { tapHaptic } from "../lib/device";
import { sideSummary } from "../logic/viewModel";
import { radius, space, usePalette } from "../theme";
import { AppText, Icon } from "./ui";

/** Panels that cover one side of the pole (arrow that way, or no/double arrow). */
export function panelsForSide(reading: SignReading, side: Side) {
  return reading.panels.filter((p) => p.arrow === side || p.arrow === "both" || p.arrow === "none");
}

/**
 * Top-down sketch: the kerb runs left–right, the pole is in the middle, and the user
 * stands on the footpath facing the sign. Makes "left" and "right" unambiguous.
 */
function SideDiagram({ selected }: { selected: Side | "unknown" }) {
  const p = usePalette();
  const zone = (side: Side) => (
    <View
      style={[
        styles.zone,
        {
          backgroundColor: selected === side ? p.tone.side.fill : p.surface,
          borderColor: p.tone.side.fill,
        },
      ]}
    >
      <Icon name={side === "left" ? "arrow-back" : "arrow-forward"} size={18} color={selected === side ? "#FFFFFF" : p.tone.side.fill} />
      <AppText variant="label" color={selected === side ? "#FFFFFF" : p.tone.side.onSoft}>
        {side === "left" ? "LEFT KERB" : "RIGHT KERB"}
      </AppText>
    </View>
  );
  return (
    <View style={styles.diagram} accessible accessibilityLabel="Diagram: you stand facing the sign; the left kerb is to the left of the pole and the right kerb to the right.">
      <AppText variant="footnote" muted style={styles.road}>
        ROAD
      </AppText>
      <View style={styles.kerbRow}>
        {zone("left")}
        <View style={styles.pole}>
          <View style={[styles.signFace, { backgroundColor: "#FFFFFF", borderColor: "#30363D" }]}>
            <AppText style={styles.signP} color="#0A7A3A">
              P
            </AppText>
          </View>
          <View style={[styles.poleStick, { backgroundColor: p.borderStrong }]} />
        </View>
        {zone("right")}
      </View>
      <View style={styles.you}>
        <Icon name="arrow-up" size={16} color={p.textMuted} />
        <View style={styles.youRow}>
          <Icon name="person" size={18} color={p.text} />
          <AppText variant="footnote" style={{ fontWeight: "700" }}>
            You, on the footpath, facing the sign
          </AppText>
        </View>
      </View>
    </View>
  );
}

/** "Which side of the pole will you park on?" — each option shows the panels and the answer for that side. */
export function SideSelector({
  bySide,
  reading,
  selected,
  onSelect,
  nowMs,
  timeZone,
}: {
  bySide: { left: SideVerdict; right: SideVerdict };
  reading: SignReading;
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
        Which side of the pole will you park on?
      </AppText>
      <AppText variant="callout" muted style={styles.hint}>
        Face the sign. Pick the side your car will actually be on — the answers differ.
      </AppText>
      <SideDiagram selected={selected} />
      <View style={styles.row} accessibilityRole="radiogroup">
        {sides.map((side) => {
          const s = sideSummary(bySide[side], nowMs, timeZone);
          const c = p.tone[s.tone];
          const isSel = selected === side;
          const where = side === "left" ? "To the LEFT of the pole" : "To the RIGHT of the pole";
          const panels = panelsForSide(reading, side);
          return (
            <Pressable
              key={side}
              onPress={() => {
                tapHaptic();
                onSelect(isSel ? "unknown" : side);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSel, checked: isSel }}
              accessibilityLabel={`Parking ${where.toLowerCase()}, as you face the sign. Panels: ${panels.map(panelLabel).join(", ") || "none"}. Answer: ${s.word}, ${s.headline}${s.detail ? `, ${s.detail}` : ""}`}
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
                <Icon name={side === "left" ? "arrow-back" : "arrow-forward"} size={28} color={p.text} />
                <AppText variant="bodyStrong" style={styles.sideLabel}>
                  {side === "left" ? "LEFT" : "RIGHT"}
                </AppText>
              </View>
              <AppText variant="footnote" muted>
                {where}, as you face it
              </AppText>
              <View style={styles.panelList}>
                {panels.length === 0 ? (
                  <AppText variant="footnote" muted>
                    No panel covers this side
                  </AppText>
                ) : (
                  panels.map((pn, i) => (
                    <View key={i} style={[styles.panelTag, { borderColor: p.borderStrong }]}>
                      <Icon
                        name={pn.arrow === "left" ? "arrow-back" : pn.arrow === "right" ? "arrow-forward" : pn.arrow === "both" ? "swap-horizontal" : "remove"}
                        size={13}
                        color={p.textMuted}
                      />
                      <AppText variant="footnote" style={{ fontWeight: "700", flexShrink: 1 }} numberOfLines={2}>
                        {panelLabel(pn)}
                      </AppText>
                    </View>
                  ))
                )}
              </View>
              <View style={[styles.divider, { backgroundColor: p.border }]} />
              <AppText variant="label" muted style={{ fontSize: 11 }}>
                ANSWER HERE
              </AppText>
              <View style={[styles.badge, { backgroundColor: c.fill }]}>
                <Icon name={s.icon} size={16} color={c.onFill} />
                <AppText variant="label" color={c.onFill}>
                  {s.word}
                </AppText>
              </View>
              <AppText variant="bodyStrong">{s.headline}</AppText>
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
  hint: { marginBottom: space.xs },
  diagram: { alignItems: "stretch", marginVertical: space.sm },
  road: { textAlign: "center", letterSpacing: 2, fontWeight: "800", fontSize: 11 },
  kerbRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  zone: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, height: 34, borderRadius: radius.sm, borderWidth: 1.5 },
  pole: { alignItems: "center", width: 34 },
  signFace: { width: 30, height: 30, borderRadius: 4, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  signP: { fontSize: 18, lineHeight: 20, fontWeight: "900" },
  poleStick: { width: 3, height: 10 },
  you: { alignItems: "center", marginTop: 2 },
  youRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  row: { flexDirection: "row", gap: space.sm, marginTop: space.xs },
  option: { flex: 1, borderRadius: radius.lg, padding: space.md, gap: 6, minHeight: 150 },
  sideHead: { flexDirection: "row", alignItems: "center", gap: space.xs },
  sideHeadRight: { flexDirection: "row-reverse", justifyContent: "flex-start" },
  sideLabel: { fontSize: 20, fontWeight: "900", letterSpacing: 1 },
  panelList: { gap: 4 },
  panelTag: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, alignSelf: "flex-start", maxWidth: "100%" },
  divider: { height: 1, marginVertical: 2 },
  badge: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  selected: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: "auto" },
});
