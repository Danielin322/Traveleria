import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { AppButton } from "../../components/AppButton";
import { DateRangePicker } from "../../components/DateRangePicker";
import { FormField, useFieldStyles } from "../../components/FormField";
import { API_URL } from "../../constants/api";
import {
  Elevation,
  FontFamily,
  FontSize,
  Radius,
  Spacing,
  ThemeColors,
} from "../../constants/theme";
import { useThemeColors } from "../../contexts/ThemeContext";
import { apiFetch } from "../../services/apiClient";
import {
  formatTripBadge,
  formatTripDates,
  getTripStatus,
  groupTripsByTime,
} from "../../utils/tripFormat";
import {
  LIMITS,
  formatDateRange,
  parseDateRange,
  validateDestination,
  validateTripDates,
  validateTripTitle,
} from "../../utils/validation";

type TripFieldErrors = {
  title?: string;
  location?: string;
  dates?: string;
};

export default function HomeScreen() {
  const [trips, setTrips] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const router = useRouter();
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const fieldStyles = useFieldStyles();

  const [isModalVisible, setIsModalVisible] = useState(false);
  // Null while creating, the trip's id while editing — one modal serves both,
  // the same way the event form in trip-details.tsx does.
  const [editingTripId, setEditingTripId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newLocation, setNewLocation] = useState("");
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [isDatePickerVisible, setDatePickerVisible] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<TripFieldErrors>({});
  const [addError, setAddError] = useState<string | null>(null);
  // Guards against a double tap creating the same trip twice.
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Upcoming trips first (soonest at the top), past trips below.
  const sections = useMemo(() => {
    const { upcoming, past } = groupTripsByTime(trips);
    return [
      ...(upcoming.length ? [{ title: "Upcoming", data: upcoming }] : []),
      ...(past.length ? [{ title: "Past", data: past }] : []),
    ];
  }, [trips]);

  const fetchTrips = async () => {
    if (!API_URL) {
      setError(
        "API URL is not configured. Please set EXPO_PUBLIC_API_URL in your .env file.",
      );
      setLoading(false);
      return;
    }
    try {
      setError(null);
      const response = await apiFetch("/trips");
      const data = await response.json();
      setTrips(data);
    } catch (err) {
      setError(
        "Could not connect to server. Make sure the backend is running.",
      );
      console.error("Error fetching trips:", err);
    } finally {
      setLoading(false);
    }
  };

  /** Pull-to-refresh: reuses fetchTrips but drives the spinner in the list. */
  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchTrips();
    setRefreshing(false);
  };

  // Bulk edit: tick several trips, remove them together.
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const resetTripForm = () => {
    setEditingTripId(null);
    setNewTitle("");
    setNewLocation("");
    setStartDate(null);
    setEndDate(null);
    setFieldErrors({});
    setAddError(null);
  };

  const closeTripModal = () => {
    setIsModalVisible(false);
    resetTripForm();
  };

  const handleConfirmDates = (start: Date, end: Date) => {
    setStartDate(start);
    setEndDate(end);
    setFieldErrors((prev) => ({ ...prev, dates: undefined }));
    setDatePickerVisible(false);
  };

  const openEditTrip = (trip: any) => {
    const parsed = parseDateRange(trip.date);
    setEditingTripId(trip.id);
    setNewTitle(trip.title);
    setNewLocation(trip.location);
    setStartDate(parsed?.start ?? null);
    setEndDate(parsed?.end ?? null);
    setFieldErrors({});
    setAddError(null);
    setIsModalVisible(true);
  };

  const handleAddTrip = async () => {
    // Ignore repeat taps while the first request is still in flight.
    if (isSubmitting) return;

    setAddError(null);

    const errors: TripFieldErrors = {
      title: validateTripTitle(newTitle) ?? undefined,
      location: validateDestination(newLocation) ?? undefined,
      dates: validateTripDates(startDate, endDate) ?? undefined,
    };
    setFieldErrors(errors);

    // Bail out if any rule failed; the messages are already on screen.
    if (errors.title || errors.location || errors.dates) return;

    setIsSubmitting(true);
    try {
      const response = await apiFetch(
        editingTripId ? `/trips/${editingTripId}` : "/trips",
        {
          method: editingTripId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: newTitle.trim(),
            // Non-null: validateTripDates above guarantees both dates are set.
            date: formatDateRange(startDate!, endDate!),
            location: newLocation.trim().toUpperCase(),
          }),
        },
      );

      if (response.ok) {
        // Narrowing the dates deletes nothing, but it can leave events outside
        // the range. Say so rather than letting it be discovered later.
        const data = await response.json().catch(() => null);
        const outside = data?.events_outside_range ?? 0;
        if (editingTripId && outside > 0) {
          Alert.alert(
            "Dates changed",
            `${outside} ${outside === 1 ? "event falls" : "events fall"} outside the new dates. Nothing was deleted — they still appear in the daily plan under their own day.`,
          );
        }
        fetchTrips();
        setIsModalVisible(false);
        resetTripForm();
      } else {
        const data = await response.json();
        setAddError(
          data?.detail ||
            data?.error ||
            `Failed to ${editingTripId ? "update" : "create"} trip.`,
        );
      }
    } catch (err) {
      setAddError("Could not connect to server.");
      console.error("Error saving trip:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  /* ---------------------------------------------------------------- */
  /* Deleting trips                                                     */
  /* ---------------------------------------------------------------- */

  /** Leaving selection always drops the ticks, so no id can go stale. */
  const exitSelection = () => {
    setIsSelecting(false);
    setSelectedIds(new Set());
  };

  const enterSelection = (tripId: string) => {
    setIsSelecting(true);
    setSelectedIds(new Set([tripId]));
  };

  const toggleSelected = (tripId: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(tripId)) next.delete(tripId);
      else next.add(tripId);
      return next;
    });

  const allSelected = trips.length > 0 && selectedIds.size === trips.length;

  const toggleSelectAll = () =>
    setSelectedIds(allSelected ? new Set() : new Set(trips.map((t) => t.id)));

  /** Deletes the given ids, returns the ones that failed. */
  const deleteTrips = async (ids: string[]) => {
    const results = await Promise.allSettled(
      ids.map((tripId) => apiFetch(`/trips/${tripId}`, { method: "DELETE" })),
    );
    const deleted = new Set(
      ids.filter(
        (_, i) =>
          results[i].status === "fulfilled" &&
          (results[i] as PromiseFulfilledResult<Response>).value.ok,
      ),
    );
    setTrips((prev) => prev.filter((t) => !deleted.has(t.id)));
    return ids.filter((tripId) => !deleted.has(tripId));
  };

  /**
   * A trip carries far more than a single event does, so the confirmation
   * names it and counts what goes with it.
   */
  const handleDeleteTrip = (trip: any) => {
    const n = trip.events_count ?? 0;
    Alert.alert(
      `Delete “${trip.title}”?`,
      n > 0
        ? `Its ${n} ${n === 1 ? "event" : "events"} will be deleted too. This cannot be undone.`
        : "This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              const failed = await deleteTrips([trip.id]);
              if (failed.length > 0) {
                Alert.alert("Could not delete", "Please try again.");
              }
            } catch (err) {
              console.error("Error deleting trip:", err);
              Alert.alert("Connection problem", "Could not reach the server.");
            }
          },
        },
      ],
    );
  };

  const handleDeleteSelected = () => {
    if (isBulkDeleting || selectedIds.size === 0) return;

    const ids = [...selectedIds];
    const totalEvents = trips
      .filter((t) => ids.includes(t.id))
      .reduce((sum, t) => sum + (t.events_count ?? 0), 0);

    Alert.alert(
      `Delete ${ids.length} ${ids.length === 1 ? "trip" : "trips"}?`,
      totalEvents > 0
        ? `${totalEvents} ${totalEvents === 1 ? "event" : "events"} will be deleted with them. This cannot be undone.`
        : "This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setIsBulkDeleting(true);
            try {
              const failed = await deleteTrips(ids);
              if (failed.length > 0) {
                // Keep failures ticked so a retry is one tap.
                setSelectedIds(new Set(failed));
                Alert.alert(
                  "Some trips were not deleted",
                  `${failed.length} of ${ids.length} could not be removed. They are still selected — tap delete to try again.`,
                );
              } else {
                exitSelection();
              }
            } catch (err) {
              console.error("Error deleting trips:", err);
              Alert.alert("Connection problem", "Could not reach the server.");
            } finally {
              setIsBulkDeleting(false);
            }
          },
        },
      ],
    );
  };

  useEffect(() => {
    fetchTrips();
  }, []);

  const renderTripItem = ({ item }: { item: any }) => {
    const status = getTripStatus(item.date);
    const badge = formatTripBadge(status);
    const isPast = status?.kind === "past";

    const isSelected = selectedIds.has(item.id);

    return (
      <TouchableOpacity
        style={[
          styles.tripCard,
          isPast && styles.tripCardPast,
          isSelected && styles.tripCardSelected,
        ]}
        onPress={() => {
          // While selecting, the card toggles instead of navigating —
          // opening a trip mid-selection would lose the ticks.
          if (isSelecting) {
            toggleSelected(item.id);
            return;
          }
          router.push({
            pathname: "/trip-details",
            params: {
              id: item.id,
              title: item.title,
              location: item.location,
              date: item.date,
            },
          });
        }}
        onLongPress={() => enterSelection(item.id)}
        delayLongPress={300}
        accessibilityRole={isSelecting ? "checkbox" : "button"}
        accessibilityState={isSelecting ? { checked: isSelected } : undefined}
      >
        <View style={styles.tripInfo}>
          <View style={styles.tripCardTopRow}>
            <Text style={styles.locationText}>{item.location}</Text>
            {badge && (
              <View
                style={[
                  styles.badge,
                  status?.kind === "ongoing" && styles.badgeOngoing,
                ]}
              >
                <Text
                  style={[
                    styles.badgeText,
                    status?.kind === "ongoing" && styles.badgeTextOngoing,
                  ]}
                >
                  {badge}
                </Text>
              </View>
            )}
          </View>
          <Text style={styles.tripTitle}>{item.title}</Text>
          <Text style={styles.dateText}>{formatTripDates(item.date)}</Text>
        </View>

        {isSelecting ? (
          /* Tapping the card is what toggles selection, so this is an
             indicator rather than its own button. */
          <Ionicons
            name={isSelected ? "checkmark-circle" : "ellipse-outline"}
            size={24}
            color={isSelected ? colors.primary : colors.textDisabled}
          />
        ) : (
          <View style={styles.tripActions}>
            <TouchableOpacity
              onPress={() => openEditTrip(item)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={`Edit ${item.title}`}
            >
              <Ionicons name="pencil-outline" size={19} color={colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => handleDeleteTrip(item)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={`Delete ${item.title}`}
            >
              <Ionicons name="trash-outline" size={19} color={colors.danger} />
            </TouchableOpacity>
            <Ionicons name="chevron-forward" size={20} color={colors.primary} />
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const dateSummary =
    startDate && endDate
      ? formatDateRange(startDate, endDate)
      : "Select your dates";

  return (
    <View style={styles.container}>
      {isSelecting ? (
        /* Selection replaces the heading and the Plan Trip button, so the
           only actions on screen are the ones that apply to the ticks. */
        <View style={styles.selectionBar}>
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

          <View style={styles.selectionRight}>
            <TouchableOpacity
              onPress={toggleSelectAll}
              disabled={isBulkDeleting || trips.length === 0}
              accessibilityRole="button"
            >
              <Text style={styles.selectionAction}>
                {allSelected ? "Clear" : "Select all"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleDeleteSelected}
              disabled={isBulkDeleting || selectedIds.size === 0}
              accessibilityRole="button"
              accessibilityLabel={`Delete ${selectedIds.size} selected trips`}
            >
              {isBulkDeleting ? (
                <ActivityIndicator size="small" color={colors.danger} />
              ) : (
                <Ionicons
                  name="trash-outline"
                  size={22}
                  color={
                    selectedIds.size === 0 ? colors.textDisabled : colors.danger
                  }
                />
              )}
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <>
          <View style={styles.titleRow}>
            <Text style={styles.title}>Your Journeys</Text>
            {/* Only offered when there is something to select. */}
            {trips.length > 0 && (
              <TouchableOpacity
                onPress={() => setIsSelecting(true)}
                accessibilityRole="button"
                accessibilityLabel="Select trips to delete"
              >
                <Text style={styles.selectionAction}>Select</Text>
              </TouchableOpacity>
            )}
          </View>
          <Text style={styles.subtitle}>
            Plan, organize, and share your adventures.
          </Text>

          <AppButton
            label="Plan Trip"
            icon="add"
            onPress={() => {
              resetTripForm();
              setIsModalVisible(true);
            }}
            style={styles.planButton}
          />
        </>
      )}

      <Modal visible={isModalVisible} animationType="slide" transparent={true}>
        {/* Keeps the Create button reachable once the keyboard is up. */}
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalOverlay}
        >
          <ScrollView
            contentContainerStyle={styles.modalScrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>
                {editingTripId ? "Edit Journey" : "New Journey"}
              </Text>

              <FormField
                label="Trip Title"
                placeholder="e.g. Summer in Italy"
                value={newTitle}
                error={fieldErrors.title}
                onChangeText={(text) => {
                  setNewTitle(text);
                  if (fieldErrors.title)
                    setFieldErrors((prev) => ({ ...prev, title: undefined }));
                }}
                maxLength={LIMITS.tripTitle.max}
              />

              <FormField
                label="Destination"
                placeholder="e.g. Rome"
                value={newLocation}
                error={fieldErrors.location}
                onChangeText={(text) => {
                  setNewLocation(text);
                  if (fieldErrors.location)
                    setFieldErrors((prev) => ({
                      ...prev,
                      location: undefined,
                    }));
                }}
                maxLength={LIMITS.destination.max}
              />

              {/* Looks like an input, opens the range calendar. */}
              <FormField label="Dates" error={fieldErrors.dates}>
                <TouchableOpacity
                  style={[
                    fieldStyles.input,
                    styles.dateTrigger,
                    !!fieldErrors.dates && fieldStyles.inputError,
                  ]}
                  onPress={() => setDatePickerVisible(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Choose trip dates"
                >
                  <Text
                    style={
                      startDate && endDate
                        ? styles.dateValueText
                        : styles.datePlaceholder
                    }
                  >
                    {dateSummary}
                  </Text>
                  <Ionicons
                    name="calendar-outline"
                    size={20}
                    color={colors.textMuted}
                  />
                </TouchableOpacity>
              </FormField>

              {addError && <Text style={styles.addErrorText}>{addError}</Text>}

              <View style={styles.modalButtons}>
                <AppButton
                  label="Cancel"
                  variant="secondary"
                  onPress={closeTripModal}
                  disabled={isSubmitting}
                  style={styles.modalButton}
                />
                <AppButton
                  label="Create"
                  onPress={handleAddTrip}
                  loading={isSubmitting}
                  style={styles.modalButton}
                />
              </View>
            </View>
          </ScrollView>

          {/*
            Must live INSIDE this Modal, not beside it. React Native cannot
            present a second modal on top of an already-visible one from a
            sibling position — it renders nothing at all.
          */}
          <DateRangePicker
            visible={isDatePickerVisible}
            initialStart={startDate}
            initialEnd={endDate}
            onConfirm={handleConfirmDates}
            onCancel={() => setDatePickerVisible(false)}
          />
        </KeyboardAvoidingView>
      </Modal>

      {loading ? (
        <ActivityIndicator size="large" color={colors.primary} />
      ) : error ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
          <AppButton label="Retry" onPress={fetchTrips} />
        </View>
      ) : (
        <SectionList
          sections={sections}
          renderItem={renderTripItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContainer}
          // Only worth showing a heading once trips actually split into groups.
          renderSectionHeader={({ section }) =>
            sections.length > 1 ? (
              <Text style={styles.sectionHeader}>{section.title}</Text>
            ) : null
          }
          stickySectionHeadersEnabled={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons
                name="airplane-outline"
                size={52}
                color={colors.textDisabled}
              />
              <Text style={styles.emptyText}>No trips yet</Text>
              <Text style={styles.emptySubText}>
                Tap “Plan Trip” to start your first journey.
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
      padding: Spacing.xl,
      paddingTop: 60,
    },
    title: {
      fontSize: FontSize.h1,
      fontFamily: FontFamily.bold,
      color: colors.textPrimary,
    },
    subtitle: {
      fontSize: FontSize.small,
      fontFamily: FontFamily.regular,
      color: colors.textSecondary,
      marginBottom: Spacing.xxl,
    },
    planButton: { marginBottom: Spacing.xl },
    listContainer: { paddingBottom: Spacing.xl },

    tripCard: {
      backgroundColor: colors.surface,
      borderRadius: Radius.lg,
      padding: Spacing.lg,
      marginBottom: Spacing.md,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      ...Elevation.sm,
    },
    // Past trips recede so upcoming ones read as the active content.
    tripCardPast: { opacity: 0.65 },
    tripCardSelected: {
      borderWidth: 2,
      borderColor: colors.primary,
      backgroundColor: colors.primarySoft,
    },
    tripActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.md,
    },

    titleRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    // Occupies the space the heading, subtitle and Plan Trip button leave
    // behind, so entering selection does not shift the list under the finger.
    selectionBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: Spacing.md,
      marginBottom: Spacing.xl,
      minHeight: 52,
    },
    selectionRight: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.lg,
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
    tripInfo: { flex: 1 },
    tripCardTopRow: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: Spacing.xs,
    },
    locationText: {
      fontSize: FontSize.tiny,
      color: colors.primary,
      fontFamily: FontFamily.bold,
      letterSpacing: 0.4,
    },
    tripTitle: {
      fontSize: FontSize.h3,
      fontFamily: FontFamily.semibold,
      color: colors.textPrimary,
    },
    dateText: {
      fontSize: FontSize.small,
      fontFamily: FontFamily.regular,
      color: colors.textSecondary,
      marginTop: Spacing.xs,
    },
    badge: {
      backgroundColor: colors.primarySoft,
      paddingHorizontal: Spacing.sm,
      paddingVertical: 3,
      borderRadius: Radius.sm,
      marginLeft: Spacing.sm,
    },
    badgeText: {
      fontSize: FontSize.tiny,
      fontFamily: FontFamily.bold,
      color: colors.primary,
    },
    badgeOngoing: { backgroundColor: colors.successSoft },
    badgeTextOngoing: { color: colors.success },
    sectionHeader: {
      fontSize: FontSize.caption,
      fontFamily: FontFamily.bold,
      color: colors.textMuted,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: Spacing.sm,
      marginTop: Spacing.xs,
    },

    emptyState: { alignItems: "center", marginTop: 50 },
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
      textAlign: "center",
    },

    modalOverlay: { flex: 1, backgroundColor: colors.overlay },
    // justifyContent here (not on the overlay) so the sheet stays centred
    // while still being able to scroll when the keyboard shrinks the space.
    modalScrollContent: {
      flexGrow: 1,
      justifyContent: "center",
      padding: Spacing.xl,
    },
    modalContent: {
      backgroundColor: colors.surface,
      borderRadius: Radius.xl,
      padding: Spacing.xxl,
      ...Elevation.lg,
    },
    modalTitle: {
      fontSize: FontSize.h2,
      fontFamily: FontFamily.bold,
      marginBottom: Spacing.xl,
      textAlign: "center",
      color: colors.textPrimary,
    },
    dateTrigger: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    dateValueText: {
      fontSize: FontSize.body,
      fontFamily: FontFamily.regular,
      color: colors.textPrimary,
    },
    datePlaceholder: {
      fontSize: FontSize.body,
      fontFamily: FontFamily.regular,
      color: colors.textDisabled,
    },
    modalButtons: { flexDirection: "row", gap: Spacing.md },
    modalButton: { flex: 1 },

    errorContainer: { alignItems: "center", marginTop: 40 },
    errorText: {
      color: colors.danger,
      fontSize: FontSize.small,
      fontFamily: FontFamily.regular,
      textAlign: "center",
      marginBottom: Spacing.lg,
    },
    addErrorText: {
      color: colors.danger,
      fontSize: FontSize.caption,
      fontFamily: FontFamily.regular,
      textAlign: "center",
      marginBottom: Spacing.md,
    },
  });
