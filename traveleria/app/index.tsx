import { fetchAuthSession, getCurrentUser } from "aws-amplify/auth";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { signInUser } from "../services/authService";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // True until the stored session has been checked, so a signed-in user never
  // sees the login form flash before being redirected.
  const [checkingSession, setCheckingSession] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();

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
          message = "Your account is not confirmed yet. Please verify your email first.";
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
        <ActivityIndicator size="large" color="#1E90FF" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Traveleria</Text>

      <TextInput
        style={styles.input}
        placeholder="Email"
        keyboardType="email-address"
        autoCapitalize="none"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      <TouchableOpacity
        style={[styles.button, isSubmitting && styles.buttonDisabled]}
        onPress={handleLogin}
        disabled={isSubmitting}
      >
        {isSubmitting ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Log In</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.signupButton}
        onPress={() => router.push("/signup")}
        disabled={isSubmitting}
      >
        <Text style={styles.signupButtonText}>Create a new account</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f9f9f9",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  title: { fontSize: 40, fontWeight: "bold", color: "#1E90FF", marginBottom: 40 },
  input: {
    width: "100%",
    height: 50,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 15,
    marginBottom: 15,
  },
  button: {
    width: "100%",
    backgroundColor: "#1E90FF",
    padding: 15,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 15,
  },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  buttonDisabled: { opacity: 0.6 },
  splash: { justifyContent: "center" },
  signupButton: { marginTop: 10 },
  signupButtonText: { color: "#1E90FF", fontSize: 16, fontWeight: "600" },
});
