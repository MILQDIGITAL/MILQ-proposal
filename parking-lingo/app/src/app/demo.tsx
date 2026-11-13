/** Demo mode: open any core fixture as a result — no camera or server needed. */
import { evaluate } from "@parking-lingo/core";
import { fixtures, type SignFixture } from "@parking-lingo/core/fixtures";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Switch, View } from "react-native";
import { AppText, Icon } from "../components/ui";
import { useNow } from "../hooks/useNow";
import { getDeviceTimeZone, tapHaptic } from "../lib/device";
import { toneFor } from "../logic/viewModel";
import { useSettings } from "../state/AppProviders";
import { buildContext } from "../state/settings";
import { demoResult } from "../state/sessions";
import { scanStore } from "../state/scanStore";
import { radius, space, usePalette } from "../theme";

export default function DemoScreen() {
  const p = usePalette();
  const { settings } = useSettings();
  const [useDemoClock, setUseDemoClock] = useState(true);
  const deviceTz = getDeviceTimeZone();
  const nowMinute = useNow(60_000);

  const rows = useMemo(
    () =>
      fixtures.map((f) => {
        const { now, timeZone, ...overrides } = f.demoContext;
        try {
          const v = evaluate(
            f.reading,
            buildContext(settings, { now: useDemoClock ? now : nowMinute, timeZone: useDemoClock ? timeZone : deviceTz, overrides }),
          );
          return { f, tone: toneFor(v.status, v.needsSide), headline: v.headline };
        } catch {
          return { f, tone: "unsure" as const, headline: "—" };
        }
      }),
    [settings, useDemoClock, deviceTz, nowMinute],
  );

  const open = (f: SignFixture) => {
    tapHaptic();
    scanStore.setResult(demoResult(f, useDemoClock, undefined, deviceTz));
    router.push("/result");
  };

  return (
    <FlatList
      style={{ backgroundColor: p.background }}
      contentContainerStyle={styles.list}
      data={rows}
      keyExtractor={(r) => r.f.id}
      ListHeaderComponent={
        <View style={{ gap: space.md, marginBottom: space.sm }}>
          <AppText variant="body" muted>
            Real Australian sign setups, read exactly as the server would. Pick one to see its result screen.
          </AppText>
          <View style={[styles.toggle, { backgroundColor: p.surface, borderColor: p.border }]}>
            <View style={{ flex: 1 }}>
              <AppText variant="bodyStrong">Use each sign&apos;s demo time</AppText>
              <AppText variant="footnote" muted>
                {useDemoClock ? "Shows the interesting moment (e.g. weekday 1:30 pm)." : "Evaluates at the current time on this device."}
              </AppText>
            </View>
            <Switch value={useDemoClock} onValueChange={setUseDemoClock} accessibilityLabel="Use each sign's demo time" />
          </View>
        </View>
      }
      renderItem={({ item }) => {
        const c = p.tone[item.tone];
        return (
          <Pressable
            onPress={() => open(item.f)}
            accessibilityRole="button"
            accessibilityLabel={`${item.f.title}. ${item.headline}`}
            accessibilityHint={item.f.description}
            style={({ pressed }) => [styles.row, { backgroundColor: p.surface, borderColor: p.border, opacity: pressed ? 0.85 : 1 }]}
            testID={`fixture-${item.f.id}`}
          >
            <View style={[styles.swatch, { backgroundColor: c.fill }]}>
              <Icon
                name={item.tone === "yes" ? "checkmark" : item.tone === "no" ? "close" : item.tone === "conditional" ? "alert" : item.tone === "side" ? "swap-horizontal" : "help"}
                size={22}
                color={c.onFill}
              />
            </View>
            <View style={{ flex: 1 }}>
              <AppText variant="bodyStrong">{item.f.title}</AppText>
              <AppText variant="footnote" muted numberOfLines={2}>
                {item.f.description}
              </AppText>
              <AppText variant="callout" color={c.onSoft} style={{ fontWeight: "700", marginTop: 2 }}>
                {item.headline}
              </AppText>
            </View>
            <Icon name="chevron-forward" size={20} color={p.textMuted} />
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: space.lg, gap: space.sm },
  toggle: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: 1, minHeight: 56 },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: 1, minHeight: 72 },
  swatch: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
});
