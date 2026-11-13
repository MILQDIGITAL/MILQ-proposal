/** Result: the verdict, readable at a glance. Re-evaluated locally every minute. */
import { evaluate, type Side, type Verdict } from "@parking-lingo/core";
import { fixturesById } from "@parking-lingo/core/fixtures";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Linking, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { EvidenceSection } from "../components/EvidenceSection";
import { FactChips } from "../components/FactChips";
import { SideSelector } from "../components/SideSelector";
import { TimelineBar } from "../components/TimelineBar";
import { AppText, Button, Card, Icon, IconButton, SectionTitle } from "../components/ui";
import { VerdictHero } from "../components/VerdictHero";
import { TemporaryBanner, UpcomingTemporaryList, WarningsList } from "../components/Warnings";
import { useNow } from "../hooks/useNow";
import { getDeviceTimeZone, verdictHaptic } from "../lib/device";
import { cancelReminder, scheduleLeaveReminder } from "../lib/notifications";
import { planReminder } from "../logic/reminder";
import { buildVerdictViewModel, dependsOnSide } from "../logic/viewModel";
import { useSettings } from "../state/AppProviders";
import { buildContext } from "../state/settings";
import { demoResult } from "../state/sessions";
import { scanStore, useScanState } from "../state/scanStore";
import { radius, space, usePalette } from "../theme";

export default function ResultScreen() {
  const params = useLocalSearchParams<{ fixture?: string; clock?: string }>();
  const { result } = useScanState();

  // Deep link / web review: /result?fixture=<id>[&clock=now]
  useEffect(() => {
    const f = params.fixture ? fixturesById[params.fixture] : undefined;
    if (f && result?.fixtureId !== f.id) {
      scanStore.setResult(demoResult(f, params.clock !== "now", undefined, getDeviceTimeZone()));
    } else if (!f && !result) {
      router.replace("/");
    }
  }, [params.fixture, params.clock, result]);

  if (!result) return null;
  return <ResultView key={result.id} />;
}

