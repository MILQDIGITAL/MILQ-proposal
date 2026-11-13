import { StyleSheet, Text, View } from "react-native";

/** The app's "P" sign motif: a white P on a navy rounded square with a green border. */
export function BrandMark({ size = 72 }: { size?: number }) {
  return (
    <View
      style={[styles.outer, { width: size, height: size, borderRadius: size * 0.24 }]}
      accessible
      accessibilityRole="image"
      accessibilityLabel="Parking Lingo"
    >
      <View style={[styles.inner, { borderRadius: size * 0.18, borderWidth: Math.max(2, size * 0.05) }]}>
        <Text style={[styles.p, { fontSize: size * 0.62, lineHeight: size * 0.7 }]} allowFontScaling={false}>
          P
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { backgroundColor: "#0B1B33", padding: 6 },
  inner: { flex: 1, borderColor: "#22C55E", alignItems: "center", justifyContent: "center" },
  p: { color: "#FFFFFF", fontWeight: "900" },
});
