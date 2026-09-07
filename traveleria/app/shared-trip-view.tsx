import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  SectionList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import {
  Elevation,
  FontFamily,
  FontSize,
  Radius,
  Spacing,
  ThemeColors,
} from "../constants/theme";
import { useThemeColors } from "../contexts/ThemeContext";
import {
  SharedTripDetail,
  copySharedTrip,
  getSharedTrip,
} from "../services/socialService";
import { DaySection, groupEventsByDay } from "../utils/itinerary";
import { formatTripDates } from "../utils/tripFormat";
import { parseDateRange } from "../utils/validation";

export default function SharedTripViewScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const tripId = params.id as string;

  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [trip, setTrip] = useState<SharedTripDetail | null>(null);
  const [daySections, setDaySections] = useState<DaySection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);

  const load = useCallback(async () => {
    if (!tripId) return;
    try {
      setError(null);
      const { trip: tripData, itinerary } = await getSharedTrip(tripId);
      setTrip(tripData);
      const tripRange = parseDateRange(tripData.date);
      setDaySections(groupEventsByDay(itinerary, tripRange));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this trip.");
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleCopy = async () => {
    if (!trip || copying) return;
    setCopying(true);
    try {
      const newTrip = await copySharedTrip(trip.id);
      router.replace({ pathname: "/trip-details", params: newTrip });
    } catch (err) {
      Alert.alert(
        "Could not copy trip",
        err instanceof Error ? err.message : "Please try again."
      );
    } finally {
      setCopying(false);
    }
  };

  const header = (
    <View style={styles.header}>
      <TouchableOpacity
        onPress={() => router.back()}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <Ionicons name="chevron-back" size={26} color={colors.primary} />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>{trip?.title ?? "Trip"}</Text>
      <View style={{ width: 26 }} />
    </View>
  );

  if (loading) {
    return (
      <View style={styles.container}>
        {header}
        <View style={[styles.container, styles.centered]}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {header}

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={load}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      <SectionList
        sections={daySections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listPadding}
        stickySectionHeadersEnabled
        ListHeaderComponent={
          trip ? (
            <View style={styles.tripHeader}>
              <Text style={styles.tripLocation}>{trip.location}</Text>
              <Text style={styles.tripDates}>{formatTripDates(trip.date)}</Text>
              {!trip.isOwner && (
                <TouchableOpacity
                  style={[styles.copyBtn, copying && { opacity: 0.6 }]}
                  onPress={handleCopy}
                  disabled={copying}
                >
                  {copying ? (
                    <ActivityIndicator size="small" color={colors.primaryContrast} />
                  ) : (
                    <>
                      <Ionicons
                        name="download-outline"
                        size={18}
                        color={colors.primaryContrast}
                      />
                      <Text style={styles.copyBtnText}>Copy to My Trips</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </View>
          ) : null
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.dayHeader}>
            <Text style={styles.dayNumber}>DAY {section.dayNumber}</Text>
            <Text style={styles.dayDot}>·</Text>
            <Text style={styles.dayDate}>{section.title}</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <View style={styles.eventCard}>
            <View style={styles.eventTimeBlock}>
              <Text style={styles.eventTime}>{item.time}</Text>
            </View>
            <View style={styles.eventDivider} />
            <View style={styles.eventInfo}>
              <Text style={styles.eventActivity}>{item.place}</Text>
              {item.address ? (
                <Text style={styles.eventPlace}>{item.address}</Text>
              ) : null}
            </View>
          </View>
        )}
        renderSectionFooter={({ section }) =>
          section.data.length === 0 ? (
            <Text style={styles.emptyDayText}>Nothing planned yet</Text>
          ) : null
        }
        ListEmptyComponent={<Text style={styles.emptyText}>No itinerary yet.</Text>}
      />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    centered: { justifyContent: "center", alignItems: "center" },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: Spacing.xl,
      paddingTop: 60,
      paddingBottom: Spacing.md,
    },
    headerTitle: {
      fontSize: FontSize.h3,
      fontFamily: FontFamily.semibold,
      color: colors.textPrimary,
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
    listPadding: { paddingHorizontal: Spacing.xl, paddingBottom: 40 },
    tripHeader: { paddingBottom: Spacing.lg },
    tripLocation: {
      fontSize: FontSize.body,
      fontFamily: FontFamily.semibold,
      color: colors.textPrimary,
    },
    tripDates: {
      fontSize: FontSize.caption,
      color: colors.textMuted,
      marginTop: 2,
      marginBottom: Spacing.lg,
    },
    copyBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.primary,
      paddingVertical: Spacing.md,
      borderRadius: Radius.pill,
    },
    copyBtnText: {
      color: colors.primaryContrast,
      fontFamily: FontFamily.semibold,
      fontSize: FontSize.body,
      marginLeft: 8,
    },
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
    dayDot: { fontSize: FontSize.caption, color: colors.textDisabled },
    dayDate: {
      fontSize: FontSize.caption,
      fontFamily: FontFamily.semibold,
      color: colors.textSecondary,
    },
    eventCard: {
      flexDirection: "row",
      backgroundColor: colors.surface,
      borderRadius: Radius.lg,
      marginBottom: Spacing.md,
      alignItems: "center",
      ...Elevation.sm,
      overflow: "hidden",
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
    eventInfo: { flex: 1, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.lg },
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
    emptyDayText: {
      fontSize: FontSize.caption,
      color: colors.textMuted,
      marginBottom: Spacing.md,
    },
    emptyText: {
      textAlign: "center",
      color: colors.textMuted,
      marginTop: Spacing.xxl,
      fontSize: FontSize.small,
    },
  });
