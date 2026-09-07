import { Ionicons } from "@expo/vector-icons";
import { Image, ImageStyle, StyleProp, View, ViewStyle } from "react-native";

import { useThemeColors } from "../../contexts/ThemeContext";

/**
 * A photo icon rather than a random stock photo for "no avatar set" -- a
 * real-looking placeholder photo reads as someone else's actual picture,
 * which is exactly the confusion it caused.
 */
export function Avatar({
  uri,
  size,
  iconSize,
  style,
}: {
  uri: string | null;
  size: number;
  iconSize: number;
  // Only ever used for spacing (margin), which is valid on both an Image
  // and a View, so a caller can pass one style object for either.
  style?: StyleProp<ViewStyle & ImageStyle>;
}) {
  const colors = useThemeColors();
  const dimensions = { width: size, height: size, borderRadius: size / 2 };

  if (uri) {
    return <Image source={{ uri }} style={[dimensions, style]} />;
  }
  return (
    <View
      style={[
        dimensions,
        {
          backgroundColor: colors.surfaceSunken,
          alignItems: "center",
          justifyContent: "center",
        },
        style,
      ]}
    >
      <Ionicons name="person" size={iconSize} color={colors.textMuted} />
    </View>
  );
}
