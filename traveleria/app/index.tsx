import { useState } from "react";
import {
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

// Import the router tool from Expo
import { useRouter } from "expo-router";

import { signInUser, signOutUser } from "../services/authService";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Initialize the router
  const router = useRouter();

  const handleLogin = async () => {
    // Basic validation
    if (!email || !password) {
      Alert.alert("Error", "Please enter both email and password.");
      return;
    }

    // Calling the AWS sign-in service
    const result = await signInUser(email, password);

    if (result.success) {
      console.log("Login successful!");
      // Only if successful, navigate to the home screen
      router.replace("/(tabs)/home");
    } else {
      // Handling errors (like wrong password or unconfirmed user)
      const error = result.error as any;
      let errorMessage = "Could not log in. Please check your credentials.";

      if (error.name === "UserNotConfirmedException") {
        errorMessage =
          "Your account is not confirmed yet. Please verify your email first.";
      } else if (error.name === "NotAuthorizedException") {
        errorMessage = "Incorrect email or password.";
      }

      Alert.alert("Login Failed", errorMessage);
    }
  };

  const handleLogout = async () => {
    const result = await signOutUser();
    if (result.success) {
      // Going back to login screen
      router.replace("/");
    } else {
      Alert.alert("Logout Failed", "Please try again.");
    }
  };

  // Function to navigate to the sign up screen
  const handleGoToSignup = () => {
    router.push("/signup");
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome Home! 🏠</Text>

      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.buttonText}>Log Out</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Traveleria</Text>

      <TextInput
        style={styles.input}
        placeholder="Email"
        keyboardType="email-address"
        value={email}
        onChangeText={(text) => setEmail(text)}
      />

      <TextInput
        style={styles.input}
        placeholder="Password"
        secureTextEntry={true}
        value={password}
        onChangeText={(text) => setPassword(text)}
      />

      <TouchableOpacity style={styles.button} onPress={handleLogin}>
        <Text style={styles.buttonText}>Log In</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.googleButton}>
        <Text style={styles.googleButtonText}>Sign in with Google</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.signupButton} onPress={handleGoToSignup}>
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
  title: {
    fontSize: 40,
    fontWeight: "bold",
    color: "#1E90FF",
    marginBottom: 40,
  },
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
  googleButton: {
    width: "100%",
    backgroundColor: "#db4437",
    padding: 15,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 15,
  },
  logoutButton: {
    backgroundColor: "#ff3b30", // צבע אדום להתנתקות
    paddingVertical: 12,
    paddingHorizontal: 30,
    borderRadius: 8,
  },
  googleButtonText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  signupButton: { marginTop: 10 },
  signupButtonText: { color: "#1E90FF", fontSize: 16, fontWeight: "600" },
});
