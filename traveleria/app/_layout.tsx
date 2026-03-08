import { Stack } from "expo-router";

export default function RootLayout() {
  return (
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
  );
}
