import type { TimelineSegment, TimelineStatus } from "@parking-lingo/core";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { tapHaptic } from "../lib/device";
import { buildTimelineModel } from "../logic/timeline";
import { radius, space, usePalette } from "../theme";
import { AppText, Icon } from "./ui";

const STATUS_ICON: Record<TimelineStatus, string> = { allowed: "checkmark", limited: "time", prohibited: "close" };
const STATUS_WORD: Record<TimelineStatus, string> = { allowed: "Free", limited: "Limited / paid", prohibited: "Not allowed" };

/** 24 h bar starting now. Tap a block to see its times and label. */
export function TimelineBar({ segments, nowMs, timeZone }: { segments: TimelineSegment[]; nowMs: number; timeZone: string }) {
  const p = usePalette();
  const model = useMemo(() => buildTimelineModel(segments, nowMs, timeZone), [segments, nowMs, timeZone]);
  const [selected, setSelected] = useState<number | null>(null);
  if (!model) return null;
  const sel = model.blocks[selected ?? model.currentIndex] ?? model.blocks[0]!;
  const color = (s: TimelineStatus) => p.timeline[s];
  const onColor = (s: TimelineStatus) => (s === "limited" ? "#1A1200" : "#FFFFFF");

  return (
    <View testID="timeline">
      <View style={styles.nowRow}>
        <View style={[styles.nowPin, { left: `${model.nowAt * 100}%`, backgroundColor: p.text }]}>
          <AppText variant="label" color={p.background}>
            NOW
          </AppText>
        </View>
      </View>
      <View style={[styles.bar, { backgroundColor: p.timeline.track, borderColor: p.borderStrong }]}>
        {model.blocks.map((b) => {
          const isSel = b.index === sel.index;
          return (
            <Pressable
              key={b.index}
              onPress={() => {
                tapHaptic();
                setSelected(b.index);
              }}
              accessibilityRole="button"
              accessibilityLabel={b.accessibilityLabel}
              accessibilityState={{ selected: isSel }}
              style={[
                styles.block,
                {
                  left: `${b.start * 100}%`,
                  width: `${b.width * 100}%`,
                  backgroundColor: color(b.status),
                },
              ]}
            >
              {b.width > 0.07 ? <Icon name={STATUS_ICON[b.status]} size={16} color={onColor(b.status)} /> : null}
              {isSel ? <View style={[styles.selOutline, { borderColor: p.text }]} /> : null}
            </Pressable>
          );
        })}
        <View style={[styles.nowLine, { left: `${model.nowAt * 100}%`, backgroundColor: p.text }]} />
      </View>
      <View style={styles.ticks}>
        {model.ticks.map((t) => (
          <View key={t.label + t.at} style={[styles.tick, { left: `${t.at * 100}%` }]}>
            <View style={[styles.tickMark, { backgroundColor: p.borderStrong }]} />
            <AppText variant="footnote" muted style={styles.tickLabel}>
              {t.label}
            </AppText>
          </View>
        ))}
      </View>
      <View style={[styles.detail, { backgroundColor: p.surfaceAlt }]} accessibilityLiveRegion="polite">
        <View style={[styles.detailSwatch, { backgroundColor: color(sel.status) }]}>
          <Icon name={STATUS_ICON[sel.status]} size={16} color={onColor(sel.status)} />
        </View>
        <View style={{ flex: 1 }}>
          <AppText variant="bodyStrong">{sel.label}</AppText>
          <AppText variant="callout" muted>
            {sel.rangeText} · {STATUS_WORD[sel.status]}
          </AppText>
        </View>
      </View>
      <View style={styles.legend} accessible accessibilityLabel="Legend: green free, amber limited or paid, red not allowed">
        {(["allowed", "limited", "prohibited"] as TimelineStatus[]).map((s) => (
          <View key={s} style={styles.legendItem}>
            <View style={[styles.legendSwatch, { backgroundColor: color(s) }]}>
              <Icon name={STATUS_ICON[s]} size={11} color={onColor(s)} />
            </View>
            <AppText variant="footnote" muted>
              {STATUS_WORD[s]}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

const BAR_H = 36;
const styles = StyleSheet.create({
  nowRow: { height: 22, marginBottom: 4 },
  nowPin: { position: "absolute", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  bar: { height: BAR_H, borderRadius: radius.sm, overflow: "hidden", borderWidth: 1 },
  block: { position: "absolute", top: 0, bottom: 0, alignItems: "center", justifyContent: "center", borderRightWidth: 1, borderRightColor: "rgba(0,0,0,0.25)" },
  selOutline: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderWidth: 3 },
  nowLine: { position: "absolute", top: 0, bottom: 0, width: 3 },
  ticks: { height: 24, marginTop: 2 },
  tick: { position: "absolute", alignItems: "center", width: 60, marginLeft: -30 },
  tickMark: { width: 1.5, height: 6 },
  tickLabel: { fontSize: 12 },
  detail: { flexDirection: "row", gap: space.md, alignItems: "center", padding: space.md, borderRadius: radius.md, marginTop: space.xs },
  detailSwatch: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: space.md, marginTop: space.sm },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendSwatch: { width: 16, height: 16, borderRadius: 4, alignItems: "center", justifyContent: "center" },
});
