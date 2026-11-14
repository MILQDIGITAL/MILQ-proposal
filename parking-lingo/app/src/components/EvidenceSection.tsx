import { describePanel, formatInstant, type PanelEvidence, type PanelEvidenceState, type SignReading } from "@parking-lingo/core";
import { useState } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { radius, space, usePalette, type Palette } from "../theme";
import { SignPlate } from "./SignPlate";
import { AppText, Icon } from "./ui";

function stateChip(p: Palette, e: PanelEvidence, nowMs: number, tz: string): { text: string; bg: string; fg: string } {
  const map: Record<PanelEvidenceState, { text: string; bg: string; fg: string }> = {
    active_now: { text: "In force now", bg: p.tone.conditional.soft, fg: p.tone.conditional.onSoft },
    upcoming: {
      text: e.nextStart ? `Starts ${formatInstant(Date.parse(e.nextStart), nowMs, tz)}` : "Coming up",
      bg: p.tone.side.soft,
      fg: p.tone.side.onSoft,
    },
    not_soon: { text: "Not in force soon", bg: p.surfaceAlt, fg: p.textMuted },
    expired: { text: "Expired / dates passed", bg: p.surfaceAlt, fg: p.textMuted },
    other_side: { text: "Other side of pole", bg: p.surfaceAlt, fg: p.textMuted },
  };
  return map[e.state];
}

/** Collapsible "How we read the sign": photo, confidence, each panel, and the engine's reasons. */
export function EvidenceSection({
  reading,
  evidence,
  reasons,
  photoUri,
  nowMs,
  timeZone,
  calendarLine = null,
  initiallyOpen = false,
}: {
  reading: SignReading;
  evidence: PanelEvidence[];
  reasons: string[];
  photoUri: string | null;
  nowMs: number;
  timeZone: string;
  /** Which public-holiday calendar was used (see holidayCalendarLine). */
  calendarLine?: string | null;
  initiallyOpen?: boolean;
}) {
  const p = usePalette();
  const [open, setOpen] = useState(initiallyOpen);
  const byIndex = new Map(evidence.map((e) => [e.panelIndex, e]));
  const conf = Math.round(reading.overallConfidence * 100);

  return (
    <View style={[styles.wrap, { backgroundColor: p.surface, borderColor: p.border }]}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel="How we read the sign"
        accessibilityHint={open ? "Collapse" : "Expand to check what was read"}
        style={styles.header}
        testID="evidence-toggle"
      >
        <Icon name="eye-outline" size={22} color={p.text} />
        <View style={{ flex: 1 }}>
          <AppText variant="bodyStrong">How we read the sign</AppText>
          <AppText variant="footnote" muted>
            {reading.panels.length} panel{reading.panels.length === 1 ? "" : "s"} · {conf}% confident · check it matches
          </AppText>
        </View>
        <Icon name={open ? "chevron-up" : "chevron-down"} size={22} color={p.textMuted} />
      </Pressable>

      {open ? (
        <View style={styles.body}>
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={[styles.photo, { borderColor: p.border }]} resizeMode="cover" accessibilityLabel="Your photo of the sign" />
          ) : (
            <View style={[styles.noPhoto, { backgroundColor: p.surfaceAlt }]}>
              <Icon name="flask-outline" size={18} color={p.textMuted} />
              <AppText variant="footnote" muted>
                Demo sign — no photo
              </AppText>
            </View>
          )}

          {reasons.length ? (
            <View style={{ gap: 4 }}>
              <AppText variant="label" muted>
                WHY
              </AppText>
              {reasons.map((r) => (
                <AppText key={r} variant="callout">
                  • {r}
                </AppText>
              ))}
            </View>
          ) : null}

          <AppText variant="label" muted>
            PANELS, TOP TO BOTTOM
          </AppText>
          {reading.panels.map((panel, i) => {
            const e = byIndex.get(i);
            const chip = e ? stateChip(p, e, nowMs, timeZone) : null;
            return (
              <View
                key={i}
                style={[styles.panelRow, { borderColor: e?.drivesDecision ? p.focus : p.border, borderWidth: e?.drivesDecision ? 2 : 1 }]}
                accessible
                accessibilityLabel={`Panel ${i + 1}: ${describePanel(panel)}. ${chip?.text ?? ""}. Read as: ${panel.rawText}. ${Math.round(panel.confidence * 100)} percent confident.`}
              >
                <SignPlate panel={panel} width={112} />
                <View style={styles.panelText}>
                  <AppText variant="bodyStrong">{describePanel(panel)}</AppText>
                  <View style={styles.chips}>
                    {chip ? (
                      <View style={[styles.stateChip, { backgroundColor: chip.bg }]}>
                        <AppText variant="footnote" color={chip.fg} style={{ fontWeight: "700" }}>
                          {chip.text}
                        </AppText>
                      </View>
                    ) : null}
                    {e?.drivesDecision ? (
                      <View style={[styles.stateChip, { backgroundColor: p.tone.side.soft }]}>
                        <AppText variant="footnote" color={p.tone.side.onSoft} style={{ fontWeight: "700" }}>
                          Decides the answer
                        </AppText>
                      </View>
                    ) : null}
                  </View>
                  <AppText variant="footnote" muted>
                    Read as “{panel.rawText}” · {Math.round(panel.confidence * 100)}%
                  </AppText>
                </View>
              </View>
            );
          })}
          <AppText variant="footnote" muted>
            {calendarLine}
          </AppText>
          {reading.legibilityIssues.length ? (
            <AppText variant="footnote" muted>
              Reading issues: {reading.legibilityIssues.join("; ")}
            </AppText>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.lg, borderWidth: 1, overflow: "hidden" },
  header: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.lg, minHeight: 56 },
  body: { paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.md },
  photo: { width: "100%", height: 200, borderRadius: radius.md, borderWidth: 1 },
  noPhoto: { flexDirection: "row", alignItems: "center", gap: space.sm, padding: space.md, borderRadius: radius.md },
  panelRow: { flexDirection: "row", gap: space.md, padding: space.sm, borderRadius: radius.md, alignItems: "flex-start" },
  panelText: { flex: 1, gap: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  stateChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
});
