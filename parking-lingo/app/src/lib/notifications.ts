/**
 * Local "move your car" reminders. Permission is requested only when the user taps
 * "Set a reminder", never at launch.
 */
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import type { ReminderPlan } from "../logic/reminder";

let handlerSet = false;
function ensureHandler() {
  if (handlerSet || Platform.OS === "web") return;
  handlerSet = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

export type ScheduleOutcome =
  | { ok: true; id: string }
  | { ok: false; reason: "unsupported" | "denied" | "error"; message: string };

export const remindersSupported = Platform.OS !== "web";

export async function scheduleLeaveReminder(plan: ReminderPlan): Promise<ScheduleOutcome> {
  if (!remindersSupported) {
    return { ok: false, reason: "unsupported", message: "Reminders work in the iPhone app." };
  }
  try {
    ensureHandler();
    let perm = await Notifications.getPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) {
      return { ok: false, reason: "denied", message: "Turn on notifications for Parking Lingo in Settings to get reminders." };
    }
    const id = await Notifications.scheduleNotificationAsync({
      content: { title: plan.title, body: plan.body, sound: true },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(plan.fireAtMs) },
    });
    return { ok: true, id };
  } catch (e) {
    return { ok: false, reason: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

export async function cancelReminder(id: string) {
  if (!remindersSupported) return;
  await Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined);
}
