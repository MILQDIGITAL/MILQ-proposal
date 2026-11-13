/** Shared primitives: text, icons, buttons, cards. All touch targets are ≥ 44 pt. */
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps, ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type TextProps, type TextStyle, type ViewStyle } from "react-native";
import { radius, space, TOUCH, type, usePalette } from "../theme";

export type IconName = ComponentProps<typeof Ionicons>["name"];

export function Icon({ name, size = 22, color, style }: { name: string; size?: number; color: string; style?: StyleProp<TextStyle> }) {
  return <Ionicons name={name as IconName} size={size} color={color} style={style} accessible={false} importantForAccessibility="no" />;
}

type Variant = keyof typeof type;

export function AppText({
  variant = "body",
  color,
  muted,
  style,
  ...rest
}: TextProps & { variant?: Variant; color?: string; muted?: boolean }) {
  const p = usePalette();
  return <Text {...rest} style={[type[variant], { color: color ?? (muted ? p.textMuted : p.text) }, style]} />;
}

export interface ButtonProps {
  label: string;
  onPress: () => void;
  icon?: string;
  variant?: "primary" | "secondary" | "ghost" | "onDark";
  size?: "md" | "lg";
  disabled?: boolean;
  loading?: boolean;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Button({ label, onPress, icon, variant = "primary", size = "md", disabled, loading, accessibilityHint, style, testID }: ButtonProps) {
  const p = usePalette();
  const colors = {
    primary: { bg: p.accent, fg: p.onAccent, border: p.accent },
    secondary: { bg: p.surface, fg: p.text, border: p.borderStrong },
    ghost: { bg: "transparent", fg: p.text, border: "transparent" },
    onDark: { bg: "rgba(255,255,255,0.16)", fg: "#FFFFFF", border: "rgba(255,255,255,0.35)" },
  }[variant];
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      style={({ pressed }) => [
        styles.button,
        size === "lg" && styles.buttonLg,
        { backgroundColor: colors.bg, borderColor: colors.border, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.fg} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={size === "lg" ? 24 : 20} color={colors.fg} /> : null}
          <Text style={[size === "lg" ? type.headline : type.bodyStrong, { color: colors.fg }]} numberOfLines={1}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({
  icon,
  label,
  onPress,
  color,
  background,
  size = 48,
  selected,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  color: string;
  background?: string;
  size?: number;
  selected?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={selected === undefined ? undefined : { selected }}
      hitSlop={8}
      style={({ pressed }) => [
        { width: Math.max(size, TOUCH), height: Math.max(size, TOUCH), borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: background, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Icon name={icon} size={Math.round(size * 0.5)} color={color} />
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  return <View style={[styles.card, { backgroundColor: p.surface, borderColor: p.border }, style]}>{children}</View>;
}

export function SectionTitle({ children, accessory }: { children: string; accessory?: ReactNode }) {
  return (
    <View style={styles.sectionTitle} accessibilityRole="header">
      <AppText variant="label" muted style={{ textTransform: "uppercase" }}>
        {children}
      </AppText>
      {accessory}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: 1.5,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
  },
  buttonLg: { minHeight: 60, borderRadius: radius.lg },
  card: { borderRadius: radius.lg, borderWidth: 1, padding: space.lg },
  sectionTitle: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space.sm, marginTop: space.xs },
});
