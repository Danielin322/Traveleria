import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { GooglePlacesAutocomplete } from "react-native-google-places-autocomplete";
import DateTimePickerModal from "react-native-modal-datetime-picker";
import { API_URL } from "../constants/api";
// Import MapView and Marker components for the interactive map
import MapView, { Marker } from "react-native-maps";

export default function TripDetailsScreen() {
  const { id, title, location, date } = useLocalSearchParams();

  const [viewMode, setViewMode] = useState<"itinerary" | "chat">("itinerary");
  const [loading, setLoading] = useState(true);
  const [itinerary, setItinerary] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([
    {
      id: "1",
      text: `Hi! I'm your Traveleria AI. Ready to plan your trip to ${location}?`,
      isUser: false,
    },
  ]);
  const [inputText, setInputText] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [newActivity, setNewActivity] = useState("");
  const [newTime, setNewTime] = useState("");
  const [newPlace, setNewPlace] = useState("");
  const [isTimePickerVisible, setTimePickerVisible] = useState(false);
  const [newLat, setNewLat] = useState<number | null>(null);
  const [newLng, setNewLng] = useState<number | null>(null);
  const [isMapView, setIsMapView] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<any | null>(null);
  const googlePlacesRef = useRef<any>(null);
  const handleConfirmTime = (date: Date) => {
    const hours = date.getHours().toString().padStart(2, "0");
    const minutes = date.getMinutes().toString().padStart(2, "0");
    setNewTime(`${hours}:${minutes}`);
    setTimePickerVisible(false);
  };

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
    // Log the current state values to see what is missing during edit
    console.log("Edit Check:", {
      newActivity,
      newTime,
      newPlace,
      newLat,
      newLng,
      newNotes,
    });

    // Ensure all fields including coordinates are present and not undefined
    if (
      !newActivity ||
      !newTime ||
      !newPlace ||
      newLat === null ||
      newLat === undefined ||
      newLng === null ||
      newLng === undefined
    ) {
      alert(
        "Please make sure to select a valid location from the search suggestions so coordinates are saved.",
      );
      return;
    }

    const eventData = {
      // Keep the existing ID if we are editing, otherwise generate a new one
      id: editingEventId ? editingEventId : Math.random().toString(),
      time: newTime,
      place: newActivity,
      address: newPlace,
      lat: newLat,
      lng: newLng,
      notes: newNotes,
    };

    try {
      const method = editingEventId ? "PUT" : "POST";
      const url = editingEventId
        ? `${API_URL}/trips/${id}/itinerary/${editingEventId}`
        : `${API_URL}/trips/${id}/itinerary`;

      const response = await fetch(url, {
        method: method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(eventData),
      });

      if (response.ok) {
        if (editingEventId) {
          // Update the local state for the edited item
          setItinerary((prev) =>
            sortByTime(
              prev.map((e) => (e.id === editingEventId ? eventData : e)),
            ),
          );
        } else {
          // Add the new item to the local state
          setItinerary((prev) => sortByTime([...prev, eventData]));
        }

        // Reset form and close modal
        setIsModalVisible(false);
        setEditingEventId(null);
        setNewActivity("");
        setNewTime("");
        setNewPlace("");
        setNewLat(null);
        setNewLng(null);
        setNewNotes("");

        if (googlePlacesRef.current) {
          googlePlacesRef.current.setAddressText("");
        }
      } else {
        // Read the exact error message from the server
        const errorText = await response.text();
        console.error("Server rejected the save:", response.status, errorText);
        alert(`Server error ${response.status}. Check terminal for details.`);
      }
    } catch (error) {
      console.error("Error saving event:", error);
    }
  };

  // Function to handle event deletion with confirmation
  const handleDeleteEvent = (eventId: string) => {
    Alert.alert(
      "Delete Event",
      "Are you sure you want to remove this event from your daily plan?",
      [
        {
          // Option to cancel the deletion
          text: "Cancel",
          style: "cancel",
        },
        {
          // Option to proceed with the deletion
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              // Send the DELETE request to the backend API
              const response = await fetch(
                `${API_URL}/trips/${id}/itinerary/${eventId}`,
                {
                  method: "DELETE",
                },
              );

              if (response.ok) {
                // Update the local state by filtering out the removed event
                setItinerary((prev) =>
                  prev.filter((event) => event.id !== eventId),
                );
              }
            } catch (error) {
              // Log any errors during the deletion process
              console.error("Error deleting event:", error);
            }
          },
        },
      ],
    );
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
  const handleNavigate = (lat: number, lng: number, label: string) => {
    // Select the appropriate URL scheme based on the operating system
    const scheme = Platform.select({
      ios: "maps:0,0?q=",
      android: "geo:0,0?q=",
    });

    // Format the coordinates for the map query
    const latLng = `${lat},${lng}`;

    // Create the final navigation URL with a destination label
    const url = Platform.select({
      ios: `${scheme}${label}@${latLng}`,
      android: `${scheme}${latLng}(${label})`,
    });

    if (url) {
      // Open the native maps app on the device
      Linking.openURL(url);
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

      {/* Edit icon button */}
      <TouchableOpacity
        style={{ padding: 15 }}
        onPress={() => openEditModal(item)}
      >
        <Ionicons name="pencil-outline" size={20} color="#2f6deb" />
      </TouchableOpacity>
      {/* Delete icon button on the right side of the card */}
      <TouchableOpacity
        style={styles.deleteIconButton}
        onPress={() => handleDeleteEvent(item.id)}
      >
        <Ionicons name="trash-outline" size={20} color="#ff4d4d" />
      </TouchableOpacity>
    </View>
  );
  const openEditModal = (event: any) => {
    // Populate all the fields with existing data
    setEditingEventId(event.id);
    setNewActivity(event.place);
    setNewTime(event.time);
    setNewPlace(event.address);
    setNewLat(event.lat);
    setNewLng(event.lng);
    setNewNotes(event.notes || "");

    // First, trigger the modal to open
    setIsModalVisible(true);

    // Use a small timeout to ensure the Google Places component is mounted
    // before we try to set its text via the ref
    setTimeout(() => {
      if (googlePlacesRef.current) {
        googlePlacesRef.current.setAddressText(event.address);
      }
    }, 100);
  };

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
            <View
              style={[
                styles.sectionHeader,
                { paddingHorizontal: 20, paddingTop: 15 },
              ]}
            >
              <Text style={styles.sectionTitle}>Daily Plan</Text>

              <View style={{ flexDirection: "row", gap: 10 }}>
                <TouchableOpacity
                  style={styles.iconButton}
                  onPress={() => setIsMapView(!isMapView)}
                >
                  <Ionicons
                    name={isMapView ? "list" : "map"}
                    size={20}
                    color="#2f6deb"
                  />
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.addButton}
                  onPress={() => setIsModalVisible(true)}
                >
                  <Ionicons name="add" size={20} color="#fff" />
                  <Text style={styles.addButtonText}>Add Event</Text>
                </TouchableOpacity>
              </View>
            </View>

            {loading ? (
              <ActivityIndicator
                size="large"
                color="#2f6deb"
                style={{ marginTop: 50 }}
              />
            ) : isMapView ? (
              <View style={styles.mapContainer}>
                <MapView
                  style={styles.map}
                  // Clear selection when tapping anywhere else on the map
                  onPress={() => setSelectedEvent(null)}
                  initialRegion={{
                    latitude:
                      itinerary.length > 0 && itinerary[0].lat
                        ? itinerary[0].lat
                        : 41.8902,
                    longitude:
                      itinerary.length > 0 && itinerary[0].lng
                        ? itinerary[0].lng
                        : 12.4922,
                    latitudeDelta: 0.05,
                    longitudeDelta: 0.05,
                  }}
                >
                  {itinerary.map((item) =>
                    item.lat && item.lng ? (
                      <Marker
                        key={item.id}
                        coordinate={{ latitude: item.lat, longitude: item.lng }}
                        // When a marker is pressed, set it as the selected event
                        onPress={(e) => {
                          // Prevent the map onPress from firing
                          e.stopPropagation();
                          setSelectedEvent(item);
                        }}
                      />
                    ) : null,
                  )}
                </MapView>
                {/* Custom Info Card overlay */}
                {selectedEvent && (
                  <View style={styles.infoCard}>
                    <View style={styles.infoCardHeader}>
                      <Text style={styles.infoCardTitle}>
                        {selectedEvent.place}
                      </Text>
                      <Text style={styles.infoCardTime}>
                        {selectedEvent.time}
                      </Text>
                    </View>
                    <Text style={styles.infoCardAddress} numberOfLines={2}>
                      {selectedEvent.address}
                    </Text>
                    {/* Show notes section only if content exists */}
                    {selectedEvent.notes ? (
                      <Text style={styles.infoCardNotes}>
                        {selectedEvent.notes}
                      </Text>
                    ) : null}
                    {/* Navigation button added to the bottom of the card */}
                    <TouchableOpacity
                      style={styles.navigateButton}
                      onPress={() =>
                        handleNavigate(
                          selectedEvent.lat,
                          selectedEvent.lng,
                          selectedEvent.place,
                        )
                      }
                    >
                      <Ionicons name="navigate" size={18} color="#fff" />
                      <Text style={styles.navigateButtonText}>Navigate</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            ) : (
              <FlatList
                data={itinerary}
                renderItem={renderEventCard}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.listPadding}
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

            <Modal
              visible={isModalVisible}
              animationType="slide"
              transparent={true}
            >
              <TouchableOpacity
                style={styles.modalOverlay}
                activeOpacity={1}
                onPress={Keyboard.dismiss}
              >
                <TouchableWithoutFeedback>
                  <View style={styles.modalContent}>
                    <Text style={styles.modalTitle}>
                      {editingEventId ? "Edit Event" : "New Event"}
                    </Text>
                    {/* 1. Place Search - Moved to the top for better UX */}
                    <Text style={styles.inputLabel}>Place</Text>
                    <View
                      style={{
                        zIndex: 1000,
                        elevation: 10,
                        position: "relative",
                      }}
                    >
                      <GooglePlacesAutocomplete
                        ref={googlePlacesRef}
                        placeholder="e.g. Piazza del Colosseo"
                        // Keep the list open even when user taps outside to dismiss keyboard
                        keepResultsAfterBlur={true}
                        // Fetch full details including geometry for the coordinates
                        fetchDetails={true}
                        onPress={(data, details = null) => {
                          // Set the chosen address
                          setNewPlace(data.description);
                          // Save the coordinates if details are available
                          if (
                            details &&
                            details.geometry &&
                            details.geometry.location
                          ) {
                            setNewLat(details.geometry.location.lat);
                            setNewLng(details.geometry.location.lng);
                          }
                          // Dismiss keyboard after selection
                          Keyboard.dismiss();
                        }}
                        query={{
                          key: process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY,
                          language: "en",
                        }}
                        onFail={(error) =>
                          console.error("Google API Error: ", error)
                        }
                        keyboardShouldPersistTaps="handled"
                        styles={{
                          container: {
                            flex: 0,
                          },
                          textInputContainer: {
                            width: "100%",
                            marginBottom: 14,
                          },
                          textInput: [styles.input, { marginBottom: 0 }],
                          listView: {
                            position: "absolute",
                            top: 50,
                            zIndex: 1000,
                            elevation: 10,
                            backgroundColor: "#fff",
                            borderRadius: 10,
                            shadowColor: "#000",
                            shadowOpacity: 0.1,
                            shadowRadius: 4,
                            shadowOffset: { width: 0, height: 2 },
                          },
                        }}
                        enablePoweredByContainer={false}
                      />
                    </View>

                    {/* 2. Activity Input */}
                    <Text style={styles.inputLabel}>Activity</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="e.g. Visit the Colosseum"
                      value={newActivity}
                      onChangeText={setNewActivity}
                    />

                    {/* 3. Time Input */}
                    <Text style={styles.inputLabel}>Time</Text>

                    {/* Button that looks like an input to trigger the time picker */}
                    <TouchableOpacity
                      style={[styles.input, { justifyContent: "center" }]}
                      onPress={() => setTimePickerVisible(true)}
                    >
                      <Text
                        style={{
                          color: newTime ? "#1a1a1a" : "#aaa",
                          fontSize: 15,
                        }}
                      >
                        {newTime ? newTime : "Select time"}
                      </Text>
                    </TouchableOpacity>

                    {/* The native modal time picker component */}
                    <DateTimePickerModal
                      isVisible={isTimePickerVisible}
                      mode="time"
                      onConfirm={handleConfirmTime}
                      onCancel={() => setTimePickerVisible(false)}
                    />

                    <Text style={styles.inputLabel}>Notes</Text>
                    <TextInput
                      style={[
                        styles.input,
                        { height: 80, textAlignVertical: "top" },
                      ]}
                      placeholder="Special instructions or tips..."
                      value={newNotes}
                      onChangeText={setNewNotes}
                      multiline={true}
                    />

                    <View style={styles.modalButtons}>
                      <TouchableOpacity
                        style={[styles.modalButton, styles.cancelButton]}
                        onPress={() => {
                          setIsModalVisible(false);
                          setEditingEventId(null);
                          setNewActivity("");
                          setNewTime("");
                          setNewPlace("");
                          setNewLat(null);
                          setNewLng(null);
                          setNewNotes("");

                          // Clear the text from the Google Places input
                          googlePlacesRef.current?.setAddressText("");
                        }}
                      >
                        <Text style={styles.cancelButtonText}>Cancel</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.modalButton, styles.saveButton]}
                        onPress={handleAddEvent}
                      >
                        <Text style={styles.saveButtonText}>
                          {editingEventId ? "Save Changes" : "Create"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </TouchableWithoutFeedback>
              </TouchableOpacity>
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
  locationTag: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "bold",
    opacity: 0.8,
  },
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
    // Align the modal content to the top
    justifyContent: "flex-start",
    // Add space to clear the status bar and notch
    paddingTop: 60,
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingHorizontal: 20,
  },
  modalContent: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 25,
    elevation: 5,
    // Ensure the modal content allows the dropdown to float above
    zIndex: 1,
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
  modalButtons: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
  },
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
  deleteIconButton: {
    padding: 15,
    justifyContent: "center",
    alignItems: "center",
  },
  sendButton: {
    backgroundColor: "#2f6deb",
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 20,
  },
  sendButtonText: { color: "#fff", fontWeight: "bold" },
  iconButton: {
    padding: 8,
    backgroundColor: "#eef2ff",
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    width: 40,
    height: 40,
  },
  mapContainer: {
    flex: 1,
    marginHorizontal: 20,
    marginBottom: 100,
    borderRadius: 20,
    overflow: "hidden",
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 5,
  },
  map: {
    width: "100%",
    height: "100%",
  },
  infoCard: {
    position: "absolute",
    bottom: 20,
    left: 20,
    right: 20,
    backgroundColor: "#fff",
    borderRadius: 15,
    padding: 15,
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
  },
  infoCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 5,
  },
  infoCardTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#1a1a1a",
    flex: 1,
  },
  infoCardTime: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#2f6deb",
    marginLeft: 10,
  },
  infoCardAddress: {
    fontSize: 14,
    color: "#666",
  },
  navigateButton: {
    backgroundColor: "#2f6deb",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 12,
    gap: 8,
  },
  navigateButtonText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 14,
  },
  infoCardNotes: {
    fontSize: 13,
    color: "#444",
    fontStyle: "italic",
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#f0f0f0",
  },
});
