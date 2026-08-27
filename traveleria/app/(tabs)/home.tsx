import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
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

  const resetTripForm = () => {
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
      const response = await apiFetch("/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle.trim(),
          // Non-null: validateTripDates above guarantees both dates are set.
          date: formatDateRange(startDate!, endDate!),
          location: newLocation.trim().toUpperCase(),
        }),
      });

      if (response.ok) {
        fetchTrips();
        setIsModalVisible(false);
        resetTripForm();
      } else {
        const data = await response.json();
        setAddError(data?.detail || data?.error || "Failed to create trip.");
      }
    } catch (err) {
      setAddError("Could not connect to server.");
      console.error("Error adding trip:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    fetchTrips();
  }, []);

  const renderTripItem = ({ item }: { item: any }) => {
    const status = getTripStatus(item.date);
    const badge = formatTripBadge(status);
    const isPast = status?.kind === "past";

    return (
      <TouchableOpacity
        style={[styles.tripCard, isPast && styles.tripCardPast]}
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
        <Ionicons name="chevron-forward" size={20} color={colors.primary} />
      </TouchableOpacity>
    );
  };

  const dateSummary =
    startDate && endDate
      ? formatDateRange(startDate, endDate)
      : "Select your dates";

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Your Journeys</Text>
      <Text style={styles.subtitle}>
        Plan, organize, and share your adventures.
      </Text>

      <AppButton
        label="Plan Trip"
        icon="add"
        onPress={() => setIsModalVisible(true)}
        style={styles.planButton}
      />

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
              <Text style={styles.modalTitle}>New Journey</Text>

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
        </KeyboardAvoidingView>
      </Modal>

      <DateRangePicker
        visible={isDatePickerVisible}
        initialStart={startDate}
        initialEnd={endDate}
        onConfirm={handleConfirmDates}
        onCancel={() => setDatePickerVisible(false)}
      />

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
