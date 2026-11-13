import { useEffect, useState } from "react";
import { AppState } from "react-native";

/**
 * Current time, ticking every `intervalMs` (aligned to the interval boundary) and
 * refreshed immediately when the app returns to the foreground.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(Date.now());
      timer = setTimeout(tick, intervalMs - (Date.now() % intervalMs) + 5);
    };
    timer = setTimeout(tick, intervalMs - (Date.now() % intervalMs) + 5);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") setNow(Date.now());
    });
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, [intervalMs]);
  return now;
}
