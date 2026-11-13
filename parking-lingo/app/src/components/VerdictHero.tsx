import { StyleSheet, View } from "react-native";
import type { VerdictViewModel } from "../logic/viewModel";
import { radius, space, usePalette } from "../theme";
import { AppText, Icon } from "./ui";

/** The giant, colour-coded answer. Icon + word + headline, so colour is never the only cue. */
export function VerdictHero({ vm, sideLabel }: { vm: VerdictViewModel; sideLabel?: string | null }) {
  const p = usePalette();
  const c = p.tone[vm.tone];
  return (
    <View
      style={[styles.hero, { backgroundColor: c.fill }]}
      accessible
      accessibilityRole="summary"
      accessibilityLabel={vm.accessibilityLabel}
      accessibilityLiveRegion="polite"
      testID="verdict-hero"
    >
      {sideLabel ? (
        <View style={[styles.sideTag, { borderColor: c.onFill }]}>
          <AppText variant="label" color={c.onFill}>
            {sideLabel}
          </AppText>
        </View>
      ) : null}
      <View style={styles.statusRow}>
        <View style={[styles.iconDisc, { backgroundColor: c.onFill }]}>
          <Icon name={vm.icon} size={56} color={c.fill} />
        </View>
        <View style={styles.statusText}>
          <AppText
            style={[styles.word, vm.statusWord.length > 4 && styles.wordLong, { color: c.onFill }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
            maxFontSizeMultiplier={1.3}
          >
            {vm.statusWord}
          </AppText>
          {vm.statusQualifier ? (
            <AppText variant="bodyStrong" color={c.onFill} style={styles.qualifier} maxFontSizeMultiplier={1.6}>
              {vm.statusQualifier}
            </AppText>
          ) : null}
        </View>
      </View>
      {vm.showDetails ? (
        <>
          <AppText style={[styles.headline, { color: c.onFill }]} maxFontSizeMultiplier={1.5}>
            {vm.heroHeadline}
          </AppText>
          <AppText variant="body" color={c.onFill} style={styles.summary} maxFontSizeMultiplier={1.8}>
            {vm.summary}
          </AppText>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: radius.xl, padding: space.xl - 4, gap: space.xs },
  statusRow: { flexDirection: "row", alignItems: "center", gap: space.md, marginBottom: space.xs },
  iconDisc: { width: 60, height: 60, borderRadius: 30, alignItems: "center", justifyContent: "center" },
  statusText: { flex: 1 },
  word: { fontSize: 50, lineHeight: 54, fontWeight: "900", letterSpacing: -1 },
  sideTag: { alignSelf: "flex-start", borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, marginBottom: 4 },
  wordLong: { fontSize: 34, lineHeight: 40, letterSpacing: -0.5 },
  qualifier: { opacity: 0.95, marginTop: -2 },
  headline: { fontSize: 30, lineHeight: 35, fontWeight: "900", letterSpacing: -0.3 },
  summary: { fontSize: 17, lineHeight: 23, opacity: 0.96 },
});
