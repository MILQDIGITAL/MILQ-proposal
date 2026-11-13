import * as Haptics from "expo-haptics";
import { getCalendars } from "expo-localization";
import { Platform } from "react-native";

const FALLBACK_TIME_ZONE = "Australia/Sydney";

/** The device's IANA time zone (expo-localization, then Intl, then Sydney). */
export function getDeviceTimeZone(): string {
  try {
    const tz = getCalendars()[0]?.timeZone;
    if (tz) return tz;
  } catch {
    /* fall through */
  }
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) return tz;
  } catch {
    /* fall through */
  }
  return FALLBACK_TIME_ZONE;
}

export function verdictHaptic(kind: "success" | "warning" | "error") {
  if (Platform.OS === "web") return;
  const type =
    kind === "success"
      ? Haptics.NotificationFeedbackType.Success
      : kind === "warning"
        ? Haptics.NotificationFeedbackType.Warning
        : Haptics.NotificationFeedbackType.Error;
  Haptics.notificationAsync(type).catch(() => undefined);
}

export function tapHaptic() {
  if (Platform.OS === "web") return;
  Haptics.selectionAsync().catch(() => undefined);
}
