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
  ChipMultiSelect,
  ChipMultiSelectWithOther,
  OptionSelector,
} from "../components/OptionSelector";
import {
  DIETARY_OPTIONS,
  GENDER_OPTIONS,
  INTEREST_LIMITS,
  INTEREST_OPTIONS,
  interestLabel,
  isCustomInterest,
  parseDietary,
  parseInterests,
} from "../constants/profileOptions";
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
  const [gender, setGender] = useState((params.gender as string) || "");
  // Router params are strings, so arrays are passed as JSON and parsed back.
  const [dietary, setDietary] = useState<string[]>(() => {
    try {
      return parseDietary(JSON.parse((params.dietary as string) || "[]"));
    } catch {
      return [];
    }
  });
  const [interests, setInterests] = useState<string[]>(() => {
    try {
      return parseInterests(JSON.parse((params.interests as string) || "[]"));
    } catch {
      return [];
    }
  });
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
          // Omitted when unset so the backend leaves the existing value alone.
          ...(gender ? { gender } : {}),
          dietary,
        }),
      });
      if (response.ok) {
        router.back();
      } else {
        // Surface the server's reason (e.g. an invalid option) rather than a
        // generic failure.
        let detail = "Could not save profile. Please try again.";
        try {
          const data = await response.json();
          detail = data?.detail || data?.error || detail;
        } catch {
          // Non-JSON error body; keep the generic message.
        }
        Alert.alert("Error", detail);
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

        <View style={styles.group}>
          <Text style={styles.label}>Gender</Text>
          <OptionSelector
            options={GENDER_OPTIONS}
            value={gender || null}
            onChange={setGender}
          />
        </View>

        <View style={styles.group}>
          <Text style={styles.label}>Preferred nutrition</Text>
          <Text style={styles.hint}>
            Pick any that apply, or none if you have no restrictions.
          </Text>
          <ChipMultiSelect
            options={DIETARY_OPTIONS}
            values={dietary}
            onChange={setDietary}
          />
        </View>

        <View style={styles.group}>
          <Text style={styles.label}>Interests</Text>
          <Text style={styles.hint}>
            Pick anything you enjoy — we&apos;ll use it to suggest activities.
            Tap “Other” to add your own.
          </Text>
          <ChipMultiSelectWithOther
            options={INTEREST_OPTIONS}
            values={interests}
            onChange={setInterests}
            labelOf={interestLabel}
            isCustom={isCustomInterest}
            maxCount={INTEREST_LIMITS.maxCount}
            maxLength={INTEREST_LIMITS.maxLength}
            placeholder="e.g. Birdwatching"
          />
        </View>

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
    group: { marginBottom: Spacing.xl },
    label: {
      fontSize: FontSize.caption,
      fontFamily: FontFamily.semibold,
      color: colors.textSecondary,
      marginBottom: Spacing.sm,
    },
    hint: {
      fontSize: FontSize.caption,
      fontFamily: FontFamily.regular,
      color: colors.textMuted,
      marginBottom: Spacing.md,
    },
    buttonContainer: { marginTop: Spacing.xl },
    cancel: { marginTop: Spacing.sm },
  });
