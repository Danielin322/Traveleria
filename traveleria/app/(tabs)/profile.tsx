import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { OptionSelector } from "../../components/OptionSelector";
import {
  dietaryLabels,
  genderLabel,
  interestLabels,
  parseDietary,
  parseInterests,
} from "../../constants/profileOptions";
import {
  Elevation,
  FontFamily,
  FontSize,
  Radius,
  Spacing,
  ThemeColors,
} from "../../constants/theme";
import { ThemeMode, useTheme } from "../../contexts/ThemeContext";
import { apiFetch } from "../../services/apiClient";
import { signOutUser } from "../../services/authService";
import { uploadAvatar } from "../../services/walletService";

const THEME_OPTIONS = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
] as const;

export default function ProfileScreen() {
  const router = useRouter();
  const { colors, mode, setMode } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Presigned S3 URL from the profile payload. Never a device path: keeping
  // the photo locally is what made every account on one device share it.
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const [userData, setUserData] = useState({
    fullName: "",
    country: "",
    language: "",
    age: "",
    tripsCount: 0,
    interests: [] as string[],
    gender: "",
    dietary: [] as string[],
  });

  const fetchProfile = async () => {
    try {
      setError(null);
      const response = await apiFetch("/users/me");
      if (!response.ok) throw new Error(`Request failed (${response.status})`);
      const data = await response.json();
      setUserData({
        fullName: data.full_name || "",
        country: data.country || "",
        language: data.language || "",
        age: data.age ? String(data.age) : "",
        tripsCount: data.trips_count || 0,
        interests: parseInterests(data.interests),
        gender: data.gender || "",
        // Arrives as a JSON array from the TEXT[] column.
        dietary: parseDietary(data.dietary),
      });
      // Null when this account has no photo — which is exactly what another
      // account signing in on the same device should see.
      setPhotoUri(data.avatar_url ?? null);
    } catch (err) {
      // Previously swallowed, which left the screen looking blank but fine.
      setError("Could not load your profile. Pull down or tap retry.");
      console.error("Error fetching profile:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchProfile();
    setRefreshing(false);
  };

  useFocusEffect(useCallback(() => {
    fetchProfile();
  }, []));

  const handleChangePhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission required", "Allow access to your photo library to set a profile photo.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (result.canceled) return;

    const asset = result.assets[0];
    setIsUploadingPhoto(true);
    // Show the local file straight away; the upload replaces it with the S3
    // copy on the next fetch. If the upload fails we put the old one back.
    const previous = photoUri;
    setPhotoUri(asset.uri);
    try {
      await uploadAvatar(asset.uri, asset.mimeType || "image/jpeg");
      await fetchProfile();
    } catch (err) {
      setPhotoUri(previous);
      console.error("Error uploading photo:", err);
      Alert.alert("Could not update photo", (err as Error).message);
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const handleEditNavigate = () => {
    router.push({
      pathname: "/edit-profile",
      params: {
        fullName: userData.fullName,
        country: userData.country,
        language: userData.language,
        age: userData.age,
        // Router params are strings, so the array travels as JSON.
        interests: JSON.stringify(userData.interests),
        gender: userData.gender,
        // Router params are strings, so the array travels as JSON.
        dietary: JSON.stringify(userData.dietary),
      },
    });
  };

  const performLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      const result = await signOutUser();
      if (result.success) {
        router.replace("/");
      } else {
        Alert.alert("Logout Failed", "Please try again.");
      }
    } finally {
      setIsLoggingOut(false);
    }
  };

  // Logging out is disruptive enough to be worth a confirmation step.
  const handleLogout = () => {
    Alert.alert("Log out", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Log Out", style: "destructive", onPress: performLogout },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.centeredState}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          colors={[colors.primary]}
          tintColor={colors.primary}
        />
      }
    >
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={fetchProfile}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.editTopButton}
          onPress={handleEditNavigate}
        >
          <Text style={styles.editTopText}>Edit</Text>
        </TouchableOpacity>

        <View style={styles.imageContainer}>
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={styles.profileImage} />
          ) : (
            <View style={[styles.profileImage, styles.avatarPlaceholder]}>
              <Ionicons name="person" size={64} color={colors.textDisabled} />
            </View>
          )}
          {/* The photo now travels to S3, so there is a wait worth showing. */}
          {isUploadingPhoto && (
            <View style={[styles.profileImage, styles.uploadingOverlay]}>
              <ActivityIndicator color={colors.primaryContrast} />
            </View>
          )}
          <TouchableOpacity
            style={styles.cameraBadge}
            onPress={handleChangePhoto}
            disabled={isUploadingPhoto}
            accessibilityRole="button"
            accessibilityLabel="Change profile photo"
          >
            <Ionicons name="camera" size={20} color={colors.primaryContrast} />
          </TouchableOpacity>
        </View>

        <Text style={styles.nameText}>
          {userData.fullName || "Your name"}
        </Text>
      </View>

      <View style={styles.statsContainer}>
        <View style={styles.statBox}>
          <Text style={styles.statNumber}>{userData.tripsCount}</Text>
          <Text style={styles.statLabel}>Trips</Text>
        </View>
      </View>

      <View style={styles.infoSection}>
        <Text style={styles.sectionTitle}>About Me</Text>
        <View style={styles.infoItem}>
          <Ionicons name="flag-outline" size={22} color={colors.primary} />
          <View style={styles.infoTextContainer}>
            <Text style={styles.infoLabel}>Country</Text>
            <Text
              style={[styles.infoValue, !userData.country && styles.infoValueEmpty]}
            >
              {userData.country || "Not set"}
            </Text>
          </View>
        </View>
        <View style={styles.infoItem}>
          <Ionicons name="language-outline" size={22} color={colors.primary} />
          <View style={styles.infoTextContainer}>
            <Text style={styles.infoLabel}>Languages</Text>
            <Text
              style={[styles.infoValue, !userData.language && styles.infoValueEmpty]}
            >
              {userData.language || "Not set"}
            </Text>
          </View>
        </View>
        <View style={styles.infoItem}>
          <Ionicons name="calendar-outline" size={22} color={colors.primary} />
          <View style={styles.infoTextContainer}>
            <Text style={styles.infoLabel}>Age</Text>
            <Text
              style={[styles.infoValue, !userData.age && styles.infoValueEmpty]}
            >
              {userData.age || "Not set"}
            </Text>
          </View>
        </View>
        <View style={styles.infoItem}>
          <Ionicons name="person-outline" size={22} color={colors.primary} />
          <View style={styles.infoTextContainer}>
            <Text style={styles.infoLabel}>Gender</Text>
            <Text
              style={[
                styles.infoValue,
                !userData.gender && styles.infoValueEmpty,
              ]}
            >
              {genderLabel(userData.gender) || "Not set"}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.interestsSection}>
        <Text style={styles.sectionTitle}>Preferred nutrition</Text>
        <View style={styles.interestsGrid}>
          {userData.dietary.length > 0 ? (
            dietaryLabels(userData.dietary).map((label, index) => (
              <View key={index} style={styles.interestTag}>
                <Text style={styles.interestText}>{label}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.interestsEmpty}>
              No dietary preferences set — tap Edit to add some.
            </Text>
          )}
        </View>
      </View>

      <View style={styles.interestsSection}>
        <Text style={styles.sectionTitle}>Interests</Text>
        <View style={styles.interestsGrid}>
          {userData.interests.length > 0 ? (
            interestLabels(userData.interests).map((label, index) => (
              <View key={index} style={styles.interestTag}>
                <Text style={styles.interestText}>{label}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.interestsEmpty}>
              No interests yet — tap Edit to add some.
            </Text>
          )}
        </View>
      </View>

      <View style={styles.infoSection}>
        <Text style={styles.sectionTitle}>Appearance</Text>
        <OptionSelector
          options={THEME_OPTIONS}
          value={mode}
          onChange={(v) => setMode(v as ThemeMode)}
        />
        <Text style={styles.appearanceHint}>
          “System” follows your phone’s light or dark setting.
        </Text>
      </View>

      <TouchableOpacity
        style={[styles.logoutButton, isLoggingOut && styles.buttonDisabled]}
        onPress={handleLogout}
        disabled={isLoggingOut}
      >
        {isLoggingOut ? (
          <ActivityIndicator size="small" color={colors.danger} />
        ) : (
          <>
            <Ionicons name="log-out-outline" size={20} color={colors.danger} />
            <Text style={styles.logoutText}>Log Out</Text>
          </>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    centeredState: {
      flex: 1,
      backgroundColor: colors.background,
      justifyContent: "center",
      alignItems: "center",
    },
    errorBanner: {
      backgroundColor: colors.dangerSoft,
      paddingHorizontal: Spacing.xl,
      paddingVertical: Spacing.lg,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    errorBannerText: {
      color: colors.danger,
      fontSize: FontSize.caption,
      fontFamily: FontFamily.regular,
      flex: 1,
      marginRight: Spacing.md,
    },
    retryButton: {
      backgroundColor: colors.primary,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.sm,
      borderRadius: Radius.sm,
    },
    retryButtonText: {
      color: colors.primaryContrast,
      fontFamily: FontFamily.semibold,
      fontSize: FontSize.caption,
    },

    header: {
      alignItems: "center",
      paddingTop: 60,
      paddingBottom: Spacing.xxxl,
      backgroundColor: colors.surface,
      borderBottomLeftRadius: 30,
      borderBottomRightRadius: 30,
      ...Elevation.md,
      position: "relative",
    },
    editTopButton: { position: "absolute", top: 50, right: 25, padding: Spacing.sm },
    editTopText: {
      color: colors.primary,
      fontSize: FontSize.body,
      fontFamily: FontFamily.semibold,
    },
    imageContainer: { position: "relative" },
    profileImage: {
      width: 130,
      height: 130,
      borderRadius: 65,
      borderWidth: 4,
      borderColor: colors.surfaceAlt,
    },
    // Sits exactly on top of the avatar, so the spinner reads as "this photo
    // is being replaced" rather than as a general busy state.
    uploadingOverlay: {
      position: "absolute",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(0,0,0,0.45)",
    },
    avatarPlaceholder: {
      backgroundColor: colors.surfaceSunken,
      justifyContent: "center",
      alignItems: "center",
    },
    cameraBadge: {
      position: "absolute",
      bottom: 0,
      right: 5,
      backgroundColor: colors.primary,
      width: 38,
      height: 38,
      borderRadius: 19,
      justifyContent: "center",
      alignItems: "center",
      borderWidth: 3,
      borderColor: colors.surface,
    },
    nameText: {
      fontSize: FontSize.h1,
      fontFamily: FontFamily.bold,
      marginTop: Spacing.lg,
      color: colors.textPrimary,
    },

    statsContainer: {
      flexDirection: "row",
      backgroundColor: colors.surface,
      marginHorizontal: Spacing.xl,
      marginTop: -25,
      borderRadius: Radius.xl,
      padding: Spacing.xl,
      ...Elevation.md,
    },
    statBox: { flex: 1, alignItems: "center" },
    statNumber: {
      fontSize: FontSize.h2,
      fontFamily: FontFamily.bold,
      color: colors.primary,
    },
    statLabel: {
      fontSize: FontSize.caption,
      fontFamily: FontFamily.regular,
      color: colors.textMuted,
      marginTop: 2,
    },
    statDivider: {
      width: 1,
      height: "80%",
      backgroundColor: colors.border,
      alignSelf: "center",
    },

    infoSection: {
      backgroundColor: colors.surface,
      margin: Spacing.xl,
      padding: Spacing.xl,
      borderRadius: Radius.xl,
      ...Elevation.sm,
    },
    sectionTitle: {
      fontSize: FontSize.h3,
      fontFamily: FontFamily.semibold,
      marginBottom: Spacing.xl,
      color: colors.textPrimary,
    },
    infoItem: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: Spacing.xl,
    },
    infoTextContainer: { marginLeft: Spacing.lg },
    infoLabel: {
      fontSize: FontSize.tiny,
      fontFamily: FontFamily.medium,
      color: colors.textMuted,
      textTransform: "uppercase",
      letterSpacing: 0.4,
    },
    infoValue: {
      fontSize: FontSize.body,
      fontFamily: FontFamily.medium,
      color: colors.textPrimary,
    },
    infoValueEmpty: {
      color: colors.textDisabled,
      fontFamily: FontFamily.regular,
    },

    appearanceHint: {
      fontSize: FontSize.caption,
      fontFamily: FontFamily.regular,
      color: colors.textMuted,
      marginTop: Spacing.md,
    },

    interestsSection: { paddingHorizontal: Spacing.xl, marginBottom: Spacing.md },
    interestsGrid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
    interestTag: {
      backgroundColor: colors.primarySoft,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.sm + 2,
      borderRadius: Radius.pill,
    },
    interestText: {
      color: colors.primary,
      fontFamily: FontFamily.semibold,
      fontSize: FontSize.small,
    },
    interestsEmpty: {
      color: colors.textDisabled,
      fontSize: FontSize.small,
      fontFamily: FontFamily.regular,
    },

    logoutButton: {
      flexDirection: "row",
      margin: Spacing.xl,
      padding: Spacing.lg + 2,
      borderRadius: Radius.lg,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1.5,
      borderColor: colors.danger,
      backgroundColor: colors.dangerSoft,
    },
    logoutText: {
      color: colors.danger,
      fontFamily: FontFamily.semibold,
      fontSize: FontSize.body,
      marginLeft: Spacing.md,
    },
    buttonDisabled: { opacity: 0.6 },
  });
