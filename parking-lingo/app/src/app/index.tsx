/** Scan (home): live camera, framing guide, big shutter, library picker and torch. */
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { router, useIsFocused } from "expo-router";
import { useRef, useState } from "react";
import { ActivityIndicator, Alert, Linking, Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BrandMark } from "../components/BrandMark";
import { AppText, Button, Icon, IconButton } from "../components/ui";
import { isApiConfigured } from "../config";
import { tapHaptic } from "../lib/device";
import { preparePhoto } from "../lib/photo";
import { useSettings } from "../state/AppProviders";
import { scanStore } from "../state/scanStore";
import { radius, space, usePalette } from "../theme";

export default function ScanScreen() {
  const [busy, setBusy] = useState(false);

  const handlePhoto = async (uri: string, width: number, height: number, source: "camera" | "library") => {
    setBusy(true);
    try {
      const prepared = await preparePhoto(uri, width, height);
      scanStore.setPending({ uri: prepared.uri, base64: prepared.base64, thumbnail: prepared.thumbnail, source });
      router.push("/analysing");
    } catch (e) {
      Alert.alert("Couldn't use that photo", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const pickFromLibrary = async () => {
    tapHaptic();
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1, allowsEditing: false });
    const asset = res.canceled ? null : res.assets[0];
    if (asset) await handlePhoto(asset.uri, asset.width, asset.height, "library");
  };

  if (Platform.OS === "web") return <WebScan busy={busy} onPick={pickFromLibrary} />;
  return <CameraScan busy={busy} onPhoto={handlePhoto} onPick={pickFromLibrary} />;
}

function TopBar({ dark = true }: { dark?: boolean }) {
  const p = usePalette();
  const color = dark ? "#FFFFFF" : p.text;
  const bg = dark ? "rgba(0,0,0,0.45)" : p.surface;
  return (
    <View style={styles.topBar}>
      <IconButton icon="time-outline" label="Recent scans" onPress={() => router.push("/history")} color={color} background={bg} />
      <IconButton icon="settings-outline" label="Settings" onPress={() => router.push("/settings")} color={color} background={bg} />
    </View>
  );
}

function NotConfiguredBanner() {
  if (isApiConfigured()) return null;
  return (
    <Pressable
      onPress={() => router.push("/demo")}
      accessibilityRole="button"
      accessibilityLabel="No sign-reading server is set up. Try demo mode."
      style={styles.notConfigured}
    >
      <Icon name="flask-outline" size={20} color="#1A1200" />
      <AppText variant="callout" color="#1A1200" style={{ flex: 1, fontWeight: "700" }}>
        No server set up — try demo signs
      </AppText>
      <Icon name="chevron-forward" size={18} color="#1A1200" />
    </Pressable>
  );
}

function CameraScan({
  busy,
  onPhoto,
  onPick,
}: {
  busy: boolean;
  onPhoto: (uri: string, w: number, h: number, source: "camera") => Promise<void>;
  onPick: () => void;
}) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const { settings } = useSettings();
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [ready, setReady] = useState(false);
  const cam = useRef<CameraView>(null);

  if (!permission) {
    return (
      <View style={[styles.fill, styles.center, { backgroundColor: "#000" }]}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  if (!permission.granted) {
    const blocked = !permission.canAskAgain;
    return (
      <View style={[styles.fill, { backgroundColor: p.background, paddingTop: insets.top, paddingBottom: insets.bottom + space.lg }]}>
        <TopBar dark={false} />
        <View style={[styles.permission]}>
          <BrandMark size={84} />
          <AppText variant="title" style={styles.centerText} accessibilityRole="header">
            {blocked ? "Camera access is off" : "Let Parking Lingo see the sign"}
          </AppText>
          <AppText variant="body" muted style={styles.centerText}>
            {blocked
              ? "To scan parking signs, turn on Camera for Parking Lingo in Settings. Photos are only used to read the sign."
              : "We use the camera to photograph the parking sign and tell you if you can park. Photos are only used to read the sign."}
          </AppText>
          <View style={styles.permissionButtons}>
            {blocked ? (
              <Button label="Open Settings" icon="settings-outline" size="lg" onPress={() => void Linking.openSettings()} />
            ) : (
              <Button label="Allow camera" icon="camera-outline" size="lg" onPress={() => void requestPermission()} />
            )}
            <Button label="Choose from photos" icon="images-outline" variant="secondary" onPress={onPick} />
            <Button label="Try a demo sign" icon="flask-outline" variant="ghost" onPress={() => router.push("/demo")} />
          </View>
        </View>
      </View>
    );
  }

  const shoot = async () => {
    if (!cam.current || busy) return;
    tapHaptic();
    try {
      const pic = await cam.current.takePictureAsync({ quality: 0.85, exif: false, shutterSound: false });
      await onPhoto(pic.uri, pic.width, pic.height, "camera");
    } catch (e) {
      Alert.alert("Couldn't take the photo", e instanceof Error ? e.message : "Please try again.");
    }
  };

  return (
    <View style={[styles.fill, { backgroundColor: "#000" }]}>
      {focused ? (
        <CameraView
          ref={cam}
          style={StyleSheet.absoluteFill}
          facing="back"
          enableTorch={torch}
          animateShutter
          onCameraReady={() => setReady(true)}
          accessibilityLabel="Camera viewfinder"
        />
      ) : null}
      <View style={[styles.fill, { paddingTop: insets.top + space.sm, paddingBottom: insets.bottom + space.lg }]} pointerEvents="box-none">
        <TopBar />
        <NotConfiguredBanner />
        <FramingGuide />
        <View style={styles.controls}>
          <IconButton
            icon="images-outline"
            label="Choose from photos"
            onPress={onPick}
            color="#FFFFFF"
            background="rgba(0,0,0,0.5)"
            size={56}
          />
          <Pressable
            onPress={() => void shoot()}
            disabled={!ready || busy}
            accessibilityRole="button"
            accessibilityLabel="Scan sign"
            accessibilityHint="Takes a photo of the parking sign and checks if you can park"
            accessibilityState={{ disabled: !ready || busy, busy }}
            style={({ pressed }) => [styles.shutterOuter, { opacity: !ready ? 0.5 : pressed ? 0.8 : 1 }]}
            testID="shutter"
          >
            <View style={styles.shutterInner}>{busy ? <ActivityIndicator color="#0B1B33" size="large" /> : null}</View>
          </Pressable>
          <IconButton
            icon={torch ? "flash" : "flash-off"}
            label={torch ? "Turn torch off" : "Turn torch on"}
            onPress={() => setTorch((t) => !t)}
            color={torch ? "#1A1200" : "#FFFFFF"}
            background={torch ? "#FFD200" : "rgba(0,0,0,0.5)"}
            size={56}
            selected={torch}
          />
        </View>
        {settings.demoMode || !isApiConfigured() ? (
          <Button label="Demo signs" icon="flask-outline" variant="onDark" onPress={() => router.push("/demo")} style={styles.demoBtn} />
        ) : null}
      </View>
    </View>
  );
}

function FramingGuide() {
  const corner = (pos: object) => <View style={[styles.corner, pos]} />;
  return (
    <View style={styles.guideWrap} pointerEvents="none">
      <View style={styles.guide} accessible={false}>
        {corner({ top: 0, left: 0, borderTopWidth: 5, borderLeftWidth: 5, borderTopLeftRadius: 18 })}
        {corner({ top: 0, right: 0, borderTopWidth: 5, borderRightWidth: 5, borderTopRightRadius: 18 })}
        {corner({ bottom: 0, left: 0, borderBottomWidth: 5, borderLeftWidth: 5, borderBottomLeftRadius: 18 })}
        {corner({ bottom: 0, right: 0, borderBottomWidth: 5, borderRightWidth: 5, borderBottomRightRadius: 18 })}
      </View>
      <View style={styles.hintPill}>
        <AppText variant="headline" color="#FFFFFF" style={{ fontWeight: "800" }}>
          Point at the parking sign
        </AppText>
        <AppText variant="footnote" color="rgba(255,255,255,0.85)">
          Fit every panel on the pole inside the frame
        </AppText>
      </View>
    </View>
  );
}

/** Web (and review builds): no live camera — pick a photo or open a demo sign. */
function WebScan({ busy, onPick }: { busy: boolean; onPick: () => void }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.fill, { backgroundColor: p.background, paddingTop: insets.top + space.sm, paddingBottom: insets.bottom + space.lg }]}>
      <TopBar dark={false} />
      <View style={styles.permission}>
        <BrandMark size={96} />
        <AppText variant="title" style={[styles.centerText, { fontSize: 30, lineHeight: 36 }]} accessibilityRole="header">
          Parking Lingo
        </AppText>
        <AppText variant="body" muted style={styles.centerText}>
          Point your iPhone at a parking sign and know at a glance if you can park. On the web, choose a photo of a sign or try a demo sign.
        </AppText>
        <View style={styles.permissionButtons}>
          <Button label="Try a demo sign" icon="flask-outline" size="lg" onPress={() => router.push("/demo")} />
          <Button label="Choose a photo" icon="images-outline" variant="secondary" onPress={onPick} loading={busy} />
          <Button label="Recent scans" icon="time-outline" variant="ghost" onPress={() => router.push("/history")} />
        </View>
        {!isApiConfigured() ? (
          <AppText variant="footnote" muted style={styles.centerText}>
            No server configured (EXPO_PUBLIC_API_URL) — photo scans will offer demo mode.
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center" },
  centerText: { textAlign: "center" },
  topBar: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: space.lg },
  permission: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: space.xl, gap: space.lg },
  permissionButtons: { alignSelf: "stretch", gap: space.sm, marginTop: space.sm },
  notConfigured: {
    marginHorizontal: space.lg,
    marginTop: space.sm,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: "#FFD200",
  },
  guideWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.lg },
  guide: { width: "72%", aspectRatio: 0.72, maxHeight: "78%" },
  corner: { position: "absolute", width: 44, height: 44, borderColor: "#FFFFFF" },
  hintPill: { backgroundColor: "rgba(0,0,0,0.6)", paddingHorizontal: space.lg, paddingVertical: space.sm, borderRadius: radius.lg, alignItems: "center" },
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "space-evenly", paddingHorizontal: space.lg },
  shutterOuter: { width: 88, height: 88, borderRadius: 44, borderWidth: 6, borderColor: "#FFFFFF", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.15)" },
  shutterInner: { width: 66, height: 66, borderRadius: 33, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  demoBtn: { alignSelf: "center", marginTop: space.md, minHeight: 44 },
});