function ResultView() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { result } = useScanState();
  const { settings } = useSettings();
  const [side, setSide] = useState<Side | "unknown">("unknown");
  const [holiday, setHoliday] = useState<boolean | "unknown">("unknown");
  const [reminder, setReminder] = useState<{ id: string; atText: string } | null>(null);
  const [reminderBusy, setReminderBusy] = useState(false);

  const realNow = useNow(1000);
  const nowMs = realNow + (result?.clockOffsetMs ?? 0);
  // Re-evaluate once a minute (and whenever inputs change); countdowns tick every second.
  const minute = Math.floor(nowMs / 60_000) * 60_000;

  const evaluated = useMemo(() => {
    if (!result) return null;
    const ctx = (s: Side | "unknown") =>
      buildContext(settings, { now: minute, timeZone: result.timeZone, side: s, isPublicHoliday: holiday, overrides: result.overrides ?? undefined });
    try {
      const base = evaluate(result.reading, ctx("unknown"));
      const shown: Verdict = side === "unknown" ? base : evaluate(result.reading, ctx(side));
      return { base, shown };
    } catch {
      return result.serverVerdict ? { base: result.serverVerdict, shown: result.serverVerdict } : null;
    }
  }, [result, settings, side, holiday, minute]);

  const vm = useMemo(
    () => (evaluated && result ? buildVerdictViewModel(evaluated.shown, result.reading, nowMs) : null),
    // nowMs changes every second; chips that count down are rendered live from it,
    // so the view model only needs rebuilding per minute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [evaluated, result, minute],
  );

  // Haptic once per distinct answer.
  const lastHaptic = useRef<string | null>(null);
  useEffect(() => {
    if (!vm) return;
    const key = `${vm.tone}|${vm.headline}`;
    if (lastHaptic.current !== key) {
      lastHaptic.current = key;
      verdictHaptic(vm.haptic);
    }
  }, [vm]);

  if (!result || !evaluated || !vm) {
    return (
      <View style={[styles.fill, { backgroundColor: p.background, alignItems: "center", justifyContent: "center", padding: space.xl }]}>
        <AppText variant="title">Couldn&apos;t work this one out</AppText>
        <Button label="Rescan" icon="camera-outline" onPress={() => router.replace("/")} style={{ marginTop: space.lg }} />
      </View>
    );
  }

  const { base, shown } = evaluated;
  const tz = result.timeZone;
  const showSides = base.bySide !== null && (dependsOnSide(base) || side !== "unknown");
  const leaveBy = shown.status === "yes" || shown.status === "yes_with_conditions" ? shown.leaveBy : null;
  const fixture = result.fixtureId ? fixturesById[result.fixtureId] : undefined;
  const local = new Intl.DateTimeFormat("en-AU", { timeZone: tz, hour: "numeric", minute: "2-digit", weekday: "short", hour12: true }).format(new Date(nowMs));

  const rescan = () => {
    scanStore.setPending(null);
    router.dismissTo("/");
  };

  const setReminderAction = async () => {
    if (!leaveBy) return;
    if (reminder) {
      await cancelReminder(reminder.id);
      setReminder(null);
      return;
    }
    if (result.clockOffsetMs !== 0) {
      Alert.alert("Demo time", "This demo runs on a pretend clock, so a real reminder would fire at the wrong time. Open it with the current time to try reminders.");
      return;
    }
    const plan = planReminder(leaveBy, nowMs, settings.reminderLeadMinutes, tz);
    if (!plan) {
      Alert.alert("Too soon for a reminder", "Your time is nearly up — move your car now.");
      return;
    }
    setReminderBusy(true);
    const out = await scheduleLeaveReminder(plan);
    setReminderBusy(false);
    if (out.ok) {
      const at = new Intl.DateTimeFormat("en-AU", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(plan.fireAtMs));
      setReminder({ id: out.id, atText: at });
      verdictHaptic("success");
    } else if (out.reason === "denied") {
      Alert.alert("Notifications are off", out.message, [
        { text: "Not now", style: "cancel" },
        { text: "Open Settings", onPress: () => void Linking.openSettings() },
      ]);
    } else {
      Alert.alert("Couldn't set a reminder", out.message);
    }
  };

  return (
    <View style={[styles.fill, { backgroundColor: p.background }]}>
      <View style={[styles.topBar, { paddingTop: insets.top + space.xs, backgroundColor: p.background }]}>
        <IconButton icon="close" label="Close and rescan" onPress={rescan} color={p.text} background={p.surface} size={44} />
        <View style={styles.topMeta} accessible accessibilityLabel={`${fixture ? `Demo: ${fixture.title}. ` : ""}Checked for ${local}`}>
          <View style={styles.metaLine}>
            {fixture ? (
              <View style={[styles.demoTag, { backgroundColor: p.tone.side.soft }]}>
                <Icon name="flask-outline" size={13} color={p.tone.side.onSoft} />
                <AppText variant="label" color={p.tone.side.onSoft}>
                  DEMO
                </AppText>
              </View>
            ) : null}
            <AppText variant="footnote" style={{ fontWeight: "700" }} numberOfLines={1}>
              {local}
            </AppText>
          </View>
          <AppText variant="footnote" muted numberOfLines={1}>
            {fixture ? fixture.title : result.source === "history" ? "Re-checked from history" : "Just scanned"}
          </AppText>
        </View>
        <IconButton icon="settings-outline" label="Settings" onPress={() => router.push("/settings")} color={p.text} background={p.surface} size={44} />
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: space.xl }]} testID="result-scroll">
        <VerdictHero vm={vm} sideLabel={side === "left" ? "← LEFT OF THE POLE" : side === "right" ? "RIGHT OF THE POLE →" : null} />

        {showSides && base.bySide ? (
          <SideSelector bySide={base.bySide} selected={side} onSelect={setSide} nowMs={nowMs} timeZone={tz} />
        ) : null}

        {vm.temporaryAlert ? <TemporaryBanner alert={vm.temporaryAlert} /> : null}

        <FactChips chips={vm.chips} nowMs={nowMs} />

        {vm.warnings.length ? (
          <View>
            <SectionTitle>Watch out</SectionTitle>
            <WarningsList warnings={vm.warnings} isPublicHoliday={holiday} onSetPublicHoliday={setHoliday} />
          </View>
        ) : null}

        {shown.timeline.length ? (
          <Card>
            <SectionTitle>Next 24 hours</SectionTitle>
            <TimelineBar segments={shown.timeline} nowMs={nowMs} timeZone={tz} />
          </Card>
        ) : null}

        {shown.upcomingTemporary.length && vm.temporaryAlert?.state !== "upcoming" ? (
          <View>
            <SectionTitle>Temporary signs coming up</SectionTitle>
            <UpcomingTemporaryList items={shown.upcomingTemporary} nowMs={nowMs} timeZone={tz} />
          </View>
        ) : shown.upcomingTemporary.length > 1 ? (
          <View>
            <SectionTitle>Temporary signs coming up</SectionTitle>
            <UpcomingTemporaryList items={shown.upcomingTemporary.slice(1)} nowMs={nowMs} timeZone={tz} />
          </View>
        ) : null}

        <EvidenceSection
          reading={result.reading}
          evidence={shown.evidence}
          reasons={shown.reasons}
          photoUri={result.photoUri}
          nowMs={nowMs}
          timeZone={tz}
        />
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + space.sm, backgroundColor: p.surface, borderTopColor: p.border }]}>
        <View style={styles.disclaimer} accessible accessibilityLabel="Guidance only. Always check the sign. Parking Lingo can be wrong.">
          <Icon name="information-circle-outline" size={16} color={p.textMuted} />
          <AppText variant="footnote" muted style={{ flex: 1 }} maxFontSizeMultiplier={1.4}>
            Guidance only — always check the sign. Parking Lingo can be wrong.
          </AppText>
        </View>
        <View style={styles.actions}>
          {leaveBy ? (
            <Button
              label={reminder ? `Reminder set ${reminder.atText}` : "Set a reminder"}
              icon={reminder ? "notifications" : "notifications-outline"}
              variant={reminder ? "secondary" : "primary"}
              onPress={() => void setReminderAction()}
              loading={reminderBusy}
              accessibilityHint={reminder ? "Cancels the reminder" : `Notifies you ${settings.reminderLeadMinutes} minutes before you need to move`}
              style={{ flex: 1.6 }}
              testID="reminder"
            />
          ) : null}
          <Button
            label="Rescan"
            icon="camera-outline"
            variant={leaveBy ? "secondary" : "primary"}
            onPress={rescan}
            style={{ flex: 1 }}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  topBar: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.sm },
  topMeta: { flex: 1, alignItems: "center", gap: 2 },
  metaLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  demoTag: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill },
  content: { paddingHorizontal: space.lg, gap: space.lg },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.lg, paddingTop: space.sm, gap: space.sm },
  disclaimer: { flexDirection: "row", gap: 6, alignItems: "center" },
  actions: { flexDirection: "row", gap: space.sm },
});
