import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
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
import { confirmUser, registerUser } from "../services/authService";

export default function SignupScreen() {
  const router = useRouter();

  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Return to the login screen. Falls back to a direct navigation when there is
  // no history to pop — e.g. if signup was opened as the app's first screen.
  const goBackToLogin = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/");
    }
  };

  const [verificationCode, setVerificationCode] = useState("");
  // State for form inputs
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // State to track registration success
  const [isRegistered, setIsRegistered] = useState(false);

  // Blocks repeat taps while a Cognito request is in flight.
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Helper function to validate email format using regex
  const isValidEmail = (email: string) => {
    // Standard email pattern
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  // Helper function to validate password strength
  const isPasswordStrong = (pass: string) => {
    // Checks for at least 8 characters, one uppercase, one lowercase, one number, and one symbol
    const passwordRegex =
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    return passwordRegex.test(pass);
  };

  const handleSignup = async () => {
    if (isSubmitting) return;

    // 1. Basic empty fields check
    if (!firstName || !email || !password) {
      Alert.alert("Missing Information", "All fields are required.");
      return;
    }

    // 2. Client-side Email validation
    if (!isValidEmail(email)) {
      Alert.alert(
        "Invalid Email",
        "Please enter a valid email address (e.g., name@example.com).",
      );
      return;
    }

    // 3. Client-side Password validation
    if (!isPasswordStrong(password)) {
      Alert.alert(
        "Weak Password",
        "Password must be at least 8 characters long and include an uppercase letter, a lowercase letter, a number, and a special character.",
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await registerUser({ email, password, firstName });

      if (result.success) {
        setIsRegistered(true);
      } else {
        // 4. Handle specific AWS error codes for better English messages
        const error = result.error as any;
        let errorMessage = "An unexpected error occurred. Please try again.";

        // Mapping AWS Cognito error names to user-friendly English messages
        if (error.name === "UsernameExistsException") {
          errorMessage =
            "This email is already registered. Please try logging in.";
        } else if (error.name === "InvalidPasswordException") {
          errorMessage =
            "The password does not meet the security requirements.";
        } else if (error.name === "LimitExceededException") {
          errorMessage =
            "Too many attempts. Please wait a moment and try again.";
        }

        Alert.alert("Registration Failed", errorMessage);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Function to handle the confirmation code verification
  const handleVerify = async () => {
    if (isSubmitting) return;

    if (!verificationCode) {
      Alert.alert(
        "Missing Code",
        "Please enter the 6-digit code from your email.",
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await confirmUser(email, verificationCode);

      if (result.success) {
        Alert.alert(
          "Success!",
          "Your account is now verified. You can log in.",
          [
            { text: "OK", onPress: () => router.replace("/") }, // Navigate back to the login screen
          ],
        );
      } else {
        Alert.alert(
          "Verification Failed",
          (result.error as Error)?.message || "Invalid code.",
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Shared back affordance. The root Stack hides headers, so the screen
  // provides its own way back to login.
  const renderBackBar = () => (
    <View style={styles.headerBar}>
      <TouchableOpacity
        style={styles.backButton}
        onPress={goBackToLogin}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel="Back to log in"
      >
        <Ionicons name="chevron-back" size={26} color={colors.primary} />
        <Text style={styles.backButtonText}>Log In</Text>
      </TouchableOpacity>
    </View>
  );

  if (isRegistered) {
    return (
      <SafeAreaView style={styles.safeArea}>
        {renderBackBar()}
        <View style={styles.container}>
          <Text style={styles.title}>Confirm Your Account</Text>
          <Text style={styles.message}>
            We sent a 6-digit code to {email}. Please enter it below to activate
            your account.
          </Text>

          <FormField
            label="Verification code"
            placeholder="6-Digit Code"
            value={verificationCode}
            onChangeText={setVerificationCode}
            keyboardType="number-pad" // Opens numeric keyboard on the phone
            maxLength={6} // Limits input to 6 characters
          />

          <AppButton
            label="Verify Account"
            onPress={handleVerify}
            loading={isSubmitting}
          />

          <AppButton
            label="Cancel and Go Back"
            variant="ghost"
            onPress={goBackToLogin}
            disabled={isSubmitting}
            style={styles.secondaryAction}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      {renderBackBar()}
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.title}>Sign Up</Text>

          <FormField
            label="First name"
            placeholder="Your first name"
            value={firstName}
            onChangeText={setFirstName}
            autoComplete="given-name"
          />

          <FormField
            label="Email"
            placeholder="name@example.com"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
          />

          <FormField
            label="Password"
            placeholder="Create a password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={true}
            autoComplete="new-password"
          />
          {/* Stating the rules up front beats failing the user after submit. */}
          <Text style={styles.hint}>
            At least 8 characters, with an uppercase and lowercase letter, a
            number and a special character.
          </Text>

          <AppButton
            label="Create Account"
            onPress={handleSignup}
            loading={isSubmitting}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.background },
    flex: { flex: 1 },
    headerBar: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: Spacing.md,
      paddingBottom: Spacing.sm,
      // SafeAreaView only insets on iOS, so clear Android's status bar manually.
      paddingTop:
        Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) + 8 : 8,
    },
    backButton: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: Spacing.xs + 2,
      paddingRight: Spacing.md,
    },
    backButtonText: {
      color: colors.primary,
      fontSize: FontSize.body,
      fontFamily: FontFamily.semibold,
      marginLeft: -4,
    },
    container: {
      flex: 1,
      justifyContent: "center",
      padding: Spacing.xxl,
    },
    scrollContent: {
      flexGrow: 1,
      justifyContent: "center",
      padding: Spacing.xxl,
    },
    title: {
      fontSize: FontSize.h1,
      fontFamily: FontFamily.bold,
      marginBottom: Spacing.xxl,
      textAlign: "center",
      color: colors.textPrimary,
    },
    message: {
      fontSize: FontSize.body,
      fontFamily: FontFamily.regular,
      textAlign: "center",
      marginBottom: Spacing.xxxl,
      color: colors.textSecondary,
      lineHeight: 24,
    },
    hint: {
      fontSize: FontSize.caption,
      fontFamily: FontFamily.regular,
      color: colors.textMuted,
      marginTop: -Spacing.sm,
      marginBottom: Spacing.xl,
      lineHeight: 17,
    },
    secondaryAction: { marginTop: Spacing.md },
  });
