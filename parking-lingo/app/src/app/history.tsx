/** Recent scans (local only). Re-opening re-evaluates for the current time. */
import { router } from "expo-router";
import { Alert, FlatList, Image, Pressable, StyleSheet, View } from "react-native";
import { AppText, Button, Icon } from "../components/ui";
import { tapHaptic } from "../lib/device";
import { toneFor } from "../logic/viewModel";
import { useHistory } from "../state/AppProviders";
import { historyResult } from "../state/sessions";
import { scanStore } from "../state/scanStore";
import { radius, space, usePalette } from "../theme";

function when(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-AU", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export default function HistoryScreen() {
  const p = usePalette();
  const { entries, remove, clear } = useHistory();

  if (entries.length === 0) {
    return (
      <View style={[styles.empty, { backgroundColor: p.background }]}>
        <Icon name="time-outline" size={48} color={p.textMuted} />
        <AppText variant="title">No scans yet</AppText>
        <AppText variant="body" muted style={{ textAlign: "center" }}>
          Your last 20 scans are kept on this phone so you can re-check them later.
        </AppText>
        <Button label="Scan a sign" icon="camera-outline" onPress={() => router.dismissTo("/")} style={{ alignSelf: "stretch" }} />
      </View>
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: p.background }}
      contentContainerStyle={styles.list}
      data={entries}
      keyExtractor={(e) => e.id}
      ListFooterComponent={
        <Button
          label="Clear history"
          icon="trash-outline"
          variant="ghost"
          onPress={() =>
            Alert.alert("Clear all recent scans?", "This removes them from this phone.", [
              { text: "Cancel", style: "cancel" },
              { text: "Clear", style: "destructive", onPress: clear },
            ])
          }
          style={{ marginTop: space.md }}
        />
      }
      renderItem={({ item }) => {
        const c = p.tone[toneFor(item.statusAtScan, item.headlineAtScan === "Depends on side")];
        return (
          <Pressable
            onPress={() => {
              tapHaptic();
              scanStore.setResult(historyResult(item));
              router.push("/result");
            }}
            onLongPress={() =>
              Alert.alert("Remove this scan?", undefined, [
                { text: "Cancel", style: "cancel" },
                { text: "Remove", style: "destructive", onPress: () => remove(item.id) },
              ])
            }
            accessibilityRole="button"
            accessibilityLabel={`Scan from ${when(item.scannedAt, item.timeZone)}. At the time: ${item.headlineAtScan}`}
            accessibilityHint="Opens it re-checked for the current time. Long press to remove."
            style={({ pressed }) => [styles.row, { backgroundColor: p.surface, borderColor: p.border, opacity: pressed ? 0.85 : 1 }]}
          >
            {item.thumbnail ? (
              <Image source={{ uri: item.thumbnail }} style={styles.thumb} />
            ) : (
              <View style={[styles.thumb, { backgroundColor: p.surfaceAlt, alignItems: "center", justifyContent: "center" }]}>
                <Icon name="flask-outline" size={22} color={p.textMuted} />
              </View>
            )}
            <View style={{ flex: 1, gap: 2 }}>
              <AppText variant="footnote" muted>
                {when(item.scannedAt, item.timeZone)}
              </AppText>
              <View style={[styles.badge, { backgroundColor: c.fill }]}>
                <AppText variant="label" color={c.onFill}>
                  {item.headlineAtScan || "Scan"}
                </AppText>
              </View>
              <AppText variant="footnote" muted>
                At scan time · tap to re-check now
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
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl, gap: space.md },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.sm, borderRadius: radius.lg, borderWidth: 1, minHeight: 80 },
  thumb: { width: 64, height: 64, borderRadius: radius.md },
  badge: { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
});
