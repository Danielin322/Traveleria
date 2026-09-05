import { Ionicons } from "@expo/vector-icons";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { GooglePlacesAutocomplete } from "react-native-google-places-autocomplete";
import MapView, { Marker } from "react-native-maps";
import { TripDayTimePicker } from "../components/TripDayTimePicker";
import { TripMembersSheet } from "../components/TripMembersSheet";
import { DARK_MAP_STYLE } from "../constants/mapStyle";
import {
  Elevation,
  FontFamily,
  FontSize,
  Radius,
  Spacing,
  ThemeColors,
} from "../constants/theme";
import { useTheme } from "../contexts/ThemeContext";
import { apiFetch } from "../services/apiClient";
import { DaySection, groupEventsByDay, sortEvents } from "../utils/itinerary";
import {
  LIMITS,
  formatDate,
  parseDate,
  parseDateRange,
  validateActivity,
  validateNotes,
} from "../utils/validation";

type EventFieldErrors = {
  place?: string;
  activity?: string;
  when?: string;
  notes?: string;
};

const renderMessageText = (text: string) =>
  text.split(/(\*\*.*?\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <Text key={index} style={{ fontWeight: "bold" }}>
        {part.slice(2, -2)}
      </Text>
    ) : (
      <Text key={index}>{part}</Text>
    ),
  );

