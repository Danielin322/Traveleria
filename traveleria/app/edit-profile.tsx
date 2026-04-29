import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { deleteUserAccount } from "../services/authService";

export default function EditProfileScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();

  // אתחול ה-State עם הנתונים הקיימים שהגיעו מהפרופיל
  const [name, setName] = useState((params.fullName as string) || "");
  const [country, setCountry] = useState((params.country as string) || "");
  const [language, setLanguage] = useState((params.language as string) || "");
  const [age, setAge] = useState((params.age as string) || "");
  const [interests, setInterests] = useState(
    (params.interests as string) || "",
  );

  const handleSave = () => {
    // שליחת הנתונים המעודכנים בחזרה למסך הפרופיל דרך הניווט
    router.replace({
      pathname: "/(tabs)/profile",
      params: {
        updatedName: name,
        updatedCountry: country,
        updatedLanguage: language,
        updatedAge: age,
        updatedInterests: interests,
      },
    });
  };

  const handleDeleteAccount = () => {
    // Show a confirmation dialog before proceeding with deletion
    Alert.alert(
      "Delete Account",
      "Are you sure you want to delete your account? This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            const result = await deleteUserAccount();
            if (result.success) {
              // Redirect to the landing/login screen
              router.replace("/");
            } else {
              Alert.alert(
                "Error",
                "Could not delete account. Please try again.",
              );
            }
          },
        },
      ],
    );
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.headerTitle}>Edit Profile</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Full Name</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Country</Text>
          <TextInput
            style={styles.input}
            value={country}
            onChangeText={setCountry}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Languages</Text>
          <TextInput
            style={styles.input}
            value={language}
            onChangeText={setLanguage}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Age</Text>
          <TextInput
            style={styles.input}
            value={age}
            onChangeText={setAge}
            keyboardType="numeric"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Interests (separated by commas)</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={interests}
            onChangeText={setInterests}
            multiline
            placeholder="e.g. Shopping, Hiking, Art"
          />
        </View>

        <View style={styles.buttonContainer}>
          <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
            <Text style={styles.saveButtonText}>Save Changes</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={() => router.back()}
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={styles.deleteAccountButton}
          onPress={handleDeleteAccount}
        >
          <Text style={styles.deleteAccountText}>Delete Account</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  scrollContent: { padding: 25, paddingTop: 60 },
  headerTitle: {
    fontSize: 28,
    fontWeight: "bold",
    marginBottom: 30,
    color: "#1a1a1a",
  },
  inputGroup: { marginBottom: 20 },
  label: { fontSize: 14, fontWeight: "600", color: "#666", marginBottom: 8 },
  input: {
    backgroundColor: "#f0f2f5",
    borderRadius: 12,
    padding: 15,
    fontSize: 16,
    color: "#333",
  },
  deleteAccountButton: {
    marginTop: 40, // Space from the previous buttons
    marginBottom: 20, // Space from the bottom of the scroll view
    paddingVertical: 8, // Smaller vertical padding
    paddingHorizontal: 15, // Horizontal padding to define button width
    alignSelf: "center", // Keeps the button small and centered (not full width)
    borderWidth: 1,
    borderColor: "#ff3b30",
    borderRadius: 8,
  },
  deleteAccountText: {
    color: "#ff3b30",
    fontSize: 14, // Slightly smaller font for a cleaner look
    fontWeight: "500",
  },
  textArea: { height: 100, textAlignVertical: "top" },
  buttonContainer: { marginTop: 30 },
  saveButton: {
    backgroundColor: "#2f6deb",
    padding: 18,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 12,
  },
  saveButtonText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  cancelButton: { padding: 18, alignItems: "center" },
  cancelButtonText: { color: "#666", fontSize: 16 },
});
