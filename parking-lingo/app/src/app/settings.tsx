/** Settings (persisted): permits, disability permit, vehicle, EV, reminder lead, demo mode. */
import { normalisePermit, type VehicleType } from "@parking-lingo/core";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from "react-native";
import { AppText, Button, Card, Icon, SectionTitle } from "../components/ui";
import { config } from "../config";
import { getDeviceTimeZone, tapHaptic } from "../lib/device";
import { intlSupport } from "../logic/intlCheck";
import { useSettings } from "../state/AppProviders";
import { dedupePermits, parsePermitInput, REMINDER_LEAD_OPTIONS, VEHICLE_LABEL, VEHICLE_TYPES } from "../state/settings";
import { radius, space, usePalette } from "../theme";

function ToggleRow({ title, detail, value, onChange }: { title: string; detail?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.toggleRow}>
      <View style={{ flex: 1 }}>
        <AppText variant="bodyStrong">{title}</AppText>
        {detail ? (
          <AppText variant="footnote" muted>
            {detail}
          </AppText>
        ) : null}
      </View>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={title} />
    </View>
  );
}

function Segmented<T extends string | number>({ options, value, onChange, label }: { options: { v: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  const p = usePalette();
  return (
    <View style={styles.segments} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((o) => {
        const sel = o.v === value;
        return (
          <Pressable
            key={String(o.v)}
            onPress={() => {
              tapHaptic();
              onChange(o.v);
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected: sel, checked: sel }}
            accessibilityLabel={o.label}
            style={[styles.segment, { backgroundColor: sel ? p.accent : p.surface, borderColor: sel ? p.accent : p.borderStrong }]}
          >
            <AppText variant="callout" color={sel ? p.onAccent : p.text} style={{ fontWeight: "700" }}>
              {o.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function SettingsScreen() {
  const p = usePalette();
  const { settings, update } = useSettings();
  const [permitText, setPermitText] = useState("");
  const intl = intlSupport();

  const addPermits = () => {
    const add = parsePermitInput(permitText);
    if (add.length) update({ permits: dedupePermits([...settings.permits, ...add]) });
    setPermitText("");
  };

  return (
    <ScrollView style={{ backgroundColor: p.background }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View>
        <SectionTitle>Permits</SectionTitle>
        <Card style={{ gap: space.md }}>
          <AppText variant="callout" muted>
            Residential/area permits you hold. Signs saying “Permit holders excepted, Area 12” then don&apos;t apply to you.
          </AppText>
          <View style={styles.permitList}>
            {settings.permits.length === 0 ? (
              <AppText variant="callout" muted>
                No permits added.
              </AppText>
            ) : (
              settings.permits.map((code) => (
                <Pressable
                  key={code}
                  onPress={() => update({ permits: settings.permits.filter((c) => c !== code) })}
                  accessibilityRole="button"
                  accessibilityLabel={`Permit area ${code}. Double tap to remove.`}
                  style={[styles.permitChip, { backgroundColor: p.tone.side.soft, borderColor: p.tone.side.fill }]}
                >
                  <AppText variant="bodyStrong" color={p.tone.side.onSoft}>
                    Area {normalisePermit(code)}
                  </AppText>
                  <Icon name="close" size={18} color={p.tone.side.onSoft} />
                </Pressable>
              ))
            )}
          </View>
          <View style={styles.permitInputRow}>
            <TextInput
              value={permitText}
              onChangeText={setPermitText}
              onSubmitEditing={addPermits}
              placeholder="Area code, e.g. 12"
              placeholderTextColor={p.textMuted}
              autoCapitalize="characters"
              returnKeyType="done"
              accessibilityLabel="Add permit area code"
              style={[styles.input, { color: p.text, borderColor: p.borderStrong, backgroundColor: p.surface }]}
            />
            <Button label="Add" icon="add" onPress={addPermits} disabled={!permitText.trim()} />
          </View>
          <ToggleRow
            title="Disability parking permit"
            detail="Lets you use disability bays. State time concessions aren't applied."
            value={settings.hasDisabilityPermit}
            onChange={(v) => update({ hasDisabilityPermit: v })}
          />
        </Card>
      </View>

      <View>
        <SectionTitle>Vehicle</SectionTitle>
        <Card style={{ gap: space.md }}>
          <Segmented<VehicleType>
            label="Vehicle type"
            options={VEHICLE_TYPES.map((v) => ({ v, label: VEHICLE_LABEL[v] }))}
            value={settings.vehicleType}
            onChange={(v) => update({ vehicleType: v })}
          />
          <ToggleRow
            title="Electric vehicle"
            detail="Counts EV charging bays as allowed while charging."
            value={settings.isElectricVehicle}
            onChange={(v) => update({ isElectricVehicle: v })}
          />
        </Card>
      </View>

      <View>
        <SectionTitle>Reminders</SectionTitle>
        <Card style={{ gap: space.md }}>
          <AppText variant="callout" muted>
            How long before “leave by” to remind you.
          </AppText>
          <Segmented<number>
            label="Reminder lead time"
            options={REMINDER_LEAD_OPTIONS.map((m) => ({ v: m, label: `${m} min` }))}
            value={settings.reminderLeadMinutes}
            onChange={(m) => update({ reminderLeadMinutes: m })}
          />
        </Card>
      </View>

      <View>
        <SectionTitle>Demo</SectionTitle>
        <Card style={{ gap: space.md }}>
          <ToggleRow
            title="Demo mode"
            detail="Show a “Demo signs” button on the scan screen. Works without a server or camera."
            value={settings.demoMode}
            onChange={(v) => update({ demoMode: v })}
          />
          <Button label="Browse demo signs" icon="flask-outline" variant="secondary" onPress={() => router.push("/demo")} />
        </Card>
      </View>

      <View>
        <SectionTitle>About</SectionTitle>
        <Card style={{ gap: 6 }}>
          <AppText variant="callout">
            Parking Lingo gives guidance only. Always read the sign — the app can misread signs or miss local rules.
          </AppText>
          <AppText variant="footnote" muted>
            Server: {config.apiUrl ?? "not configured (demo only)"}
          </AppText>
          <AppText variant="footnote" muted>
            Time zone: {getDeviceTimeZone()} · {intl.ok ? "time-zone support OK" : `time-zone check failed: ${intl.detail}`}
          </AppText>
        </Card>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxxl },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 44 },
  segments: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  segment: { minHeight: 44, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1.5, justifyContent: "center" },
  permitList: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  permitChip: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1.5 },
  permitInputRow: { flexDirection: "row", gap: space.sm, alignItems: "center" },
  input: { flex: 1, minHeight: 52, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: space.md, fontSize: 17 },
});
