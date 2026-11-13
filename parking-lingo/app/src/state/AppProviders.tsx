/** Settings + history persisted with AsyncStorage, exposed through React context. */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { addToHistory, HISTORY_STORAGE_KEY, parseStoredHistory, type HistoryEntry } from "./history";
import { DEFAULT_SETTINGS, parseStoredSettings, SETTINGS_STORAGE_KEY, type Settings } from "./settings";

interface SettingsCtx {
  settings: Settings;
  loaded: boolean;
  update: (patch: Partial<Settings>) => void;
}

interface HistoryCtx {
  entries: HistoryEntry[];
  add: (entry: HistoryEntry) => void;
  remove: (id: string) => void;
  clear: () => void;
}

const SettingsContext = createContext<SettingsCtx | null>(null);
const HistoryContext = createContext<HistoryCtx | null>(null);

async function safeGet(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string) {
  AsyncStorage.setItem(key, value).catch(() => {
    /* storage full/unavailable: keep working in memory */
  });
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const historyLoaded = useRef(false);

  useEffect(() => {
    let alive = true;
    void Promise.all([safeGet(SETTINGS_STORAGE_KEY), safeGet(HISTORY_STORAGE_KEY)]).then(([s, h]) => {
      if (!alive) return;
      setSettings(parseStoredSettings(s));
      // Merge in case a scan was added before storage finished loading.
      setEntries((cur) => {
        let merged = parseStoredHistory(h);
        for (const e of [...cur].reverse()) merged = addToHistory(merged, e);
        return merged;
      });
      historyLoaded.current = true;
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((cur) => {
      const next = { ...cur, ...patch };
      safeSet(SETTINGS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const persistHistory = (list: HistoryEntry[]) => {
    if (historyLoaded.current) safeSet(HISTORY_STORAGE_KEY, JSON.stringify(list));
  };

  const add = useCallback((entry: HistoryEntry) => {
    setEntries((cur) => {
      const next = addToHistory(cur, entry);
      persistHistory(next);
      return next;
    });
  }, []);
  const remove = useCallback((id: string) => {
    setEntries((cur) => {
      const next = cur.filter((e) => e.id !== id);
      persistHistory(next);
      return next;
    });
  }, []);
  const clear = useCallback(() => {
    setEntries([]);
    persistHistory([]);
  }, []);

  const settingsValue = useMemo(() => ({ settings, loaded, update }), [settings, loaded, update]);
  const historyValue = useMemo(() => ({ entries, add, remove, clear }), [entries, add, remove, clear]);

  return (
    <SettingsContext.Provider value={settingsValue}>
      <HistoryContext.Provider value={historyValue}>{children}</HistoryContext.Provider>
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsCtx {
  const c = useContext(SettingsContext);
  if (!c) throw new Error("useSettings must be used inside AppProviders");
  return c;
}

export function useHistory(): HistoryCtx {
  const c = useContext(HistoryContext);
  if (!c) throw new Error("useHistory must be used inside AppProviders");
  return c;
}
