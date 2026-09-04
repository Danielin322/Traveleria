import "react-native-get-random-values";
import { Buffer } from "buffer";
(globalThis as typeof globalThis & { Buffer: typeof Buffer }).Buffer = Buffer;

import { Amplify } from "aws-amplify";
import { useFonts } from "expo-font";
import {
  DarkTheme,
  DefaultTheme,
  Stack,
  ThemeProvider as NavigationThemeProvider,
} from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";

import awsConfig from "../config/awsConfig";
import { CurrentUserProvider } from "../contexts/CurrentUserContext";
import { ThemeProvider, useTheme } from "../contexts/ThemeContext";

Amplify.configure(awsConfig);

// Hold the native splash until the fonts are ready, so text does not
// render once in the system font and then reflow into Inter.
SplashScreen.preventAutoHideAsync().catch(() => {
  // Already hidden or unavailable — not fatal.
});

/**
 * Navigation chrome (headers, card backgrounds) is themed separately from our
 * own screens, so it needs the palette handed to it explicitly. Lives in a
 * child component because it has to sit inside ThemeProvider to read the theme.
 */
function RootNavigator() {
  const { scheme, colors, isDark } = useTheme();

  const navTheme = {
    ...(isDark ? DarkTheme : DefaultTheme),
    colors: {
      ...(isDark ? DarkTheme : DefaultTheme).colors,
      primary: colors.primary,
      background: colors.background,
      card: colors.surface,
      text: colors.textPrimary,
      border: colors.border,
    },
  };

  return (
    <NavigationThemeProvider value={navTheme}>
      {/* Follows the theme so status bar text stays legible in both modes. */}
      <StatusBar style={isDark ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false }} key={scheme}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="trip-details"
          options={{
            presentation: "modal",
            headerShown: true,
            title: "Trip Details",
          }}
        />
      </Stack>
    </NavigationThemeProvider>
  );
}

export default function RootLayout() {
  // Vendored into assets/fonts rather than pulled from @expo-google-fonts/inter,
  // because that package re-exports all 18 faces and Expo then bundles every
  // one of them — 6 MB of fonts for the 4 weights we actually use.
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular: require("../assets/fonts/Inter_400Regular.ttf"),
    Inter_500Medium: require("../assets/fonts/Inter_500Medium.ttf"),
    Inter_600SemiBold: require("../assets/fonts/Inter_600SemiBold.ttf"),
    Inter_700Bold: require("../assets/fonts/Inter_700Bold.ttf"),
  });

  useEffect(() => {
    // Reveal the app once fonts resolve. On a font error we still continue
    // rather than trapping the user on the splash screen — the system font
    // is an acceptable fallback.
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <ThemeProvider>
      <CurrentUserProvider>
        <RootNavigator />
      </CurrentUserProvider>
    </ThemeProvider>
  );
}
