import "react-native-get-random-values";
import { Buffer } from "buffer";
global.Buffer = Buffer;

import { Amplify } from "aws-amplify";
import { Stack } from "expo-router";
import awsConfig from "../config/awsConfig";
import { CurrentUserProvider } from "../contexts/CurrentUserContext";

Amplify.configure(awsConfig);

export default function RootLayout() {
  return (
    <CurrentUserProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="trip-details"
          options={{ presentation: "modal", headerShown: true, title: "Trip Details" }}
        />
      </Stack>
    </CurrentUserProvider>
  );
}
