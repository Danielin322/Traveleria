// Polyfill for random values used by Cognito
import "react-native-get-random-values";
// Polyfill for Buffer used in encryption calculations
import { Buffer } from "buffer";
global.Buffer = Buffer;

import { Stack } from "expo-router";
import "react-native-get-random-values";
// --- AWS Amplify Initialization ---
import { Amplify } from "aws-amplify";
import awsConfig from "../config/awsConfig";
import { CurrentUserProvider } from "../contexts/CurrentUserContext";

Amplify.configure(awsConfig);

export default function RootLayout() {
  return (
    <CurrentUserProvider>
      <Stack screenOptions={{ headerShown: false }}>
        {/* This ensures the Login screen and the Tabs structure are visible but clean */}
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
    </CurrentUserProvider>
  );
}
