import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { API_URL } from "../constants/api";

export default function TripDetailsScreen() {
  const { id, title, location, date } = useLocalSearchParams();

  const [viewMode, setViewMode] = useState<"itinerary" | "chat">("itinerary");
  const [loading, setLoading] = useState(true);
  const [itinerary, setItinerary] = useState([]);
  const [messages, setMessages] = useState([
    {
      id: "1",
      text: `Hi! I'm your Traveleria AI. Ready to plan your trip to ${location}?`,
      isUser: false,
    },
  ]);
  const [inputText, setInputText] = useState("");

  const [isModalVisible, setIsModalVisible] = useState(false);
  const [newActivity, setNewActivity] = useState("");
  const [newTime, setNewTime] = useState("");
  const [newPlace, setNewPlace] = useState("");

  const sortByTime = (items: any[]) =>
    [...items].sort((a, b) => a.time.localeCompare(b.time));

  const fetchItinerary = async () => {
    try {
      const response = await fetch(`${API_URL}/trips/${id}/itinerary`);
      const data = await response.json();
      setItinerary(sortByTime(data));
    } catch (error) {
      console.error("Error fetching itinerary:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddEvent = async () => {
    if (!newActivity || !newTime || !newPlace) return;

    const eventData = {
      id: Math.random().toString(),
      time: newTime,
      place: newActivity,
      address: newPlace,
    };

    try {
      const response = await fetch(`${API_URL}/trips/${id}/itinerary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(eventData),
      });

      if (response.ok) {
        setItinerary((prev) => sortByTime([...prev, eventData]));
        setNewActivity("");
        setNewTime("");
        setNewPlace("");
        setIsModalVisible(false);
      }
    } catch (error) {
      console.error("Error adding event:", error);
    }
  };

  const sendMessage = async () => {
    if (inputText.trim() === "") return;

    const userMessage = {
      id: Date.now().toString(),
      text: inputText,
      isUser: true,
    };
    setMessages((prev) => [...prev, userMessage]);

    const currentInput = inputText;
    setInputText("");

    try {
      const response = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: currentInput, trip_id: id }),
      });

      const data = await response.json();
      setMessages((prev) => [
        ...prev,
        { id: (Date.now() + 1).toString(), text: data.text, isUser: false },
      ]);
    } catch (error) {
      console.error("Chat error:", error);
      setMessages((prev) => [
        ...prev,
        {
          id: "error",
          text: "Sorry, I'm having trouble connecting to the server.",
          isUser: false,
        },
      ]);
    }
  };

  useEffect(() => {
    fetchItinerary();
  }, []);

  const renderEventCard = ({ item }: { item: any }) => (
    <View style={styles.eventCard}>
      <View style={styles.eventTimeBlock}>
        <Text style={styles.eventTime}>{item.time}</Text>
      </View>
      <View style={styles.eventDivider} />
      <View style={styles.eventInfo}>
        <Text style={styles.eventActivity}>{item.place}</Text>
        <Text style={styles.eventPlace}>{item.address}</Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.container}
        keyboardVerticalOffset={Platform.OS === "ios" ? 110 : 20}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.locationTag}>
            {location} • {date}
          </Text>
          <Text style={styles.title}>{title}</Text>
        </View>

        {viewMode === "itinerary" ? (
          <View style={{ flex: 1 }}>
            {loading ? (
              <ActivityIndicator
                size="large"
                color="#2f6deb"
                style={{ marginTop: 50 }}
              />
            ) : (
              <FlatList
                data={itinerary}
                renderItem={renderEventCard}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.listPadding}
                ListHeaderComponent={
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>Daily Plan</Text>
                    <TouchableOpacity
                      style={styles.addButton}
                      onPress={() => setIsModalVisible(true)}
                    >
                      <Ionicons name="add" size={20} color="#fff" />
                      <Text style={styles.addButtonText}>Add Event</Text>
                    </TouchableOpacity>
                  </View>
                }
                ListEmptyComponent={
                  <View style={styles.emptyState}>
                    <Ionicons name="calendar-outline" size={48} color="#ccc" />
                    <Text style={styles.emptyText}>No events yet.</Text>
                    <Text style={styles.emptySubText}>
                      Tap "Add Event" to plan your day.
                    </Text>
                  </View>
                }
              />
            )}

            {/* Add Event Modal */}
            <Modal
              visible={isModalVisible}
              animationType="slide"
              transparent={true}
            >
              <View style={styles.modalOverlay}>
                <View style={styles.modalContent}>
                  <Text style={styles.modalTitle}>New Event</Text>

                  <Text style={styles.inputLabel}>Activity</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. Visit the Colosseum"
                    value={newActivity}
                    onChangeText={setNewActivity}
                  />

                  <Text style={styles.inputLabel}>Time</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="HH:MM (e.g. 09:30)"
                    value={newTime}
                    onChangeText={setNewTime}
                    keyboardType="numbers-and-punctuation"
                  />

                  <Text style={styles.inputLabel}>Place</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. Piazza del Colosseo"
                    value={newPlace}
                    onChangeText={setNewPlace}
                  />

                  <View style={styles.modalButtons}>
                    <TouchableOpacity
                      style={[styles.modalButton, styles.cancelButton]}
                      onPress={() => {
                        setIsModalVisible(false);
                        setNewActivity("");
                        setNewTime("");
                        setNewPlace("");
                      }}
                    >
                      <Text style={styles.cancelButtonText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.modalButton, styles.saveButton]}
                      onPress={handleAddEvent}
                    >
                      <Text style={styles.saveButtonText}>Create</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </Modal>

            {/* Chat FAB */}
            <TouchableOpacity
              style={styles.fab}
              onPress={() => setViewMode("chat")}
            >
              <Ionicons name="chatbubble-ellipses" size={30} color="#fff" />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => setViewMode("itinerary")}
            >
              <Text style={styles.backText}>{"<"} Back to Itinerary</Text>
            </TouchableOpacity>

            <FlatList
              data={messages}
              renderItem={({ item }) => (
                <View
                  style={[
                    styles.messageBubble,
                    item.isUser ? styles.userBubble : styles.aiBubble,
                  ]}
                >
                  <Text
                    style={[
                      styles.messageText,
                      item.isUser ? styles.userText : styles.aiText,
                    ]}
                  >
                    {item.text}
                  </Text>
                </View>
              )}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.chatList}
            />

            <View style={styles.inputContainer}>
              <TextInput
                style={styles.chatInput}
                placeholder="Ask the AI assistant..."
                value={inputText}
                onChangeText={setInputText}
              />
              <TouchableOpacity style={styles.sendButton} onPress={sendMessage}>
                <Text style={styles.sendButtonText}>Send</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#2f6deb" },
  container: { flex: 1, backgroundColor: "#f4f6f8" },
  header: { padding: 20, backgroundColor: "#2f6deb", paddingBottom: 20 },
  locationTag: { color: "#fff", fontSize: 12, fontWeight: "bold", opacity: 0.8 },
  title: { color: "#fff", fontSize: 24, fontWeight: "bold", marginTop: 5 },

  // Section header
  listPadding: { padding: 20, paddingBottom: 100 },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  sectionTitle: { fontSize: 20, fontWeight: "bold", color: "#333" },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#2f6deb",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 4,
  },
  addButtonText: { color: "#fff", fontWeight: "bold", fontSize: 14 },

  // Event cards
  eventCard: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderRadius: 14,
    marginBottom: 12,
    alignItems: "center",
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    overflow: "hidden",
  },
  eventTimeBlock: {
    backgroundColor: "#eef2ff",
    paddingHorizontal: 14,
    paddingVertical: 20,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 70,
  },
  eventTime: { fontSize: 15, fontWeight: "bold", color: "#2f6deb" },
  eventDivider: { width: 1, height: "100%", backgroundColor: "#e8e8e8" },
  eventInfo: { flex: 1, paddingHorizontal: 16, paddingVertical: 14 },
  eventActivity: { fontSize: 16, fontWeight: "bold", color: "#1a1a1a" },
  eventPlace: { fontSize: 13, color: "#888", marginTop: 3 },

  // Empty state
  emptyState: { alignItems: "center", marginTop: 60 },
  emptyText: { fontSize: 17, fontWeight: "bold", color: "#aaa", marginTop: 12 },
  emptySubText: { fontSize: 14, color: "#bbb", marginTop: 4 },

  // Modal
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
    color: "#1a1a1a",
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#555",
    marginBottom: 5,
  },
  input: {
    borderWidth: 1,
    borderColor: "#e0e0e0",
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
    fontSize: 15,
    backgroundColor: "#fafafa",
  },
  modalButtons: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
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

  // FAB
  fab: {
    position: "absolute",
    right: 20,
    bottom: 30,
    backgroundColor: "#2f6deb",
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: "center",
    alignItems: "center",
    elevation: 5,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
  },

  // Chat
  backButton: {
    padding: 12,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  backText: { color: "#2f6deb", fontWeight: "bold", fontSize: 14 },
  chatList: { padding: 20 },
  messageBubble: {
    padding: 12,
    borderRadius: 18,
    marginBottom: 10,
    maxWidth: "80%",
  },
  userBubble: {
    alignSelf: "flex-end",
    backgroundColor: "#2f6deb",
    borderBottomRightRadius: 2,
  },
  aiBubble: {
    alignSelf: "flex-start",
    backgroundColor: "#fff",
    borderBottomLeftRadius: 2,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
  },
  messageText: { fontSize: 16 },
  userText: { color: "#fff" },
  aiText: { color: "#333" },
  inputContainer: {
    flexDirection: "row",
    paddingHorizontal: 15,
    paddingTop: 10,
    paddingBottom: Platform.OS === "ios" ? 35 : 15,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#eee",
    alignItems: "center",
  },
  chatInput: {
    flex: 1,
    height: 45,
    backgroundColor: "#f0f2f5",
    borderRadius: 22,
    paddingHorizontal: 20,
    marginRight: 10,
    fontSize: 16,
  },
  sendButton: {
    backgroundColor: "#2f6deb",
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 20,
  },
  sendButtonText: { color: "#fff", fontWeight: "bold" },
});
