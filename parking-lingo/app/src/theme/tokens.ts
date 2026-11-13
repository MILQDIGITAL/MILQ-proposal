/**
 * Design tokens. Verdict colours are chosen for outdoor legibility: saturated fills
 * with text that clears WCAG AA (≥ 4.5:1) — amber uses near-black text, the others white.
 * Colour is never the only signal: every tone also has an icon and a word.
 */
export type Tone = "yes" | "conditional" | "no" | "unsure" | "side";

export interface ToneColors {
  /** Solid fill for the hero. */
  fill: string;
  /** Text/icons on `fill`. */
  onFill: string;
  /** Tinted background for chips/cards. */
  soft: string;
  /** Text/icons on `soft`, and accent strokes. */
  onSoft: string;
}

export interface Palette {
  scheme: "light" | "dark";
  background: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  textMuted: string;
  border: string;
  borderStrong: string;
  accent: string;
  onAccent: string;
  focus: string;
  tone: Record<Tone, ToneColors>;
  /** Roadworks / temporary-sign treatment (yellow + black like real temporary signs). */
  temporary: { fill: string; onFill: string; stripe: string };
  timeline: { allowed: string; limited: string; prohibited: string; track: string };
  camera: { overlay: string; guide: string; text: string };
}

const verdictTones: Record<Tone, ToneColors> = {
  yes: { fill: "#0B7A3B", onFill: "#FFFFFF", soft: "#E2F4E9", onSoft: "#075C2C" },
  conditional: { fill: "#FFB81C", onFill: "#1A1200", soft: "#FFF2CF", onSoft: "#6B4A00" },
  no: { fill: "#C8102E", onFill: "#FFFFFF", soft: "#FCE4E7", onSoft: "#9A0B22" },
  unsure: { fill: "#46607E", onFill: "#FFFFFF", soft: "#E5ECF4", onSoft: "#2E4560" },
  side: { fill: "#1F4FD1", onFill: "#FFFFFF", soft: "#E3EAFD", onSoft: "#173D9F" },
};

export const light: Palette = {
  scheme: "light",
  background: "#F2F4F7",
  surface: "#FFFFFF",
  surfaceAlt: "#E9EDF2",
  text: "#0A1220",
  textMuted: "#4A5566",
  border: "#D3D9E2",
  borderStrong: "#9AA5B5",
  accent: "#0B1B33",
  onAccent: "#FFFFFF",
  focus: "#1F4FD1",
  tone: verdictTones,
  temporary: { fill: "#FFD200", onFill: "#111111", stripe: "#111111" },
  timeline: { allowed: "#0B7A3B", limited: "#FFB81C", prohibited: "#C8102E", track: "#D3D9E2" },
  camera: { overlay: "rgba(0,0,0,0.45)", guide: "#FFFFFF", text: "#FFFFFF" },
};

export const dark: Palette = {
  scheme: "dark",
  background: "#070B12",
  surface: "#121925",
  surfaceAlt: "#1B2433",
  text: "#F3F6FA",
  textMuted: "#A9B4C4",
  border: "#2A3546",
  borderStrong: "#4A586D",
  accent: "#F3F6FA",
  onAccent: "#0A1220",
  focus: "#7FA2FF",
  tone: {
    yes: { fill: "#0E8A44", onFill: "#FFFFFF", soft: "#0F2E1C", onSoft: "#8EE0B0" },
    conditional: { fill: "#FFB81C", onFill: "#1A1200", soft: "#33270A", onSoft: "#FFD67A" },
    no: { fill: "#D3132F", onFill: "#FFFFFF", soft: "#3A1016", onSoft: "#FF9AA8" },
    unsure: { fill: "#4D6888", onFill: "#FFFFFF", soft: "#1A2738", onSoft: "#A9C1DE" },
    side: { fill: "#2B5BE0", onFill: "#FFFFFF", soft: "#152349", onSoft: "#A9BEFF" },
  },
  temporary: { fill: "#FFD200", onFill: "#111111", stripe: "#111111" },
  timeline: { allowed: "#14A057", limited: "#FFB81C", prohibited: "#E0243F", track: "#2A3546" },
  camera: { overlay: "rgba(0,0,0,0.5)", guide: "#FFFFFF", text: "#FFFFFF" },
};

export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;
export const radius = { sm: 8, md: 12, lg: 18, xl: 26, pill: 999 } as const;

/** Minimum touch target (Apple HIG). */
export const TOUCH = 44;

/**
 * Type scale (iOS-like). Text scales with Dynamic Type; very large hero text is capped
 * with `maxFontSizeMultiplier` where layout would break.
 */
export const type = {
  hero: { fontSize: 40, lineHeight: 44, fontWeight: "900" as const, letterSpacing: -0.5 },
  statusWord: { fontSize: 15, lineHeight: 18, fontWeight: "900" as const, letterSpacing: 1.6 },
  title: { fontSize: 24, lineHeight: 30, fontWeight: "800" as const },
  headline: { fontSize: 18, lineHeight: 23, fontWeight: "700" as const },
  body: { fontSize: 17, lineHeight: 23, fontWeight: "400" as const },
  bodyStrong: { fontSize: 17, lineHeight: 23, fontWeight: "700" as const },
  callout: { fontSize: 15, lineHeight: 20, fontWeight: "500" as const },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: "500" as const },
  label: { fontSize: 13, lineHeight: 16, fontWeight: "800" as const, letterSpacing: 0.8 },
} as const;
