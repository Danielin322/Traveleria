import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useState } from "react";
import {
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { apiFetch } from "../../services/apiClient";
import { signOutUser } from "../../services/authService";

const PHOTO_KEY = "profile_photo_uri";

export default function ProfileScreen() {
  const router = useRouter();

  const [photoUri, setPhotoUri] = useState<string | null>(null);

  const [userData, setUserData] = useState({
    fullName: "",
    country: "",
    language: "",
    age: "",
    tripsCount: 0,
    interests: [] as string[],
  });

  const fetchProfile = async () => {
    try {
      const response = await apiFetch("/users/me");
      const data = await response.json();
      setUserData({
        fullName: data.full_name || "",
        country: data.country || "",
        language: data.language || "",
        age: data.age ? String(data.age) : "",
        tripsCount: data.trips_count || 0,
        interests: data.interests ? data.interests.split(",").map((i: string) => i.trim()) : [],
      });
    } catch (err) {
      console.error("Error fetching profile:", err);
    }
  };

  useFocusEffect(useCallback(() => {
    fetchProfile();
    AsyncStorage.getItem(PHOTO_KEY).then((uri) => { if (uri) setPhotoUri(uri); });
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
    if (!result.canceled) {
      const uri = result.assets[0].uri;
      setPhotoUri(uri);
      AsyncStorage.setItem(PHOTO_KEY, uri);
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
        interests: userData.interests.join(", "),
      },
    });
  };

  const handleLogout = async () => {
    const result = await signOutUser();
    if (result.success) {
      router.replace("/");
    } else {
      Alert.alert("Logout Failed", "Please try again.");
    }
  };

  return (
    <ScrollView style={styles.container}>
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
              <Ionicons name="person" size={64} color="#b0b8c1" />
            </View>
          )}
          <TouchableOpacity style={styles.cameraBadge} onPress={handleChangePhoto}>
            <Ionicons name="camera" size={20} color="#fff" />
          </TouchableOpacity>
        </View>

        <Text style={styles.nameText}>{userData.fullName}</Text>
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
          <Ionicons name="flag-outline" size={22} color="#2f6deb" />
          <View style={styles.infoTextContainer}>
            <Text style={styles.infoLabel}>Country</Text>
            <Text style={styles.infoValue}>{userData.country}</Text>
          </View>
        </View>
        <View style={styles.infoItem}>
          <Ionicons name="language-outline" size={22} color="#2f6deb" />
          <View style={styles.infoTextContainer}>
            <Text style={styles.infoLabel}>Languages</Text>
            <Text style={styles.infoValue}>{userData.language}</Text>
          </View>
        </View>
        <View style={styles.infoItem}>
          <Ionicons name="calendar-outline" size={22} color="#2f6deb" />
          <View style={styles.infoTextContainer}>
            <Text style={styles.infoLabel}>Age</Text>
            <Text style={styles.infoValue}>{userData.age}</Text>
          </View>
        </View>
      </View>

      <View style={styles.interestsSection}>
        <Text style={styles.sectionTitle}>Interests</Text>
        <View style={styles.interestsGrid}>
          {userData.interests.map((interest, index) =>
            interest ? (
              <View key={index} style={styles.interestTag}>
                <Text style={styles.interestText}>{interest}</Text>
              </View>
            ) : null,
          )}
        </View>
      </View>

      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Ionicons name="log-out-outline" size={20} color="#ff4d4d" />
        <Text style={styles.logoutText}>Log Out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8f9fa" },
  header: {
    alignItems: "center",
    paddingTop: 60,
    paddingBottom: 30,
    backgroundColor: "#fff",
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
    elevation: 4,
    position: "relative",
  },
  editTopButton: { position: "absolute", top: 50, right: 25, padding: 8 },
  editTopText: { color: "#2f6deb", fontSize: 16, fontWeight: "bold" },
  imageContainer: { position: "relative" },
  profileImage: {
    width: 130,
    height: 130,
    borderRadius: 65,
    borderWidth: 4,
    borderColor: "#f0f2f5",
  },
  avatarPlaceholder: {
    backgroundColor: "#e8edf2",
    justifyContent: "center",
    alignItems: "center",
  },
  cameraBadge: {
    position: "absolute",
    bottom: 0,
    right: 5,
    backgroundColor: "#2f6deb",
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 3,
    borderColor: "#fff",
  },
  nameText: {
    fontSize: 26,
    fontWeight: "bold",
    marginTop: 15,
    color: "#1a1a1a",
  },
  locationText: { fontSize: 15, color: "#666", marginTop: 4 },
  statsContainer: {
    flexDirection: "row",
    backgroundColor: "#fff",
    marginHorizontal: 20,
    marginTop: -25,
    borderRadius: 20,
    padding: 20,
    elevation: 5,
  },
  statBox: { flex: 1, alignItems: "center" },
  statNumber: { fontSize: 22, fontWeight: "bold", color: "#2f6deb" },
  statLabel: { fontSize: 13, color: "#888", marginTop: 2 },
  statDivider: {
    width: 1,
    height: "80%",
    backgroundColor: "#eee",
    alignSelf: "center",
  },
  infoSection: {
    backgroundColor: "#fff",
    margin: 20,
    padding: 20,
    borderRadius: 20,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 20,
    color: "#333",
  },
  infoItem: { flexDirection: "row", alignItems: "center", marginBottom: 20 },
  infoTextContainer: { marginLeft: 15 },
  infoLabel: { fontSize: 12, color: "#999", textTransform: "uppercase" },
  infoValue: { fontSize: 16, color: "#333", fontWeight: "500" },
  interestsSection: { paddingHorizontal: 20, marginBottom: 10 },
  interestsGrid: { flexDirection: "row", flexWrap: "wrap" },
  interestTag: {
    backgroundColor: "#e9effd",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 25,
    marginRight: 10,
    marginBottom: 10,
  },
  interestText: { color: "#2f6deb", fontWeight: "600", fontSize: 14 },
  logoutButton: {
    flexDirection: "row",
    margin: 20,
    padding: 18,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#ff4d4d",
    backgroundColor: "rgba(255, 77, 77, 0.05)",
  },
  logoutText: {
    color: "#ff4d4d",
    fontWeight: "bold",
    fontSize: 16,
    marginLeft: 10,
  },
});
