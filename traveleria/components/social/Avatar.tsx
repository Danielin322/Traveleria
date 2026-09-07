import { Ionicons } from "@expo/vector-icons";
import { Image, StyleSheet, View } from "react-native";

import { useThemeColors } from "../../contexts/ThemeContext";

/**
 * A person's avatar, falling back to a photo icon when they have not set one.
 *
 * Deliberately an icon rather than a stock photo: a real-looking placeholder
 * reads as someone else's actual picture, which is exactly the confusion it
 * caused before.
 */
export function Avatar({
  uri,
  style,
  iconSize,
}: {
  uri: string | null;
  style: object;
  iconSize: number;
}) {
  const colors = useThemeColors();

  if (uri) {
    return <Image source={{ uri }} style={style} />;
  }
  return (
    <View
      style={[
        style,
        styles.placeholder,
        { backgroundColor: colors.surfaceSunken },
      ]}
    >
      <Ionicons name="person" size={iconSize} color={colors.textMuted} />
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: { alignItems: "center", justifyContent: "center" },
});
