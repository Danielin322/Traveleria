// // 1. Imports
// /* import { useState } from "react";
// import { Alert, Button, StyleSheet, Text, TextInput, View } from "react-native";
// // Import our working authentication service
// import { registerUser } from "../services/authService";

// export default function SignupScreen() {
//   // 2. Logic: State variables to hold user input
//   const [firstName, setFirstName] = useState("");
//   const [email, setEmail] = useState("");
//   const [password, setPassword] = useState("");

//   // Function to handle the button press
//   const handleSignup = async () => {
//     // Basic validation to ensure no fields are empty
//     if (!firstName || !email || !password) {
//       Alert.alert("Missing Info", "Please fill in all the fields.");
//       return;
//     }

//     // Call the AWS service with the real user input
//     const result = await registerUser({ email, password, firstName });

//     if (result.success) {
//       Alert.alert("Success!", "Registration complete. Check your email!");
//       // Note: We will add navigation to a "Verify Code" screen here later
//     } else {
//       Alert.alert(
//         "Error",
//         (result.error as Error)?.message || "Failed to register.",
//       );
//     }
//   };

//   return (
//     // 3. UI: The actual form with text inputs
//     <View style={styles.container}>
//       <Text style={styles.title}>Create your Traveleria Account</Text>

//       <TextInput
//         style={styles.input}
//         placeholder="First Name"
//         value={firstName}
//         onChangeText={setFirstName}
//       />

//       <TextInput
//         style={styles.input}
//         placeholder="Email"
//         value={email}
//         onChangeText={setEmail}
//         keyboardType="email-address"
//         autoCapitalize="none"
//       />

//       <TextInput
//         style={styles.input}
//         placeholder="Password"
//         value={password}
//         onChangeText={setPassword}
//         secureTextEntry={true}
//       />

//       <Button title="Sign Up" onPress={handleSignup} />
//     </View>
//   );
// }

// // 4. Styles
// const styles = StyleSheet.create({
//   container: {
//     flex: 1,
//     justifyContent: "center",
//     padding: 20,
//     backgroundColor: "#fff",
//   },
//   title: {
//     fontSize: 24,
//     fontWeight: "bold",
//     marginBottom: 30,
//     textAlign: "center",
//   },
//   input: {
//     height: 50,
//     borderWidth: 1,
//     borderColor: "#ccc",
//     borderRadius: 8,
//     paddingHorizontal: 15,
//     marginBottom: 15,
//   },
// });
// */

// // 1. Imports
// import { useRouter } from "expo-router";
// import { useState } from "react";
// import {
//   Alert,
//   StyleSheet,
//   Text,
//   TextInput,
//   TouchableOpacity,
//   View,
// } from "react-native";
// // Import our registration service
// import { registerUser } from "../services/authService";

// export default function SignupScreen() {
//   const router = useRouter();

//   // State for form inputs
//   const [firstName, setFirstName] = useState("");
//   const [email, setEmail] = useState("");
//   const [password, setPassword] = useState("");

//   // NEW: State to track if the registration was successful (the "switch")
//   const [isRegistered, setIsRegistered] = useState(false);

//   // Function to handle the signup process
//   const handleSignup = async () => {
//     if (!firstName || !email || !password) {
//       Alert.alert("Missing Info", "Please fill in all the fields.");
//       return;
//     }

//     const result = await registerUser({ email, password, firstName });

//     if (result.success) {
//       // NEW: Instead of just an alert, we flip the switch to true
//       setIsRegistered(true);
//     } else {
//       // Error handling with type casting for TypeScript
//       Alert.alert(
//         "Error",
//         (result.error as Error)?.message || "Failed to register.",
//       );
//     }
//   };

//   // If the user is registered, show ONLY this success view
//   if (isRegistered) {
//     return (
//       <View style={styles.container}>
//         <Text style={styles.title}>Registration Successful! 🎉</Text>
//         <Text style={styles.message}>
//           A verification code has been sent to {email}. Please check your inbox
//           to confirm your account.
//         </Text>

//         {/* Button to go back to the Login screen */}
//         <TouchableOpacity style={styles.button} onPress={() => router.back()}>
//           <Text style={styles.buttonText}>Back to Login</Text>
//         </TouchableOpacity>
//       </View>
//     );
//   }

//   // Regular UI - This part only shows if isRegistered is false
//   return (
//     <View style={styles.container}>
//       <Text style={styles.title}>Create your Traveleria Account</Text>

//       <TextInput
//         style={styles.input}
//         placeholder="First Name"
//         value={firstName}
//         onChangeText={setFirstName}
//       />

//       <TextInput
//         style={styles.input}
//         placeholder="Email"
//         value={email}
//         onChangeText={setEmail}
//         keyboardType="email-address"
//         autoCapitalize="none"
//       />

