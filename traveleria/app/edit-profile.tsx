import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
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
import { apiFetch } from "../services/apiClient";

export default function EditProfileScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();

  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [name, setName] = useState((params.fullName as string) || "");
  const [country, setCountry] = useState((params.country as string) || "");
  const [language, setLanguage] = useState((params.language as string) || "");
  const [age, setAge] = useState((params.age as string) || "");
  const [interests, setInterests] = useState(
    (params.interests as string) || "",
  );
  // Prevents a double tap sending two PATCH requests.
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (isSaving) return;

    setIsSaving(true);
    try {
      const response = await apiFetch("/users/me", {
        method: "PATCH",
        body: JSON.stringify({
          full_name: name,
          country,
          language,
          age: age ? parseInt(age) : null,
          interests,
        }),
      });
      if (response.ok) {
        router.back();
      } else {
        Alert.alert("Error", "Could not save profile. Please try again.");
      }
    } catch (err) {
      console.error("Error saving profile:", err);
      Alert.alert("Error", "Could not connect to server.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.container}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.headerTitle}>Edit Profile</Text>

        <FormField
          label="Full Name"
          value={name}
          onChangeText={setName}
          placeholder="Your name"
        />

        <FormField
          label="Country"
          value={country}
          onChangeText={setCountry}
          placeholder="e.g. Israel"
        />

        <FormField
          label="Languages"
          value={language}
          onChangeText={setLanguage}
          placeholder="e.g. English, Hebrew"
        />

        <FormField
          label="Age"
          value={age}
          onChangeText={setAge}
          keyboardType="numeric"
          placeholder="e.g. 28"
          maxLength={3}
        />

        <FormField
          label="Interests (separated by commas)"
          value={interests}
          onChangeText={setInterests}
          multiline
          placeholder="e.g. Shopping, Hiking, Art"
          style={styles.textArea}
        />

        <View style={styles.buttonContainer}>
          <AppButton
            label="Save Changes"
            onPress={handleSave}
            loading={isSaving}
          />
          <AppButton
            label="Cancel"
            variant="ghost"
            onPress={() => router.back()}
            disabled={isSaving}
            style={styles.cancel}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scrollContent: { padding: Spacing.xxl, paddingTop: 60 },
    headerTitle: {
      fontSize: FontSize.h1,
      fontFamily: FontFamily.bold,
      marginBottom: Spacing.xxxl,
      color: colors.textPrimary,
    },
    textArea: { height: 100, textAlignVertical: "top" },
    buttonContainer: { marginTop: Spacing.xl },
    cancel: { marginTop: Spacing.sm },
  });