export default function TripDetailsScreen() {
  const { id, title, location, date } = useLocalSearchParams();
  const router = useRouter();

  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

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
  const [newDate, setNewDate] = useState<Date | null>(null);
  const [newPlace, setNewPlace] = useState("");
  const [isWhenPickerVisible, setWhenPickerVisible] = useState(false);
  const [newLat, setNewLat] = useState<number | null>(null);
  const [newLng, setNewLng] = useState<number | null>(null);
  const [isMapView, setIsMapView] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<any | null>(null);
  const [fieldErrors, setFieldErrors] = useState<EventFieldErrors>({});
  // Guards the event form against double submission.
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Drives the "typing" bubble while the assistant composes a reply.
  const [isAiTyping, setIsAiTyping] = useState(false);
  // Bulk edit: tick several events, remove them in one action.
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const googlePlacesRef = useRef<any>(null);
  const chatListRef = useRef<FlatList>(null);
  const chatRevealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Hides the chat list until it has already been scrolled to the latest
  // message, so opening the chat never shows the pre-scroll jump.
  const [isChatReady, setIsChatReady] = useState(false);
  const [isMembersVisible, setMembersVisible] = useState(false);

  // Pings the chat Lambda as soon as the chat view opens, so its cold start
  // happens while the user is still reading/typing rather than on their
  // first real message. Best-effort: a failure here just means no warm-up.
  useEffect(() => {
    if (viewMode === "chat") {
      setIsChatReady(false);
      if (chatRevealTimer.current) clearTimeout(chatRevealTimer.current);
      apiFetch("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ warmup: true }),
      }).catch(() => {});
    }
  }, [viewMode]);

  /**
   * The trip's own dates, which bound the day picker. Null when the screen was
   * opened without the `date` param — then the calendar is simply unbounded
   * rather than the screen refusing to work.
   */
  const tripRange = useMemo(() => parseDateRange(String(date ?? "")), [date]);

  /** Both halves of "when" arrive together, so they are set together. */
  const handleConfirmWhen = (pickedDate: Date, pickedTime: string) => {
    setNewDate(pickedDate);
    setNewTime(pickedTime);
    setFieldErrors((prev) => ({ ...prev, when: undefined }));
    setWhenPickerVisible(false);
  };

  /** Clears one field's error as soon as the user starts correcting it. */
  const clearFieldError = (field: keyof EventFieldErrors) =>
    setFieldErrors((prev) =>
      prev[field] ? { ...prev, [field]: undefined } : prev,
    );

  const resetEventForm = () => {
    setEditingEventId(null);
    setNewActivity("");
    setNewTime("");
    setNewDate(null);
    setNewPlace("");
    setNewLat(null);
    setNewLng(null);
    setNewNotes("");
    setFieldErrors({});
    googlePlacesRef.current?.setAddressText("");
  };

  /**
   * A 404 on a trip that was on screen a moment ago means someone removed us
   * from it, or deleted it. Both are the same to the API — it deliberately
   * cannot tell "not yours" from "not there" — but either way the honest thing
   * is to say so and go back, rather than show an empty itinerary or the
   * generic connection error.
   */
  const handleAccessLost = useCallback(() => {
    Alert.alert(
      "Trip unavailable",
      "This trip is no longer shared with you.",
      [{ text: "OK", onPress: () => router.back() }],
    );
  }, [router]);

  const fetchItinerary = useCallback(async () => {
    try {
      const response = await apiFetch(`/trips/${id}/itinerary`);
      if (response.status === 404) {
        handleAccessLost();
        return;
      }
      const data = await response.json();
      setItinerary(sortEvents(data));
    } catch (error) {
      console.error("Error fetching itinerary:", error);
    } finally {
      setLoading(false);
    }
  }, [id, handleAccessLost]);

  const handleAddEvent = async () => {
    // Ignore repeat taps while the first request is still in flight.
    if (isSubmitting) return;

    // A place is only usable once it carries coordinates, which the Google
    // Places autocomplete attaches when a suggestion is actually tapped.
    const hasCoordinates =
      newLat !== null &&
      newLat !== undefined &&
      newLng !== null &&
      newLng !== undefined;

    const errors: EventFieldErrors = {
      place: !newPlace.trim()
        ? "Place is required."
        : !hasCoordinates
          ? "Pick a place from the suggestions so its location is saved."
          : undefined,
      activity: validateActivity(newActivity) ?? undefined,
      when: !newDate
        ? "Please choose a date and time."
        : !newTime
          ? "Please choose a time."
          : undefined,
      notes: validateNotes(newNotes) ?? undefined,
    };
    setFieldErrors(errors);

    if (errors.place || errors.activity || errors.when || errors.notes) return;

    setIsSubmitting(true);

    const eventData = {
      // Keep the existing ID if we are editing, otherwise generate a new one
      id: editingEventId ? editingEventId : Math.random().toString(),
      // Non-null: the validation above guarantees a date is set.
      date: formatDate(newDate!),
      time: newTime,
      place: newActivity.trim(),
      address: newPlace.trim(),
      lat: newLat,
      lng: newLng,
      notes: newNotes.trim(),
    };

    try {
      const method = editingEventId ? "PUT" : "POST";
      const url = editingEventId
        ? `/trips/${id}/itinerary/${editingEventId}`
        : `/trips/${id}/itinerary`;

      const response = await apiFetch(url, {
        method: method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(eventData),
      });

      if (response.ok) {
        if (editingEventId) {
          setItinerary((prev) =>
            sortEvents(
              prev.map((e) => (e.id === editingEventId ? eventData : e)),
            ),
          );
        } else {
          const data = await response.json();
          setItinerary((prev) => sortEvents([...prev, data.item]));
        }

        // Reset form and close modal
        setIsModalVisible(false);
        resetEventForm();
      } else {
        // Read the exact error message from the server
        const errorText = await response.text();
        console.error("Server rejected the save:", response.status, errorText);
        Alert.alert(
          "Could not save event",
          `The server rejected the request (${response.status}). Please try again.`,
        );
      }
    } catch (error) {
      console.error("Error saving event:", error);
      Alert.alert(
        "Connection problem",
        "Could not reach the server. Check your connection and try again.",
      );
    } finally {
      setIsSubmitting(false);
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
              const response = await apiFetch(
                `/trips/${id}/itinerary/${eventId}`,
                { method: "DELETE" },
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

  /* ---------------------------------------------------------------- */
  /* Bulk selection                                                     */
  /* ---------------------------------------------------------------- */

  /** Leaving selection always drops the ticks, so no id can go stale. */
  const exitSelection = () => {
    setIsSelecting(false);
    setSelectedIds(new Set());
  };

  const enterSelection = (eventId: string) => {
    setIsSelecting(true);
    setSelectedIds(new Set([eventId]));
  };

  const toggleSelected = (eventId: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });

  const allSelected =
    itinerary.length > 0 && selectedIds.size === itinerary.length;

  const toggleSelectAll = () =>
    setSelectedIds(
      allSelected ? new Set() : new Set(itinerary.map((e) => e.id)),
    );

  const handleDeleteSelected = () => {
    if (isBulkDeleting || selectedIds.size === 0) return;

    const count = selectedIds.size;
    Alert.alert(
      `Delete ${count} ${count === 1 ? "event" : "events"}?`,
      "This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setIsBulkDeleting(true);
            const ids = [...selectedIds];
            try {
              // One request per event, over the endpoint that already exists.
              // allSettled rather than all: one failure must not abandon the
              // deletions that did go through.
              const results = await Promise.allSettled(
                ids.map((eventId) =>
                  apiFetch(`/trips/${id}/itinerary/${eventId}`, {
                    method: "DELETE",
                  }),
                ),
              );

              const deleted = new Set(
                ids.filter(
                  (_, i) =>
                    results[i].status === "fulfilled" &&
                    (results[i] as PromiseFulfilledResult<Response>).value.ok,
                ),
              );

              setItinerary((prev) => prev.filter((e) => !deleted.has(e.id)));

              const failed = ids.filter((eventId) => !deleted.has(eventId));
              if (failed.length > 0) {
                // Keep the ones that failed ticked so a retry is one tap.
                setSelectedIds(new Set(failed));
                Alert.alert(
                  "Some events were not deleted",
                  `${failed.length} of ${ids.length} could not be removed. They are still selected — tap delete to try again.`,
                );
              } else {
                exitSelection();
              }
            } catch (error) {
              console.error("Error deleting events:", error);
              Alert.alert(
                "Connection problem",
                "Could not reach the server. Check your connection and try again.",
              );
            } finally {
              setIsBulkDeleting(false);
            }
          },
        },
      ],
    );
  };

  const sendMessage = async () => {
    // Also ignore a second send while the assistant is still replying.
    if (inputText.trim() === "" || isAiTyping) return;

    const userMessage = {
      id: Date.now().toString(),
      text: inputText,
      isUser: true,
    };
    setMessages((prev) => [...prev, userMessage]);

    const currentInput = inputText;
    setInputText("");
    setIsAiTyping(true);

    try {
      const response = await apiFetch("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: currentInput, trip_id: id }),
      });

      if (response.status === 404) {
        handleAccessLost();
        return;
      }

      const data = await response.json();
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          // A non-OK response still parses as JSON, and rendering `undefined`
          // as the assistant's reply is worse than saying what went wrong.
          text: response.ok
            ? data.text
            : data?.detail || "Something went wrong. Please try again.",
          isUser: false,
        },
      ]);

      if (data.added_items?.length) {
        setItinerary((prev) => sortEvents([...prev, ...data.added_items]));
      }

      if (data.removed_item_ids?.length) {
        setItinerary((prev) =>
          prev.filter((item) => !data.removed_item_ids.includes(item.id)),
        );
      }
    } catch (error) {
      console.error("Chat error:", error);
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          text: "Sorry, I'm having trouble connecting to the server.",
          isUser: false,
        },
      ]);
    } finally {
      setIsAiTyping(false);
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

  // On focus rather than on mount: the other person's edits arrive between one
  // look at this screen and the next, and coming back from the members sheet
  // or the map should show them.
  useFocusEffect(
    useCallback(() => {
      fetchItinerary();
    }, [fetchItinerary]),
  );

  useEffect(() => {
    const fetchChatHistory = async () => {
      try {
        const response = await apiFetch(`/chat?trip_id=${id}`);
        const data = await response.json();
        if (Array.isArray(data) && data.length > 0) {
          setMessages(data);
        }
      } catch (error) {
        console.error("Error fetching chat history:", error);
      }
    };
    fetchChatHistory();
  }, []);

  const daySections = useMemo(
    () => groupEventsByDay(itinerary, tripRange),
    [itinerary, tripRange],
  );

  const renderDayHeader = ({ section }: { section: DaySection }) => (
    <View style={styles.dayHeader}>
      <Text style={styles.dayNumber}>DAY {section.dayNumber}</Text>
      <Text style={styles.dayDot}>·</Text>
      <Text style={styles.dayDate}>{section.title}</Text>
      {/* Omitted at zero — the placeholder below already says as much. */}
      {section.data.length > 0 && (
        <Text style={styles.dayCount}>
          {section.data.length} {section.data.length === 1 ? "event" : "events"}
        </Text>
      )}
    </View>
  );

  /**
   * An empty day is the fastest way to add something to that day, so the
   * placeholder is the tap target rather than a dead message. It is drawn as
   * a dashed outline, not a filled card, so a mostly-empty trip does not read
   * as a wall of content.
   */
  const renderEmptyDay = ({ section }: { section: DaySection }) =>
    section.data.length > 0 ? null : (
      <TouchableOpacity
        style={styles.emptyDay}
        // Inert while selecting — there is nothing here to select, and
        // opening the form mid-selection would be a surprise.
        disabled={isSelecting}
        onPress={() => openAddModalForDate(section.date)}
        accessibilityRole="button"
        accessibilityLabel={`Nothing planned on ${section.title}. Tap to add an event.`}
      >
        <Ionicons
          name="sparkles-outline"
          size={18}
          color={colors.textDisabled}
        />
        <View style={styles.emptyDayText}>
          <Text style={styles.emptyDayTitle}>Nothing planned yet</Text>
          <Text style={styles.emptyDayHint}>
            Tap to add something to this day
          </Text>
        </View>
      </TouchableOpacity>
    );

  const renderEventCard = ({ item }: { item: any }) => {
    const isSelected = selectedIds.has(item.id);

    return (
      <TouchableOpacity
        style={[styles.eventCard, isSelected && styles.eventCardSelected]}
        // Outside selection mode the card itself is inert; the pencil and the
        // trash are the only targets, exactly as before.
        activeOpacity={isSelecting ? 0.7 : 1}
        onPress={() => isSelecting && toggleSelected(item.id)}
        onLongPress={() => enterSelection(item.id)}
        delayLongPress={300}
        accessibilityRole={isSelecting ? "checkbox" : undefined}
        accessibilityState={isSelecting ? { checked: isSelected } : undefined}
      >
        <View style={styles.eventTimeBlock}>
          <Text style={styles.eventTime}>{item.time}</Text>
        </View>
        <View style={styles.eventDivider} />
        <View style={styles.eventInfo}>
          <Text style={styles.eventActivity}>{item.place}</Text>
          <Text style={styles.eventPlace}>{item.address}</Text>
          {/* Only on a co-editor's event. Your own needs no label, and events
              from before authorship existed have nothing honest to show. */}
          {item.added_by && !item.added_by_you && (
            <Text style={styles.eventAuthor}>Added by {item.added_by}</Text>
          )}
        </View>

        {isSelecting ? (
          /* Tapping the card is what toggles selection, so this is an
             indicator rather than its own button. */
          <View style={styles.selectIcon}>
            <Ionicons
              name={isSelected ? "checkmark-circle" : "ellipse-outline"}
              size={24}
              color={isSelected ? colors.primary : colors.textDisabled}
            />
          </View>
        ) : (
          <>
            {/* Edit icon button */}
            <TouchableOpacity
              style={{ padding: 15 }}
              onPress={() => openEditModal(item)}
            >
              <Ionicons
                name="pencil-outline"
                size={20}
                color={colors.primary}
              />
            </TouchableOpacity>
            {/* Delete icon button on the right side of the card */}
            <TouchableOpacity
              style={styles.deleteIconButton}
              onPress={() => handleDeleteEvent(item.id)}
            >
              <Ionicons name="trash-outline" size={20} color={colors.danger} />
            </TouchableOpacity>
          </>
        )}
      </TouchableOpacity>
    );
  };
  /**
   * Opens a blank form already pointed at one day — what an empty day's
   * placeholder does, so adding to day 4 is a single tap.
   */
  const openAddModalForDate = (day: Date) => {
    resetEventForm();
    setNewDate(day);
    setIsModalVisible(true);
  };

  const openEditModal = (event: any) => {
    // Populate all the fields with existing data
    setEditingEventId(event.id);
    setNewActivity(event.place);
    setNewTime(event.time);
    setNewDate(event.date ? parseDate(event.date) : null);
    setNewPlace(event.address);
    setNewLat(event.lat);
    setNewLng(event.lng);
    setNewNotes(event.notes || "");
    // Start clean so errors from a previous edit do not carry over.
    setFieldErrors({});

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
    <SafeAreaView
      style={[styles.safeArea, viewMode === "chat" && styles.safeAreaChat]}
    >
      {/* Disables the modal's swipe-down-to-dismiss only while chatting, so
          the sole way out of the chat is the "Back to Itinerary" button. */}
      <Stack.Screen options={{ gestureEnabled: viewMode !== "chat" }} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.container}
        keyboardVerticalOffset={Platform.OS === "ios" ? 110 : 20}
      >
        {/* Header. Turns teal in the chat, so entering the assistant is a
            visible change of place rather than a swapped list. */}
        <View
          style={[styles.header, viewMode === "chat" && styles.headerChat]}
        >
          <Text style={styles.locationTag}>
            {location} • {date}
          </Text>
          <View style={styles.headerRow}>
            <Text style={styles.title}>{title}</Text>
            {/* Itinerary only. The header is shared by both views, but members
                are a property of the trip, not of the conversation, and the
                sheet opening over the chat put a second way out of a screen
                whose only exit is meant to be "Back to Itinerary". */}
            {viewMode !== "chat" && (
              <TouchableOpacity
                style={styles.membersButton}
                onPress={() => setMembersVisible(true)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Trip members"
              >
                <Ionicons
                  name="people-outline"
                  size={22}
                  color={colors.primaryContrast}
                />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {viewMode === "itinerary" ? (
          <View style={{ flex: 1 }}>
            <View
              style={[
                styles.sectionHeader,
                { paddingHorizontal: 20, paddingTop: 15 },
              ]}
            >
              {isSelecting ? (
                /* Selection turns the header into its own toolbar, so there
                   is exactly one thing to do while events are ticked. */
                <>
                  <TouchableOpacity
                    onPress={exitSelection}
                    disabled={isBulkDeleting}
                    accessibilityRole="button"
                  >
                    <Text style={styles.selectionAction}>Cancel</Text>
                  </TouchableOpacity>

                  <Text style={styles.selectionCount}>
                    {selectedIds.size} selected
                  </Text>

                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 14,
                    }}
                  >
                    <TouchableOpacity
                      onPress={toggleSelectAll}
                      disabled={isBulkDeleting || itinerary.length === 0}
                      accessibilityRole="button"
                    >
                      <Text style={styles.selectionAction}>
                        {allSelected ? "Clear" : "Select all"}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.iconButton}
                      onPress={handleDeleteSelected}
                      disabled={isBulkDeleting || selectedIds.size === 0}
                      accessibilityRole="button"
                      accessibilityLabel={`Delete ${selectedIds.size} selected events`}
                    >
                      {isBulkDeleting ? (
                        <ActivityIndicator size="small" color={colors.danger} />
                      ) : (
                        <Ionicons
                          name="trash-outline"
                          size={20}
                          color={
                            selectedIds.size === 0
                              ? colors.textDisabled
                              : colors.danger
                          }
                        />
                      )}
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <>
                  <Text style={styles.sectionTitle}>Daily Plan</Text>

                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    {/* Only offered when there is something to select. */}
                    {itinerary.length > 0 && !isMapView && (
                      <TouchableOpacity
                        onPress={() => setIsSelecting(true)}
                        accessibilityRole="button"
                        accessibilityLabel="Select events to delete"
                      >
                        <Text style={styles.selectionAction}>Select</Text>
                      </TouchableOpacity>
                    )}

                    <TouchableOpacity
                      style={styles.iconButton}
                      onPress={() => setIsMapView(!isMapView)}
                    >
                      <Ionicons
                        name={isMapView ? "list" : "map"}
                        size={20}
                        color={colors.primary}
                      />
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.addButton}
                      onPress={() => setIsModalVisible(true)}
                    >
                      <Ionicons
                        name="add"
                        size={20}
                        color={colors.primaryContrast}
                      />
                      <Text style={styles.addButtonText}>Add Event</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>

            {loading ? (
              <ActivityIndicator
                size="large"
                color={colors.primary}
                style={{ marginTop: 50 }}
              />
            ) : isMapView ? (
              <View style={styles.mapContainer}>
                <MapView
                  style={styles.map}
                  // Google Maps does not follow the app theme by itself.
                  customMapStyle={isDark ? DARK_MAP_STYLE : []}
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
                      <Ionicons
                        name="navigate"
                        size={18}
                        color={colors.primaryContrast}
                      />
                      <Text style={styles.navigateButtonText}>Navigate</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            ) : (
              <SectionList
                sections={daySections}
                renderItem={renderEventCard}
                renderSectionHeader={renderDayHeader}
                renderSectionFooter={renderEmptyDay}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.listPadding}
                // Keeps the day you are scrolling through named at all times.
                stickySectionHeadersEnabled
                // Every trip day is a section, so the list is only truly empty
                // when the trip has no dates to build sections from.
                ListHeaderComponent={
                  itinerary.length === 0 ? (
                    <View style={styles.emptyState}>
                      <Ionicons
                        name="calendar-outline"
                        size={48}
                        color={colors.textDisabled}
                      />
                      <Text style={styles.emptyText}>No events yet.</Text>
                      <Text style={styles.emptySubText}>
                        Tap a day below, or “Add Event”, to start planning.
                      </Text>
                    </View>
                  ) : null
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
                        textInputProps={{
                          placeholderTextColor: colors.textDisabled,
                        }}
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
                            clearFieldError("place");
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
                            backgroundColor: colors.surface,
                            borderRadius: 10,
                            shadowColor: "#000",
                            shadowOpacity: 0.1,
                            shadowRadius: 4,
                            shadowOffset: { width: 0, height: 2 },
                          },
                          row: { backgroundColor: colors.surface },
                          description: { color: colors.textPrimary },
                          separator: { backgroundColor: colors.border },
                        }}
                        enablePoweredByContainer={false}
                      />
                    </View>
                    {fieldErrors.place && (
                      <Text style={styles.fieldErrorText}>
                        {fieldErrors.place}
                      </Text>
                    )}

                    {/* 2. Activity Input */}
                    <Text style={styles.inputLabel}>Activity</Text>
                    <TextInput
                      style={[
                        styles.input,
                        fieldErrors.activity && styles.inputError,
                      ]}
                      placeholder="e.g. Visit the Colosseum"
                      placeholderTextColor={colors.textDisabled}
                      value={newActivity}
                      onChangeText={(text) => {
                        setNewActivity(text);
                        clearFieldError("activity");
                      }}
                      maxLength={LIMITS.activity.max}
                    />
                    {fieldErrors.activity && (
                      <Text style={styles.fieldErrorText}>
                        {fieldErrors.activity}
                      </Text>
                    )}

                    {/* 3. When — one field holding both the day and the time */}
                    <Text style={styles.inputLabel}>When</Text>

                    {/* Button that looks like an input to trigger the picker */}
                    <TouchableOpacity
                      style={[
                        styles.input,
                        { justifyContent: "center" },
                        fieldErrors.when && styles.inputError,
                      ]}
                      onPress={() => setWhenPickerVisible(true)}
                      accessibilityRole="button"
                      accessibilityLabel="Choose the day and time for this activity"
                    >
                      <Text
                        style={
                          newDate && newTime
                            ? styles.timeValue
                            : styles.timePlaceholder
                        }
                      >
                        {newDate && newTime
                          ? `${formatDate(newDate)} · ${newTime}`
                          : "Select date and time"}
                      </Text>
                    </TouchableOpacity>
                    {fieldErrors.when && (
                      <Text style={styles.fieldErrorText}>
                        {fieldErrors.when}
                      </Text>
                    )}

                    {/* Trip calendar, then the scroll wheel. Both values land
                        together, so the field is never half set. */}
                    <TripDayTimePicker
                      visible={isWhenPickerVisible}
                      tripStart={tripRange?.start ?? null}
                      tripEnd={tripRange?.end ?? null}
                      initialDate={newDate}
                      initialTime={newTime}
                      onConfirm={handleConfirmWhen}
                      onCancel={() => setWhenPickerVisible(false)}
                    />

                    <Text style={styles.inputLabel}>Notes</Text>
                    <TextInput
                      style={[
                        styles.input,
                        { height: 80, textAlignVertical: "top" },
                        fieldErrors.notes && styles.inputError,
                      ]}
                      placeholder="Special instructions or tips..."
                      placeholderTextColor={colors.textDisabled}
                      value={newNotes}
                      onChangeText={(text) => {
                        setNewNotes(text);
                        clearFieldError("notes");
                      }}
                      multiline={true}
                      maxLength={LIMITS.notes.max}
                    />
                    {fieldErrors.notes && (
                      <Text style={styles.fieldErrorText}>
                        {fieldErrors.notes}
                      </Text>
                    )}

                    <View style={styles.modalButtons}>
                      <TouchableOpacity
                        style={[styles.modalButton, styles.cancelButton]}
                        onPress={() => {
                          setIsModalVisible(false);
                          resetEventForm();
                        }}
                        disabled={isSubmitting}
                      >
                        <Text style={styles.cancelButtonText}>Cancel</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          styles.modalButton,
                          styles.saveButton,
                          isSubmitting && styles.buttonDisabled,
                        ]}
                        onPress={handleAddEvent}
                        disabled={isSubmitting}
                      >
                        {isSubmitting ? (
                          <ActivityIndicator
                            size="small"
                            color={colors.primaryContrast}
                          />
                        ) : (
                          <Text style={styles.saveButtonText}>
                            {editingEventId ? "Save Changes" : "Create"}
                          </Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                </TouchableWithoutFeedback>
              </TouchableOpacity>
            </Modal>

            {/* Chat FAB — hidden while selecting, so the only actions on
                screen are the ones that apply to the ticked events. */}
            {!isSelecting && (
              <TouchableOpacity
                style={styles.fab}
                onPress={() => setViewMode("chat")}
              >
                <Ionicons
                  name="chatbubble-ellipses"
                  size={30}
                  color={colors.primaryContrast}
                />
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <View style={styles.chatBody}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => setViewMode("itinerary")}
            >
              <Text style={styles.backText}>{"<"} Back to Itinerary</Text>
            </TouchableOpacity>

            <FlatList
              ref={chatListRef}
              data={messages}
              style={{ opacity: isChatReady ? 1 : 0 }}
              keyboardShouldPersistTaps="handled"
              onScrollBeginDrag={Keyboard.dismiss}
              // Fires once real content height is known — on first load with
              // history, on every new message, and when the typing bubble
              // appears/disappears. Scrolling here (rather than in a plain
              // useEffect) avoids racing the list's own layout pass. The
              // opacity flip only matters the first time: it reveals the
              // list already sitting at the bottom, instead of the pre-scroll
              // jump from the top.
              onContentSizeChange={() => {
                chatListRef.current?.scrollToEnd({ animated: false });
                // Content height can settle over several layout passes (each
                // re-firing this callback), so revealing after a fixed delay
                // from the first one can still catch a mid-settling jump.
                // Debouncing instead means we only reveal once the size has
                // stopped changing, at the true final scroll position.
                if (chatRevealTimer.current)
                  clearTimeout(chatRevealTimer.current);
                chatRevealTimer.current = setTimeout(
                  () => setIsChatReady(true),
                  100,
                );
              }}
              renderItem={({ item }) => (
                <View
                  style={[
                    styles.messageBubble,
                    item.isUser ? styles.userBubble : styles.aiBubble,
                  ]}
                >
                  <Text
                    selectable
                    style={[
                      styles.messageText,
                      item.isUser ? styles.userText : styles.aiText,
                    ]}
                  >
                    {renderMessageText(item.text)}
                  </Text>
                </View>
              )}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.chatList}
              // "Typing" bubble sits at the end of the thread while we wait.
              ListFooterComponent={
                isAiTyping ? (
                  <View
                    style={[
                      styles.messageBubble,
                      styles.aiBubble,
                      styles.typingBubble,
                    ]}
                  >
                    <ActivityIndicator size="small" color={colors.assistant} />
                    <Text style={styles.typingText}>
                      Traveleria AI is typing…
                    </Text>
                  </View>
                ) : null
              }
            />

            <View style={styles.inputContainer}>
              <TextInput
                style={styles.chatInput}
                placeholder="Ask the AI assistant..."
                placeholderTextColor={colors.textDisabled}
                value={inputText}
                onChangeText={setInputText}
                editable={!isAiTyping}
                onSubmitEditing={sendMessage}
                returnKeyType="send"
                multiline
              />
              <TouchableOpacity
                style={[
                  styles.sendButton,
                  (isAiTyping || !inputText.trim()) && styles.buttonDisabled,
                ]}
                onPress={sendMessage}
                disabled={isAiTyping || !inputText.trim()}
              >
                <Text style={styles.sendButtonText}>Send</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>

      <TripMembersSheet
        visible={isMembersVisible}
        onClose={() => setMembersVisible(false)}
        tripId={String(id)}
        tripTitle={String(title)}
        onChanged={fetchItinerary}
        onLeft={() => router.back()}
      />
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.primary },
    // Paints the notch and status-bar inset to match the header underneath it.
    safeAreaChat: { backgroundColor: colors.assistant },
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      padding: Spacing.xl,
      backgroundColor: colors.primary,
      paddingBottom: Spacing.xl,
    },
    headerChat: { backgroundColor: colors.assistant },
    locationTag: {
      color: colors.primaryContrast,
      fontSize: FontSize.caption,
      fontFamily: FontFamily.bold,
      opacity: 0.85,
      letterSpacing: 0.4,
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    title: {
      color: colors.primaryContrast,
      fontSize: FontSize.h2,
      fontFamily: FontFamily.bold,
      marginTop: Spacing.xs + 1,
      flex: 1,
      marginRight: Spacing.md,
    },
    membersButton: {
      width: 38,
      height: 38,
      borderRadius: Radius.pill,
      alignItems: "center",
      justifyContent: "center",
      // A translucent white disc, so the icon stays legible on the brand blue
      // without introducing a second colour into the header.
      backgroundColor: "rgba(255, 255, 255, 0.18)",
    },

    listPadding: { padding: Spacing.xl, paddingBottom: 100 },
    sectionHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: Spacing.lg,
    },
    sectionTitle: {
      fontSize: FontSize.h3,
      fontFamily: FontFamily.semibold,
      color: colors.textPrimary,
    },
    addButton: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.primary,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.sm,
      borderRadius: Radius.xl,
      gap: Spacing.xs,
    },
    addButtonText: {
      color: colors.primaryContrast,
      fontFamily: FontFamily.semibold,
      fontSize: FontSize.small,
    },

    // Day separator. Sticky, so it needs an opaque background of its own —
    // a transparent header would let event cards scroll through it.
    dayHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.xs + 2,
      backgroundColor: colors.background,
      paddingTop: Spacing.md,
      paddingBottom: Spacing.sm,
    },
    dayNumber: {
      fontSize: FontSize.caption,
      fontFamily: FontFamily.bold,
      color: colors.primary,
      letterSpacing: 0.8,
    },
    dayDot: {
      fontSize: FontSize.caption,
      color: colors.textDisabled,
    },
    dayDate: {
      fontSize: FontSize.caption,
      fontFamily: FontFamily.semibold,
      color: colors.textSecondary,
    },
    dayCount: {
      marginLeft: "auto",
      fontSize: FontSize.tiny,
      fontFamily: FontFamily.regular,
      color: colors.textMuted,
    },

    // A slot waiting to be filled, not a card. Dashed and transparent so it
    // recedes behind the real events on a mostly-empty trip.
    emptyDay: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.md,
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: colors.border,
      borderRadius: Radius.lg,
      paddingVertical: Spacing.lg,
      paddingHorizontal: Spacing.lg,
      marginBottom: Spacing.md,
    },
    emptyDayText: { flex: 1 },
    emptyDayTitle: {
      fontSize: FontSize.small,
      fontFamily: FontFamily.medium,
      color: colors.textSecondary,
    },
    emptyDayHint: {
      fontSize: FontSize.caption,
      fontFamily: FontFamily.regular,
      color: colors.textMuted,
      marginTop: 2,
    },

    selectionCount: {
      fontSize: FontSize.body,
      fontFamily: FontFamily.semibold,
      color: colors.textPrimary,
    },
    selectionAction: {
      fontSize: FontSize.small,
      fontFamily: FontFamily.semibold,
      color: colors.primary,
    },
    selectIcon: { paddingHorizontal: Spacing.lg },

    eventCard: {
      flexDirection: "row",
      backgroundColor: colors.surface,
      borderRadius: Radius.lg,
      marginBottom: Spacing.md,
      alignItems: "center",
      ...Elevation.sm,
      overflow: "hidden",
    },
    eventAuthor: {
      fontSize: FontSize.tiny,
      fontFamily: FontFamily.regular,
      color: colors.shared,
      marginTop: 2,
    },
    eventCardSelected: {
      borderWidth: 2,
      borderColor: colors.primary,
      backgroundColor: colors.primarySoft,
    },
    eventTimeBlock: {
      backgroundColor: colors.primarySoft,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.xl,
      alignItems: "center",
      justifyContent: "center",
      minWidth: 70,
    },
    eventTime: {
      fontSize: FontSize.small,
      fontFamily: FontFamily.bold,
      color: colors.primary,
    },
    eventDivider: { width: 1, height: "100%", backgroundColor: colors.border },
    eventInfo: {
      flex: 1,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.lg,
    },
    eventActivity: {
      fontSize: FontSize.body,
      fontFamily: FontFamily.semibold,
      color: colors.textPrimary,
    },
    eventPlace: {
      fontSize: FontSize.caption,
      fontFamily: FontFamily.regular,
      color: colors.textMuted,
      marginTop: 3,
    },

    emptyState: { alignItems: "center", marginTop: 60 },
    emptyText: {
      fontSize: FontSize.h3,
      fontFamily: FontFamily.semibold,
      color: colors.textMuted,
      marginTop: Spacing.md,
    },
    emptySubText: {
      fontSize: FontSize.small,
      fontFamily: FontFamily.regular,
      color: colors.textDisabled,
      marginTop: Spacing.xs,
    },

    modalOverlay: {
      flex: 1,
      justifyContent: "flex-start",
      paddingTop: 60,
      backgroundColor: colors.overlay,
      paddingHorizontal: Spacing.xl,
    },
    modalContent: {
      backgroundColor: colors.surface,
      borderRadius: Radius.xl,
      padding: Spacing.xxl,
      ...Elevation.lg,
      zIndex: 1,
    },
    modalTitle: {
      fontSize: FontSize.h2,
      fontFamily: FontFamily.bold,
      marginBottom: Spacing.xl,
      textAlign: "center",
      color: colors.textPrimary,
    },
    inputLabel: {
      fontSize: FontSize.caption,
      fontFamily: FontFamily.semibold,
      color: colors.textSecondary,
      marginBottom: Spacing.xs + 1,
    },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: Radius.md,
      padding: Spacing.md,
      marginBottom: Spacing.lg,
      fontSize: FontSize.small,
      fontFamily: FontFamily.regular,
      color: colors.textPrimary,
      backgroundColor: colors.surfaceSunken,
    },
    inputError: { borderColor: colors.danger },
    fieldErrorText: {
      color: colors.danger,
      fontSize: FontSize.caption,
      fontFamily: FontFamily.regular,
      // Pulls the message up against the field it belongs to.
      marginTop: -Spacing.md,
      marginBottom: Spacing.md,
    },
    timeValue: {
      color: colors.textPrimary,
      fontSize: FontSize.small,
      fontFamily: FontFamily.regular,
    },
    timePlaceholder: {
      color: colors.textDisabled,
      fontSize: FontSize.small,
      fontFamily: FontFamily.regular,
    },
    modalButtons: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: Spacing.xs,
    },
    modalButton: {
      flex: 1,
      padding: Spacing.lg,
      borderRadius: Radius.md,
      alignItems: "center",
      marginHorizontal: Spacing.xs + 1,
    },
    cancelButton: { backgroundColor: colors.surfaceAlt },
    saveButton: { backgroundColor: colors.primary },
    cancelButtonText: {
      color: colors.textSecondary,
      fontFamily: FontFamily.semibold,
    },
    saveButtonText: {
      color: colors.primaryContrast,
      fontFamily: FontFamily.semibold,
    },
    buttonDisabled: { opacity: 0.5 },

    fab: {
      position: "absolute",
      right: Spacing.xl,
      bottom: Spacing.xxxl,
      backgroundColor: colors.primary,
      width: 60,
      height: 60,
      borderRadius: 30,
      justifyContent: "center",
      alignItems: "center",
      ...Elevation.lg,
    },

    // The tinted floor of the conversation. Bubbles are cards on top of it,
    // so the AI's white `surface` reads as raised instead of blending into a
    // white page.
    chatBody: { flex: 1, backgroundColor: colors.assistantSoft },
    backButton: {
      padding: Spacing.md,
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    backText: {
      color: colors.assistant,
      fontFamily: FontFamily.semibold,
      fontSize: FontSize.small,
    },
    chatList: { padding: Spacing.xl },
    messageBubble: {
      padding: Spacing.md,
      borderRadius: 18,
      marginBottom: Spacing.md,
      maxWidth: "80%",
    },
    userBubble: {
      alignSelf: "flex-end",
      backgroundColor: colors.assistant,
      borderBottomRightRadius: 2,
    },
    aiBubble: {
      alignSelf: "flex-start",
      backgroundColor: colors.surface,
      borderBottomLeftRadius: 2,
      ...Elevation.sm,
    },
    messageText: { fontSize: FontSize.body, fontFamily: FontFamily.regular },
    userText: { color: colors.assistantContrast },
    aiText: { color: colors.textPrimary },
    typingBubble: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.sm,
    },
    typingText: {
      fontSize: FontSize.small,
      fontFamily: FontFamily.regular,
      color: colors.textMuted,
      fontStyle: "italic",
    },
    inputContainer: {
      flexDirection: "row",
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.md,
      paddingBottom: Platform.OS === "ios" ? 35 : Spacing.lg,
      backgroundColor: colors.surface,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      alignItems: "center",
    },
    chatInput: {
      flex: 1,
      minHeight: 45,
      maxHeight: 120,
      backgroundColor: colors.surfaceSunken,
      borderRadius: 22,
      paddingHorizontal: Spacing.xl,
      paddingVertical: Spacing.sm,
      marginRight: Spacing.md,
      fontSize: FontSize.body,
      fontFamily: FontFamily.regular,
      color: colors.textPrimary,
    },
    deleteIconButton: {
      padding: Spacing.lg,
      justifyContent: "center",
      alignItems: "center",
    },
    sendButton: {
      backgroundColor: colors.assistant,
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.xl,
      borderRadius: Radius.xl,
    },
    sendButtonText: {
      color: colors.assistantContrast,
      fontFamily: FontFamily.semibold,
    },
    iconButton: {
      padding: Spacing.sm,
      backgroundColor: colors.primarySoft,
      borderRadius: Radius.xl,
      justifyContent: "center",
      alignItems: "center",
      width: 40,
      height: 40,
    },

    mapContainer: {
      flex: 1,
      marginHorizontal: Spacing.xl,
      marginBottom: 100,
      borderRadius: Radius.xl,
      overflow: "hidden",
      ...Elevation.md,
    },
    map: { width: "100%", height: "100%" },
    infoCard: {
      position: "absolute",
      bottom: Spacing.xl,
      left: Spacing.xl,
      right: Spacing.xl,
      backgroundColor: colors.surface,
      borderRadius: Radius.lg,
      padding: Spacing.lg,
      ...Elevation.lg,
    },
    infoCardHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: Spacing.xs + 1,
    },
    infoCardTitle: {
      fontSize: FontSize.h3,
      fontFamily: FontFamily.semibold,
      color: colors.textPrimary,
      flex: 1,
    },
    infoCardTime: {
      fontSize: FontSize.small,
      fontFamily: FontFamily.bold,
      color: colors.primary,
      marginLeft: Spacing.md,
    },
    infoCardAddress: {
      fontSize: FontSize.small,
      fontFamily: FontFamily.regular,
      color: colors.textSecondary,
    },
    navigateButton: {
      backgroundColor: colors.primary,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: Spacing.md,
      borderRadius: Radius.md,
      marginTop: Spacing.md,
      gap: Spacing.sm,
    },
    navigateButtonText: {
      color: colors.primaryContrast,
      fontFamily: FontFamily.semibold,
      fontSize: FontSize.small,
    },
    infoCardNotes: {
      fontSize: FontSize.caption,
      fontFamily: FontFamily.regular,
      color: colors.textSecondary,
      fontStyle: "italic",
      marginTop: Spacing.sm,
      paddingTop: Spacing.sm,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
  });