//       <TextInput
//         style={styles.input}
//         placeholder="Password"
//         value={password}
//         onChangeText={setPassword}
//         secureTextEntry={true}
//       />

//       <TouchableOpacity style={styles.button} onPress={handleSignup}>
//         <Text style={styles.buttonText}>Sign Up</Text>
//       </TouchableOpacity>
//     </View>
//   );
// }

// // 4. Styles
// const styles = StyleSheet.create({
//   container: {
//     flex: 1,
//     justifyContent: "center",
//     padding: 20,
//     backgroundColor: "#fff",
//   },
//   title: {
//     fontSize: 24,
//     fontWeight: "bold",
//     marginBottom: 20,
//     textAlign: "center",
//   },
//   message: {
//     fontSize: 16,
//     textAlign: "center",
//     marginBottom: 30,
//     color: "#555",
//     lineHeight: 22,
//   },
//   input: {
//     height: 50,
//     borderWidth: 1,
//     borderColor: "#ccc",
//     borderRadius: 8,
//     paddingHorizontal: 15,
//     marginBottom: 15,
//   },
//   button: {
//     backgroundColor: "#007AFF",
//     padding: 15,
//     borderRadius: 8,
//     alignItems: "center",
//   },
//   buttonText: {
//     color: "#fff",
//     fontSize: 16,
//     fontWeight: "bold",
//   },
// });

// 1. Imports
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

// Add confirmUser to the existing import
import { confirmUser, registerUser } from "../services/authService";

export default function SignupScreen() {
  const router = useRouter();
  const [verificationCode, setVerificationCode] = useState("");
  // State for form inputs
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // State to track registration success
  const [isRegistered, setIsRegistered] = useState(false);

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
        errorMessage = "The password does not meet the security requirements.";
      } else if (error.name === "LimitExceededException") {
        errorMessage = "Too many attempts. Please wait a moment and try again.";
      }

      Alert.alert("Registration Failed", errorMessage);
    }
  };

  // Function to handle the confirmation code verification
  const handleVerify = async () => {
    if (!verificationCode) {
      Alert.alert(
        "Missing Code",
        "Please enter the 6-digit code from your email.",
      );
      return;
    }

    const result = await confirmUser(email, verificationCode);

    if (result.success) {
      Alert.alert("Success!", "Your account is now verified. You can log in.", [
        { text: "OK", onPress: () => router.replace("/") }, // Navigate back to the login screen
      ]);
    } else {
      Alert.alert(
        "Verification Failed",
        (result.error as Error)?.message || "Invalid code.",
      );
    }
  };

  //   if (isRegistered) {
  //     return (
  //       <View style={styles.container}>
  //         <Text style={styles.title}>Account Created! 🎉</Text>
  //         <Text style={styles.message}>
  //           A verification code has been sent to {email}. Please check your inbox
  //           to confirm your account before logging in.
  //         </Text>

  //         <TouchableOpacity style={styles.button} onPress={() => router.back()}>
  //           <Text style={styles.buttonText}>Back to Login</Text>
  //         </TouchableOpacity>
  //       </View>
  //     );
  //   }

  if (isRegistered) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Confirm Your Account</Text>
        <Text style={styles.message}>
          We sent a 6-digit code to {email}. Please enter it below to activate
          your account.
        </Text>

        <TextInput
          style={styles.input}
          placeholder="6-Digit Code"
          value={verificationCode}
          onChangeText={setVerificationCode}
          keyboardType="number-pad" // Opens numeric keyboard on the phone
          maxLength={6} // Limits input to 6 characters
        />

        <TouchableOpacity style={styles.button} onPress={handleVerify}>
          <Text style={styles.buttonText}>Verify Account</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.button,
            { backgroundColor: "transparent", marginTop: 15 },
          ]}
          onPress={() => router.back()}
        >
          <Text style={[styles.buttonText, { color: "#007AFF" }]}>
            Cancel and Go Back
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Sign Up</Text>

      <TextInput
        style={styles.input}
        placeholder="First Name"
        value={firstName}
        onChangeText={setFirstName}
      />

      <TextInput
        style={styles.input}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />

      <TextInput
        style={styles.input}
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry={true}
      />

      <TouchableOpacity style={styles.button} onPress={handleSignup}>
        <Text style={styles.buttonText}>Create Account</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    padding: 25,
    backgroundColor: "#ffffff",
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    marginBottom: 25,
    textAlign: "center",
    color: "#333",
  },
  message: {
    fontSize: 16,
    textAlign: "center",
    marginBottom: 35,
    color: "#666",
    lineHeight: 24,
  },
  input: {
    height: 55,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    paddingHorizontal: 15,
    marginBottom: 20,
    fontSize: 16,
  },
  button: {
    backgroundColor: "#2063e0",
    padding: 16,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 10,
  },
  buttonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
});
