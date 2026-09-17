/**
 * Root navigation for the mobile app (expo-router).
 *
 * Header colours mirror the design-system tokens used on web (`--red-500`,
 * `--ink-900`) so the two clients read as one product. React Native has no CSS
 * custom properties, so the values are duplicated here as constants — see
 * src/theme.ts, which is the single place they're written down.
 */
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { theme } from "../src/theme";

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.ink900 },
          headerTintColor: theme.white,
          headerTitleStyle: { fontWeight: "600" },
          contentStyle: { backgroundColor: theme.paper },
        }}
      >
        <Stack.Screen name="index" options={{ title: "Find podcasts" }} />
      </Stack>
    </>
  );
}
