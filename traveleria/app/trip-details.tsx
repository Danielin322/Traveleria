import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

export default function TripDetailsScreen() {
  const { title, location, date } = useLocalSearchParams();

  // View states
  const [viewMode, setViewMode] = useState<"itinerary" | "chat">("itinerary");
  const [loading, setLoading] = useState(true);

  // Data states
  const [itinerary, setItinerary] = useState([]);
  const [messages, setMessages] = useState([
    {
      id: "1",
      text: `Hi! I'm your Traveleria AI. Ready to plan your trip to ${location}?`,
      isUser: false,
    },
  ]);
  const [inputText, setInputText] = useState("");

  // 1. Fetch Itinerary from Python Server
  const fetchItinerary = async () => {
    try {
      // Note: We use trip_id '1' as a placeholder for now
      const response = await fetch(
        `http://192.168.0.220:8000/trips/1/itinerary`,
      );
      const data = await response.json();
      setItinerary(data);
    } catch (error) {
      console.error("Error fetching itinerary:", error);
    } finally {
      setLoading(false);
    }
  };

  // 2. Send Chat Message to Python Server
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
      const response = await fetch("http://192.168.0.220:8000/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: currentInput, trip_id: "1" }),
      });

      const data = await response.json();
      const aiResponse = {
        id: (Date.now() + 1).toString(),
        text: data.text,
        isUser: false,
      };
      setMessages((prev) => [...prev, aiResponse]);
    } catch (error) {
      console.error("Chat error:", error);
      // Fallback message in case server is down
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

  // Load data on mount
  useEffect(() => {
    fetchItinerary();
  }, []);

  const renderItineraryItem = ({ item }: { item: any }) => (
    <View style={styles.itineraryCard}>
      <Text style={styles.itineraryTime}>{item.time}</Text>
      <View style={styles.itineraryInfo}>
        <Text style={styles.itineraryPlace}>{item.place}</Text>
        <Text style={styles.itineraryAddress}>{item.address}</Text>
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
        {/* Header Section */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setViewMode("itinerary")}>
            <Text style={styles.locationTag}>
              {location} • {date}
            </Text>
            <Text style={styles.title}>{title}</Text>
          </TouchableOpacity>
        </View>

        {/* Content Section */}
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
                renderItem={renderItineraryItem}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.listPadding}
                ListHeaderComponent={
                  <Text style={styles.sectionTitle}>Daily Plan</Text>
                }
              />
            )}

            {/* Floating Chat Button */}
            <TouchableOpacity
              style={styles.fab}
              onPress={() => setViewMode("chat")}
            >
              <Ionicons name="chatbubble-ellipses" size={30} color="#fff" />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            {/* Back to Itinerary Header */}
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

            {/* AI Chat Input Banner */}
            <View style={styles.inputContainer}>
              <TextInput
                style={styles.input}
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
  header: { padding: 20, backgroundColor: "#2f6deb", paddingBottom: 15 },
  locationTag: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "bold",
    opacity: 0.8,
  },
  title: { color: "#fff", fontSize: 24, fontWeight: "bold", marginTop: 5 },

  // Itinerary Styles
  listPadding: { padding: 20 },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 15,
    color: "#333",
  },
  itineraryCard: {
    flexDirection: "row",
    backgroundColor: "#fff",
    padding: 15,
    borderRadius: 12,
    marginBottom: 10,
    alignItems: "center",
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
  },
  itineraryTime: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#2f6deb",
    width: 60,
  },
  itineraryInfo: {
    borderLeftWidth: 2,
    borderLeftColor: "#eee",
    paddingLeft: 15,
    flex: 1,
  },
  itineraryPlace: { fontSize: 16, fontWeight: "bold", color: "#333" },
  itineraryAddress: { fontSize: 12, color: "#888" },

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

  // Chat Styles
  backButton: {
    padding: 12,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    flexDirection: "row",
    alignItems: "center",
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
  input: {
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
