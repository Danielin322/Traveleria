/**
 * Trip invitations: someone shared a trip with this account, and it does not
 * appear anywhere until they say yes.
 *
 * A pushed screen rather than a tab. The list is empty almost all of the time,
 * and four tabs is already the practical limit — the bell on Home is the
 * permanent affordance, this is just where it leads.
 */

import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { AppButton } from "../components/AppButton";
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
  Invitation,
  displayName,
  listInvitations,
  respondToInvitation,
} from "../services/tripSharingService";
import { formatTripDates } from "../utils/tripFormat";

export default function InvitationsScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ids currently being accepted or declined. The row disables itself rather
  // than the whole screen, so answering one invitation does not freeze the
  // others.
  const [pending, setPending] = useState<Set<string>>(new Set());

  const fetchInvitations = useCallback(async () => {
    try {
      setError(null);
      setInvitations(await listInvitations());
    } catch (err: any) {
      setError(err?.message || "Could not load invitations.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchInvitations();
    }, [fetchInvitations]),
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchInvitations();
    setRefreshing(false);
  };

  const markPending = (id: string, busy: boolean) =>
    setPending((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });

  const respond = async (invitation: Invitation, action: "accept" | "decline") => {
    if (pending.has(invitation.id)) return;
    markPending(invitation.id, true);
    try {
      const result = await respondToInvitation(invitation.id, action);
      setInvitations((prev) => prev.filter((i) => i.id !== invitation.id));

      if (action === "accept" && result.trip) {
        const trip = result.trip;
        Alert.alert(
          "You're in",
          `${trip.title} is now in your trips.`,
          [
            { text: "Not now", style: "cancel" },
            {
              text: "Open trip",
              onPress: () =>
                router.push({
                  pathname: "/trip-details",
                  params: {
                    id: trip.id,
                    title: trip.title,
                    location: trip.location,
                    date: trip.date,
                  },
                }),
            },
          ],
        );
      }
    } catch (err: any) {
      Alert.alert(
        action === "accept" ? "Could not accept" : "Could not decline",
        err?.message || "Please try again.",
      );
    } finally {
      markPending(invitation.id, false);
    }
  };

  /**
   * Declining confirms; accepting does not. Accepting is undone by leaving the
   * trip, but a decline can only be reversed by asking to be invited again.
   */
  const confirmDecline = (invitation: Invitation) =>
    Alert.alert(
      "Decline invitation?",
      `${displayName(invitation.invited_by)} would have to invite you again.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Decline",
          style: "destructive",
          onPress: () => respond(invitation, "decline"),
        },
      ],
    );

  const renderInvitation = ({ item }: { item: Invitation }) => {
    const inviter = displayName(item.invited_by);
    const busy = pending.has(item.id);

    return (
      <View style={[styles.card, busy && styles.cardBusy]}>
        <View style={styles.cardTop}>
          {item.invited_by.avatar_url ? (
            <Image
              source={{ uri: item.invited_by.avatar_url }}
              style={styles.avatar}
            />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={styles.avatarInitial}>
                {inviter.charAt(0).toUpperCase()}
              </Text>
            </View>
          )}

          <View style={styles.cardText}>
            <Text style={styles.inviteLine}>
              <Text style={styles.inviterName}>{inviter}</Text> invited you to
              co-edit
            </Text>
            <Text style={styles.location}>{item.trip.location}</Text>
            <Text style={styles.tripTitle}>{item.trip.title}</Text>
            <Text style={styles.tripDate}>
              {formatTripDates(item.trip.date)}
            </Text>
          </View>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionButton, styles.declineButton]}
            onPress={() => confirmDecline(item)}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={`Decline the invitation to ${item.trip.title}`}
          >
            <Ionicons name="close" size={22} color={colors.danger} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, styles.acceptButton]}
            onPress={() => respond(item, "accept")}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={`Accept the invitation to ${item.trip.title}`}
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.primaryContrast} />
            ) : (
              <Ionicons
                name="checkmark"
                size={22}
                color={colors.primaryContrast}
              />
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.errorText}>{error}</Text>
        <AppButton label="Retry" onPress={fetchInvitations} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={invitations}
        keyExtractor={(item) => item.id}
        renderItem={renderInvitation}
        contentContainerStyle={styles.list}
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
              name="mail-open-outline"
              size={52}
              color={colors.textDisabled}
            />
            <Text style={styles.emptyText}>No invitations right now</Text>
            <Text style={styles.emptySubText}>
              When someone shares a trip with you, it will appear here.
            </Text>
          </View>
        }
      />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    centered: { alignItems: "center", justifyContent: "center", padding: Spacing.xl },
    list: { padding: Spacing.xl },

    card: {
      backgroundColor: colors.surface,
      borderRadius: Radius.lg,
      padding: Spacing.lg,
      marginBottom: Spacing.md,
      // The same violet that marks a shared trip on the home list, so the
      // invitation and the card it turns into read as the same thing.
      borderLeftWidth: 4,
      borderLeftColor: colors.shared,
      ...Elevation.sm,
    },
    cardBusy: { opacity: 0.6 },
    cardTop: { flexDirection: "row", alignItems: "flex-start" },
    cardText: { flex: 1, marginLeft: Spacing.md },

    avatar: { width: 44, height: 44, borderRadius: Radius.pill },
    avatarFallback: {
      backgroundColor: colors.sharedSoft,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarInitial: {
      fontSize: FontSize.h3,
      fontFamily: FontFamily.bold,
      color: colors.shared,
    },

    inviteLine: {
      fontSize: FontSize.small,
      fontFamily: FontFamily.regular,
      color: colors.textSecondary,
    },
    inviterName: { fontFamily: FontFamily.semibold, color: colors.textPrimary },
    location: {
      fontSize: FontSize.tiny,
      fontFamily: FontFamily.bold,
      color: colors.shared,
      letterSpacing: 0.4,
      marginTop: Spacing.sm,
    },
    tripTitle: {
      fontSize: FontSize.h3,
      fontFamily: FontFamily.semibold,
      color: colors.textPrimary,
    },
    tripDate: {
      fontSize: FontSize.small,
      fontFamily: FontFamily.regular,
      color: colors.textSecondary,
      marginTop: Spacing.xs,
    },

    actions: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: Spacing.md,
      marginTop: Spacing.lg,
    },
    actionButton: {
      width: 48,
      height: 40,
      borderRadius: Radius.md,
      alignItems: "center",
      justifyContent: "center",
    },
    declineButton: {
      backgroundColor: colors.dangerSoft,
      borderWidth: 1,
      borderColor: colors.danger,
    },
    acceptButton: { backgroundColor: colors.primary },

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
      textAlign: "center",
      paddingHorizontal: Spacing.xl,
    },
    errorText: {
      fontSize: FontSize.body,
      fontFamily: FontFamily.regular,
      color: colors.danger,
      textAlign: "center",
      marginBottom: Spacing.lg,
    },
  });
