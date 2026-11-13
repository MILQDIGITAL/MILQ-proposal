/** Analysing: frozen photo + progress; cancellable; friendly errors with retry. */
import { evaluate } from "@parking-lingo/core";
import { fixturesById } from "@parking-lingo/core/fixtures";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, Image, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { readSign } from "../api/client";
import { AppError, errorCopy, errorFromReading, errorFromThrown, type ErrorAction } from "../api/errors";
import { AppText, Button, Icon } from "../components/ui";
import { config } from "../config";
import { getDeviceTimeZone, verdictHaptic } from "../lib/device";
import { intlSupport } from "../logic/intlCheck";
import { useHistory, useSettings } from "../state/AppProviders";
import { buildContext, buildServerContext } from "../state/settings";
import { newScanId, scanStore, useScanState } from "../state/scanStore";
import { demoResult } from "../state/sessions";
import { radius, space, usePalette } from "../theme";

const STEPS = ["Reading the sign…", "Checking days and times…", "Working out your answer…"];

export default function AnalysingScreen() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { pending } = useScanState();
  const { settings } = useSettings();
  const history = useHistory();
  const [error, setError] = useState<AppError | null>(null);
  const [step, setStep] = useState(0);
  const [slow, setSlow] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [scanLine] = useState(() => new Animated.Value(0));

  const run = useCallback(async () => {
    if (!pending) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const timeZone = getDeviceTimeZone();
    const started = Date.now();
    const stepTimer = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 2500);
    const slowTimer = setTimeout(() => setSlow(true), config.slowAfterMs);
    try {
      const res = await readSign(
        { image: { base64: pending.base64, mediaType: "image/jpeg" }, context: buildServerContext(settings, { now: started, timeZone }) },
        {
          baseUrl: config.apiUrl,
          appToken: config.appToken,
          timeoutMs: config.requestTimeoutMs,
          signal: controller.signal,
          mockFixture: config.mockFixture,
          mockDemoTime: config.mockDemoTime,
        },
      );
      if (controller.signal.aborted) return;
      const readingError = errorFromReading(res.reading);
      if (readingError) throw readingError;

      const id = res.requestId ?? newScanId();
      let status = res.verdict?.status ?? "unsure";
      let headline = res.verdict?.headline ?? "";
      if (intlSupport().ok) try {
        const v = evaluate(res.reading, buildContext(settings, { now: Date.now(), timeZone }));
        status = v.status;
        headline = v.headline;
      } catch {
        /* keep server verdict */
      }
      history.add({
        id,
        scannedAt: new Date(started).toISOString(),
        timeZone,
        reading: res.reading,
        thumbnail: pending.thumbnail,
        statusAtScan: status,
        headlineAtScan: headline,
        fixtureId: res.meta?.mock?.fixtureId ?? null,
        requestId: res.requestId,
      });
      // Mock server answering at a fixture's demo time: run the same demo clock locally.
      const mockFixture = config.mockDemoTime && res.meta?.mock?.fixtureId ? fixturesById[res.meta.mock.fixtureId] : undefined;
      const demo = mockFixture ? demoResult(mockFixture, true, undefined, timeZone) : null;
      scanStore.setResult({
        id,
        source: pending.source,
        reading: res.reading,
        serverVerdict: res.verdict,
        requestId: res.requestId,
        photoUri: pending.uri,
        thumbnail: pending.thumbnail,
        timeZone: demo?.timeZone ?? timeZone,
        scannedAt: new Date(started).toISOString(),
        clockOffsetMs: demo?.clockOffsetMs ?? 0,
        overrides: demo?.overrides ?? null,
        fixtureId: null,
      });
      router.replace("/result");
    } catch (e) {
      const err = errorFromThrown(e, null);
      if (err.code === "cancelled") return;
      verdictHaptic("error");
      setError(err);
    } finally {
      clearInterval(stepTimer);
      clearTimeout(slowTimer);
    }
  }, [pending, settings, history]);

  useEffect(() => {
    if (!pending) {
      router.replace("/");
      return;
    }
    // Deferred a tick so a StrictMode double-mount doesn't send two requests.
    const t = setTimeout(() => void run(), 0);
    return () => {
      clearTimeout(t);
      abortRef.current?.abort();
    };
    // Run once per photo; retries call run() directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLine, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(scanLine, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [scanLine]);

  const cancel = () => {
    abortRef.current?.abort();
    scanStore.setPending(null);
    router.dismissTo("/");
  };

  const act = (a: ErrorAction) => {
    if (a === "retry") {
      setError(null);
      setStep(0);
      setSlow(false);
      void run();
    }
    else if (a === "rescan") cancel();
    else if (a === "demo") router.replace("/demo");
    else if (a === "settings") router.replace("/settings");
  };
  const actionLabel: Record<ErrorAction, string> = { retry: "Try again", rescan: "Rescan", demo: "Try demo signs", settings: "Settings", none: "" };
  const actionIcon: Record<ErrorAction, string> = { retry: "refresh", rescan: "camera-outline", demo: "flask-outline", settings: "settings-outline", none: "" };

  const copy = error ? errorCopy(error) : null;

  return (
    <View style={[styles.fill, { backgroundColor: "#000" }]}>
      {pending ? <Image source={{ uri: pending.uri }} style={[StyleSheet.absoluteFill, { opacity: error ? 0.35 : 0.7 }]} resizeMode="cover" accessibilityIgnoresInvertColors /> : null}
      {!error ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.scanLine,
            { transform: [{ translateY: scanLine.interpolate({ inputRange: [0, 1], outputRange: [120, 560] }) }] },
          ]}
        />
      ) : null}
      <View style={[styles.fill, { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.lg, paddingHorizontal: space.lg }]}>
        <View style={{ flex: 1 }} />
        {copy && error ? (
          <View style={[styles.card, { backgroundColor: p.surface }]} accessibilityRole="alert" testID="analysing-error">
            <View style={[styles.errIcon, { backgroundColor: p.tone.unsure.soft }]}>
              <Icon name={copy.icon} size={34} color={p.tone.unsure.onSoft} />
            </View>
            <AppText variant="title" style={styles.center}>
              {copy.title}
            </AppText>
            <AppText variant="body" muted style={styles.center}>
              {copy.message}
            </AppText>
            {error.requestId ? (
              <AppText variant="footnote" muted style={styles.center} selectable>
                Ref {error.requestId.slice(0, 8)}
              </AppText>
            ) : null}
            <View style={{ alignSelf: "stretch", gap: space.sm, marginTop: space.sm }}>
              <Button label={actionLabel[copy.primary]} icon={actionIcon[copy.primary]} size="lg" onPress={() => act(copy.primary)} />
              {copy.secondary !== "none" ? (
                <Button label={actionLabel[copy.secondary]} icon={actionIcon[copy.secondary]} variant="secondary" onPress={() => act(copy.secondary)} />
              ) : null}
            </View>
          </View>
        ) : (
          <View style={[styles.card, { backgroundColor: p.surface }]} accessibilityLiveRegion="polite">
            <ActivityIndicator size="large" color={p.text} />
            <AppText variant="title" style={styles.center} accessibilityRole="header">
              {STEPS[step]}
            </AppText>
            <AppText variant="callout" muted style={styles.center}>
              {slow ? "Taking longer than usual — hang tight, or cancel and try again." : "This usually takes a few seconds."}
            </AppText>
            <Button label="Cancel" icon="close" variant="secondary" onPress={cancel} style={{ alignSelf: "stretch", marginTop: space.sm }} />
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { textAlign: "center" },
  card: { borderRadius: radius.xl, padding: space.xl, alignItems: "center", gap: space.md },
  errIcon: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center" },
  scanLine: { position: "absolute", left: "10%", right: "10%", height: 4, borderRadius: 2, backgroundColor: "#22C55E", shadowColor: "#22C55E", shadowOpacity: 0.9, shadowRadius: 12 },
});
