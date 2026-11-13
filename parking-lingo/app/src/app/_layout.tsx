import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { useColorScheme } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { intlSupport } from "../logic/intlCheck";
import { AppProviders } from "../state/AppProviders";
import { dark, light } from "../theme";

export default function RootLayout() {
  const scheme = useColorScheme();
  const p = scheme === "dark" ? dark : light;

  useEffect(() => {
    const r = intlSupport();
    if (!r.ok) console.warn(`[parking-lingo] Intl time-zone support check failed: ${r.detail}`);
  }, []);

  const navTheme = scheme === "dark" ? DarkTheme : DefaultTheme;
  return (
    <SafeAreaProvider>
      <AppProviders>
        <ThemeProvider value={{ ...navTheme, colors: { ...navTheme.colors, background: p.background, card: p.surface, text: p.text, primary: p.focus, border: p.border } }}>
          <StatusBar style="auto" />
          <Stack
            screenOptions={{
              headerTintColor: p.text,
              headerStyle: { backgroundColor: p.surface },
              headerTitleStyle: { fontWeight: "800" },
              contentStyle: { backgroundColor: p.background },
              headerBackButtonDisplayMode: "minimal",
            }}
          >
            <Stack.Screen name="index" options={{ headerShown: false, title: "Scan" }} />
            <Stack.Screen name="analysing" options={{ headerShown: false, gestureEnabled: false, animation: "fade" }} />
            <Stack.Screen name="result" options={{ headerShown: false, title: "Result" }} />
            <Stack.Screen name="settings" options={{ title: "Settings", presentation: "modal" }} />
            <Stack.Screen name="demo" options={{ title: "Demo signs" }} />
            <Stack.Screen name="history" options={{ title: "Recent scans" }} />
          </Stack>
        </ThemeProvider>
      </AppProviders>
    </SafeAreaProvider>
  );
}
