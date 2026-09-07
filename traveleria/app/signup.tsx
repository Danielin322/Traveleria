import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppButton } from "../components/AppButton";
import { FormField } from "../components/FormField";
import {
  FontFamily,
  FontSize,
  Spacing,
  ThemeColors,
} from "../constants/theme";
import { useCountdown } from "../hooks/useCountdown";
import { useThemeColors } from "../contexts/ThemeContext";
import {
  confirmUser,
  registerUser,
  resendVerificationCode,
} from "../services/authService";

/**
 * How long the resend button stays closed after a code is sent.
 *
 * Long enough that most emails land first, so the button is not tapped
 * reflexively; short enough not to feel stuck. It also keeps normal use well
 * inside Cognito's own throttling.
 */
const RESEND_COOLDOWN_SECONDS = 60;

type SignupFieldErrors = {
  email?: string;
  password?: string;
  confirm?: string;
  code?: string;
};

/**
 * Cognito's error names turned into something a person can act on.
 * Shared by sign-up, verification and resend, which fail in overlapping ways.
 */
const cognitoErrorMessage = (
  error: unknown,
  fallback = "An unexpected error occurred. Please try again.",
) => {
  switch ((error as { name?: string })?.name) {
    case "UsernameExistsException":
      return "This email is already registered. Please try logging in.";
    case "InvalidPasswordException":
      return "The password does not meet the security requirements.";
    case "CodeMismatchException":
      return "That code is not right. Check the latest email and try again.";
    case "ExpiredCodeException":
      return "That code has expired. Tap “Resend code” to get a new one.";
    case "LimitExceededException":
    case "TooManyRequestsException":
      return "Too many attempts. Please wait a few minutes before requesting another code.";
    case "UserNotFoundException":
      return "We couldn't find that account. Please sign up again.";
    case "NotAuthorizedException":
      return "This account is already verified. Try logging in.";
    default:
      return (error as Error)?.message || fallback;
  }
};

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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Per-field messages, so a failure points at the field that caused it
  // rather than an alert that does not. Matches the event form's pattern.
  const [fieldErrors, setFieldErrors] = useState<SignupFieldErrors>({});

  const clearFieldError = (field: keyof SignupFieldErrors) =>
    setFieldErrors((prev) =>
      prev[field] ? { ...prev, [field]: undefined } : prev,
    );

  // State to track registration success
  const [isRegistered, setIsRegistered] = useState(false);

  // Blocks repeat taps while a Cognito request is in flight.
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);

  const { secondsLeft, start: startResendCooldown } = useCountdown(
    RESEND_COOLDOWN_SECONDS,
  );

  // The first code goes out with the sign-up itself, so the cooldown starts
  // when the verification step appears rather than when this screen mounts.
  useEffect(() => {
    if (isRegistered) startResendCooldown();
  }, [isRegistered, startResendCooldown]);

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

    // Checked in the order the user filled them in, so the first thing they
    // need to fix is the first thing flagged.
    const errors: SignupFieldErrors = {
      email: !email.trim()
        ? "Email is required."
        : !isValidEmail(email)
          ? "Enter a valid email address, e.g. name@example.com."
          : undefined,
      password: !password
        ? "Password is required."
        : !isPasswordStrong(password)
          ? "Password does not meet the requirements below."
          : undefined,
      confirm: !confirmPassword
        ? "Please re-enter your password."
        : confirmPassword !== password
          ? "The two passwords do not match."
          : undefined,
    };
    setFieldErrors(errors);

    if (errors.email || errors.password || errors.confirm) return;

    setIsSubmitting(true);
    try {
      const result = await registerUser({ email, password });

      if (result.success) {
        setIsRegistered(true);
      } else {
        Alert.alert("Registration Failed", cognitoErrorMessage(result.error));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  /** Asks Cognito for a fresh code, then closes the button for another minute. */
  const handleResendCode = async () => {
    if (isResending || secondsLeft > 0) return;

    setIsResending(true);
    try {
      const result = await resendVerificationCode(email);

      if (result.success) {
        // Restart before the alert, so the cooldown covers the time the user
        // spends reading it.
        startResendCooldown();
        Alert.alert(
          "Code sent",
          `A new code is on its way to ${email}. The previous code no longer works.`,
        );
      } else {
        Alert.alert("Could not resend", cognitoErrorMessage(result.error));
      }
    } finally {
      setIsResending(false);
    }
  };

  // Function to handle the confirmation code verification
  const handleVerify = async () => {
    if (isSubmitting) return;

    if (!verificationCode) {
      setFieldErrors((prev) => ({
        ...prev,
        code: "Enter the 6-digit code from your email.",
      }));
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
          cognitoErrorMessage(result.error, "Invalid code."),
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
            onChangeText={(text) => {
              setVerificationCode(text);
              clearFieldError("code");
            }}
            error={fieldErrors.code}
            keyboardType="number-pad" // Opens numeric keyboard on the phone
            maxLength={6} // Limits input to 6 characters
          />

          <AppButton
            label="Verify Account"
            onPress={handleVerify}
            loading={isSubmitting}
          />

          {/* Held closed for a minute after each send, so the button is not
              tapped while the first email is still on its way. */}
          {secondsLeft > 0 ? (
            <Text style={styles.resendWaiting}>
              Didn&apos;t get it? Resend in {secondsLeft}s
            </Text>
          ) : (
            <AppButton
              label="Resend code"
              variant="ghost"
              onPress={handleResendCode}
              loading={isResending}
              disabled={isSubmitting}
              style={styles.secondaryAction}
            />
          )}

          <AppButton
            label="Cancel and Go Back"
            variant="ghost"
            onPress={goBackToLogin}
            disabled={isSubmitting || isResending}
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
            label="Email"
            placeholder="name@example.com"
            value={email}
            onChangeText={(text) => {
              setEmail(text);
              clearFieldError("email");
            }}
            error={fieldErrors.email}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
          />

          <FormField
            label="Password"
            placeholder="Create a password"
            value={password}
            onChangeText={(text) => {
              setPassword(text);
              clearFieldError("password");
              // Re-typing the password can only fix a mismatch, never cause
              // one the user has not seen yet.
              clearFieldError("confirm");
            }}
            error={fieldErrors.password}
            secureTextEntry={true}
            autoComplete="new-password"
          />
          {/* Stating the rules up front beats failing the user after submit. */}
          <Text style={styles.hint}>
            At least 8 characters, with an uppercase and lowercase letter, a
            number and a special character.
          </Text>

          <FormField
            label="Confirm password"
            placeholder="Re-enter your password"
            value={confirmPassword}
            onChangeText={(text) => {
              setConfirmPassword(text);
              clearFieldError("confirm");
            }}
            // Flagged live once both are filled in, so the mismatch is caught
            // while the user is still looking at the field rather than at
            // submit — but never while the confirm box is still empty.
            error={
              fieldErrors.confirm ??
              (confirmPassword && password && confirmPassword !== password
                ? "The two passwords do not match."
                : undefined)
            }
            secureTextEntry={true}
            autoComplete="new-password"
          />

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
      paddingTop: 8,
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
    // Occupies the same slot the enabled button will, so nothing jumps when
    // the countdown reaches zero and the two swap.
    resendWaiting: {
      marginTop: Spacing.md,
      minHeight: 52,
      textAlignVertical: "center",
      textAlign: "center",
      lineHeight: 52,
      fontSize: FontSize.small,
      fontFamily: FontFamily.regular,
      color: colors.textMuted,
    },
  });
