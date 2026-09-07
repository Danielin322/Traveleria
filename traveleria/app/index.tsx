import { fetchAuthSession, getCurrentUser } from "aws-amplify/auth";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { AppButton } from "../components/AppButton";
import { FormField } from "../components/FormField";
import {
  FontFamily,
  FontSize,
  Spacing,
  ThemeColors,
} from "../constants/theme";
import { useThemeColors } from "../contexts/ThemeContext";
import { signInUser } from "../services/authService";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // True until the stored session has been checked, so a signed-in user never
  // sees the login form flash before being redirected.
  const [checkingSession, setCheckingSession] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();

  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  useEffect(() => {
    checkUser();
  }, []);

  const checkUser = async () => {
    try {
      const session = await fetchAuthSession();
      if (session.tokens) {
        const user = await getCurrentUser();
        if (user) {
          router.replace("/(tabs)/home");
          return;
        }
      }
    } catch {
      // No active session — stay on login screen
    } finally {
      setCheckingSession(false);
    }
  };

  const handleLogin = async () => {
    if (isSubmitting) return;

    if (!email || !password) {
      Alert.alert("Error", "Please enter both email and password.");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await signInUser(email, password);
      if (result.success) {
        router.replace("/(tabs)/home");
      } else {
        const error = result.error as any;
        let message = "Could not log in. Please check your credentials.";
        if (error?.name === "UserNotConfirmedException") {
          message =
            "Your account is not confirmed yet. Please verify your email first.";
        } else if (error?.name === "NotAuthorizedException") {
          message = "Incorrect email or password.";
        }
        Alert.alert("Login Failed", message);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (checkingSession) {
    return (
      <View style={[styles.container, styles.splash]}>
        <Text style={styles.title}>Traveleria</Text>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.container}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.title}>Traveleria</Text>
          <Text style={styles.subtitle}>
            Plan, organize, and share your adventures.
          </Text>
        </View>

        <FormField
          label="Email"
          placeholder="name@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          value={email}
          onChangeText={setEmail}
        />

        <FormField
          label="Password"
          placeholder="Your password"
          secureTextEntry
          autoComplete="password"
          value={password}
          onChangeText={setPassword}
        />

        <AppButton
          label="Log In"
          onPress={handleLogin}
          loading={isSubmitting}
          style={styles.loginButton}
        />

        <TouchableOpacity
          style={styles.signupButton}
          onPress={() => router.push("/signup")}
          disabled={isSubmitting}
          accessibilityRole="button"
        >
          <Text style={styles.signupButtonText}>Create a new account</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scrollContent: {
      flexGrow: 1,
      justifyContent: "center",
      padding: Spacing.xxl,
    },
    splash: { alignItems: "center", justifyContent: "center" },
    header: { alignItems: "center", marginBottom: Spacing.xxxl },
    title: {
      fontSize: FontSize.display,
      fontFamily: FontFamily.bold,
      color: colors.primary,
      marginBottom: Spacing.sm,
    },
    subtitle: {
      fontSize: FontSize.small,
      fontFamily: FontFamily.regular,
      color: colors.textSecondary,
      textAlign: "center",
    },
    loginButton: { marginTop: Spacing.sm },
    signupButton: { marginTop: Spacing.xl, alignItems: "center" },
    signupButtonText: {
      color: colors.primary,
      fontSize: FontSize.body,
      fontFamily: FontFamily.semibold,
    },
  });
