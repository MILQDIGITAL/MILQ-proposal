import type { PanelKind, SignPanel } from "@parking-lingo/core";
import { StyleSheet, View } from "react-native";
import { AppText } from "./ui";

const GREEN_KINDS: PanelKind[] = ["timed_parking", "permit_zone", "motorcycle_only", "car_share", "ev_charging"];

/**
 * A small schematic of one panel as read (Australian colours: green = parking allowed,
 * red = restriction, blue = disability, yellow = temporary). Lets the user compare
 * what we read with the real sign at a glance.
 */
export function SignPlate({ panel, width = 132 }: { panel: SignPanel; width?: number }) {
  const ink = panel.temporary ? "#111111" : panel.kind === "disabled_only" ? "#0B4FB3" : GREEN_KINDS.includes(panel.kind) ? "#0A7A3A" : "#C8102E";
  const bg = panel.temporary ? "#FFD200" : "#FFFFFF";
  const lines = (panel.rawText || "(no text read)").split(/\s*\/\s*/).filter(Boolean);
  return (
    <View style={[styles.plate, { width, backgroundColor: bg, borderColor: panel.temporary ? "#111111" : "#30363D" }]} accessible={false}>
      <View style={[styles.inner, { borderColor: ink }]}>
        {lines.map((line, i) => (
          <AppText
            key={i}
            color={ink}
            style={[styles.line, i === 0 && styles.first]}
            numberOfLines={2}
            maxFontSizeMultiplier={1.2}
          >
            {line}
          </AppText>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  plate: { borderRadius: 6, borderWidth: 1, padding: 3 },
  inner: { borderWidth: 2, borderRadius: 4, paddingVertical: 6, paddingHorizontal: 4, alignItems: "center", gap: 1 },
  line: { fontSize: 11, lineHeight: 13, fontWeight: "800", textAlign: "center", letterSpacing: 0.3 },
  first: { fontSize: 16, lineHeight: 19, fontWeight: "900" },
});
