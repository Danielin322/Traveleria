import { useState } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
// 1. Import the router tool from Expo
import { useRouter } from "expo-router";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // 2. Initialize the router
  const router = useRouter();

  const handleLogin = () => {
    console.log("Login button pressed!");
    // Navigate to the (tabs) group and the home screen inside it
    router.replace("/(tabs)/home");
  };

  return (
    <View style={styles.container}>
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

      <TouchableOpacity style={styles.signupButton}>
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
  googleButtonText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  signupButton: { marginTop: 10 },
  signupButtonText: { color: "#1E90FF", fontSize: 16, fontWeight: "600" },
});
