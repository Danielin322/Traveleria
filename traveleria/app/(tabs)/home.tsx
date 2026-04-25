import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
// 1. MUST import useRouter to use navigation
import { useRouter } from "expo-router";
import { API_URL } from "../../constants/api";
import { apiFetch } from "../../services/apiClient";

export default function HomeScreen() {
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const router = useRouter();

  const [isModalVisible, setIsModalVisible] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newLocation, setNewLocation] = useState("");
  const [newDates, setNewDates] = useState("");

  const fetchTrips = async () => {
    if (!API_URL) {
      setError("API URL is not configured. Please set EXPO_PUBLIC_API_URL in your .env file.");
      setLoading(false);
      return;
    }
    try {
      setError(null);
      const response = await apiFetch("/trips");
      const data = await response.json();
      setTrips(data);
    } catch (err) {
      setError("Could not connect to server. Make sure the backend is running.");
      console.error("Error fetching trips:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddTrip = async () => {
    if (!newTitle || !newLocation || !newDates) return;

    const tripData = {
      id: Math.random().toString(),
      title: newTitle,
      date: newDates,
      location: newLocation.toUpperCase(),
    };

    try {
      const response = await apiFetch("/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tripData),
      });

      if (response.ok) {
        fetchTrips();
        setNewTitle("");
        setNewLocation("");
        setNewDates("");
        setIsModalVisible(false);
      }
    } catch (err) {
      console.error("Error adding trip:", err);
    }
  };

  useEffect(() => {
    fetchTrips();
  }, []);

  const renderTripItem = ({ item }: { item: any }) => (
    <TouchableOpacity
      style={styles.tripCard}
      onPress={() =>
        router.push({
          pathname: "/trip-details",
          params: {
            id: item.id,
            title: item.title,
            location: item.location,
            date: item.date,
          },
        })
      }
    >
      <View style={styles.tripInfo}>
        <Text style={styles.locationText}>{item.location}</Text>
        <Text style={styles.tripTitle}>{item.title}</Text>
        <Text style={styles.dateText}>{item.date}</Text>
      </View>
      <Text style={styles.viewLink}>View {">"}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Your Journeys</Text>
      <Text style={styles.subtitle}>
        Plan, organize, and share your adventures.
      </Text>

      <TouchableOpacity
        style={styles.planButton}
        onPress={() => setIsModalVisible(true)}
      >
        <Text style={styles.planButtonText}>+ Plan Trip</Text>
      </TouchableOpacity>

      <Modal visible={isModalVisible} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>New Journey</Text>
            <TextInput
              style={styles.input}
              placeholder="Trip Title"
              value={newTitle}
              onChangeText={setNewTitle}
            />
            <TextInput
              style={styles.input}
              placeholder="Destination"
              value={newLocation}
              onChangeText={setNewLocation}
            />
            <TextInput
              style={styles.input}
              placeholder="DD.MM.YYYY - DD.MM.YYYY"
              value={newDates}
              onChangeText={setNewDates}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => setIsModalVisible(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.saveButton]}
                onPress={handleAddTrip}
              >
                <Text style={styles.saveButtonText}>Create</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {loading ? (
        <ActivityIndicator size="large" color="#2f6deb" />
      ) : error ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={fetchTrips}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={trips}
          renderItem={renderTripItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContainer}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f4f6f8",
    padding: 20,
    paddingTop: 60,
  },
  title: { fontSize: 30, fontWeight: "bold", color: "#1a1a1a" },
  subtitle: { fontSize: 16, color: "#666", marginBottom: 25 },
  planButton: {
    backgroundColor: "#2f6deb",
    padding: 15,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 20,
  },
  planButtonText: { color: "#fff", fontSize: 18, fontWeight: "bold" },
  listContainer: { paddingBottom: 20 },
  tripCard: {
    backgroundColor: "#fff",
    borderRadius: 15,
    padding: 15,
    marginBottom: 15,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
  },
  tripInfo: { flex: 1 },
  locationText: {
    fontSize: 12,
    color: "#1E90FF",
    fontWeight: "bold",
    marginBottom: 4,
  },
  tripTitle: { fontSize: 18, fontWeight: "bold", color: "#333" },
  dateText: { fontSize: 14, color: "#888", marginTop: 4 },
  viewLink: { color: "#2f6deb", fontWeight: "bold" },
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
    padding: 20,
  },
  modalContent: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 25,
    elevation: 5,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: "bold",
    marginBottom: 20,
    textAlign: "center",
  },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    padding: 12,
    marginBottom: 15,
    fontSize: 16,
  },
  modalButtons: { flexDirection: "row", justifyContent: "space-between" },
  modalButton: {
    flex: 1,
    padding: 15,
    borderRadius: 10,
    alignItems: "center",
    marginHorizontal: 5,
  },
  cancelButton: { backgroundColor: "#eee" },
  saveButton: { backgroundColor: "#2f6deb" },
  cancelButtonText: { color: "#666", fontWeight: "bold" },
  saveButtonText: { color: "#fff", fontWeight: "bold" },
  errorContainer: { alignItems: "center", marginTop: 40 },
  errorText: { color: "#e53935", fontSize: 15, textAlign: "center", marginBottom: 16 },
  retryButton: { backgroundColor: "#2f6deb", paddingHorizontal: 24, paddingVertical: 10, borderRadius: 10 },
  retryButtonText: { color: "#fff", fontWeight: "bold" },
});
