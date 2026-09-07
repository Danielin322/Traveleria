/**
 * Who can edit a trip, and the one place to change it.
 *
 * The owner adds people by email, removes them, and can hand the trip over.
 * Everyone else sees the same list read-only, with one action: leave.
 *
 * "Which row is you" comes from the server as `is_you` rather than being
 * worked out here — it already knows who is asking, and the alternative is
 * plumbing the signed-in identity through the app to compare two strings.
 */

import { Ionicons } from "@expo/vector-icons";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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
  TripMember,
  TripMembers,
  addMember,
  displayName,
  listMembers,
  removeMember,
  transferOwnership,
} from "../services/tripSharingService";
import { validateEmail } from "../utils/validation";

type Props = {
  visible: boolean;
  onClose: () => void;
  tripId: string;
  tripTitle: string;
  /** Called after anything changes, so the caller can refresh its own copy. */
  onChanged?: () => void;
  /** Called once the signed-in user is no longer on this trip. */
  onLeft?: () => void;
};

export function TripMembersSheet({
  visible,
  onClose,
  tripId,
  tripTitle,
  onChanged,
  onLeft,
}: Props) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [members, setMembers] = useState<TripMembers | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchMembers = useCallback(async () => {
    try {
      setLoadError(null);
      setMembers(await listMembers(tripId));
    } catch (err: any) {
      setLoadError(err?.message || "Could not load trip members.");
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  /**
   * Driven by the Modal's own onShow rather than an effect on `visible`.
   * Resetting state inside an effect is a cascading render, and the callback
   * says what is actually meant: load this the moment the sheet appears.
   */
  const handleShow = useCallback(() => {
    setLoading(true);
    setEmail("");
    setEmailError(null);
    fetchMembers();
  }, [fetchMembers]);

  const isOwner = members?.your_role === "owner";

  const handleAdd = async () => {
    if (isAdding) return;

    const problem = validateEmail(email);
    if (problem) {
      setEmailError(problem);
      return;
    }

    setIsAdding(true);
    setEmailError(null);
    try {
      const result = await addMember(tripId, email.trim().toLowerCase());
      setEmail("");
      await fetchMembers();
      onChanged?.();
      // The wording differs for someone who already has an account and someone
      // who does not, but both are a success — nothing here reveals which.
      Alert.alert("Invitation sent", result.message);
    } catch (err: any) {
      // Inline, in the FormField idiom the other forms use, rather than an
      // Alert: this is almost always a typo in the field right above it.
      setEmailError(err?.message || "Could not send the invitation.");
    } finally {
      setIsAdding(false);
    }
  };

  const doRemove = async (member: TripMember, leaving: boolean) => {
    setBusyId(member.id);
    try {
      await removeMember(tripId, member.id);
      if (leaving) {
        onClose();
        onLeft?.();
        return;
      }
      await fetchMembers();
      onChanged?.();
    } catch (err: any) {
      Alert.alert("Could not update", err?.message || "Please try again.");
    } finally {
      setBusyId(null);
    }
  };

  const confirmRemove = (member: TripMember) => {
    const name = displayName(member);
    Alert.alert(
      "Remove from trip?",
      `${name} will lose access to ${tripTitle}. Their own chat history is kept, and comes back if you invite them again.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => doRemove(member, false),
        },
      ],
    );
  };

  const confirmLeave = (member: TripMember) => {
    Alert.alert(
      "Leave this trip?",
      `${tripTitle} will disappear from your trips. You will need a new invitation to get back in.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Leave",
          style: "destructive",
          onPress: () => doRemove(member, true),
        },
      ],
    );
  };

  const confirmTransfer = (member: TripMember) => {
    const name = displayName(member);
    Alert.alert(
      `Make ${name} the owner?`,
      "You will become an editor: you can still change the trip and its events, but you will no longer be able to delete it or manage who is on it.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Make owner",
          style: "destructive",
          onPress: async () => {
            setBusyId(member.id);
            try {
              const result = await transferOwnership(tripId, member.id);
              await fetchMembers();
              onChanged?.();
              Alert.alert("Owner changed", result.message);
            } catch (err: any) {
              Alert.alert(
                "Could not transfer",
                err?.message || "Please try again.",
              );
            } finally {
              setBusyId(null);
            }
          },
        },
      ],
    );
  };

  /** Owner gets Make owner + Remove; an active member is the only valid target. */
  const openMemberActions = (member: TripMember) => {
    const name = displayName(member);
    const buttons: any[] = [];
    if (member.status === "active") {
      buttons.push({ text: "Make owner", onPress: () => confirmTransfer(member) });
    }
    buttons.push({
      text: "Remove from trip",
      style: "destructive",
      onPress: () => confirmRemove(member),
    });
    buttons.push({ text: "Cancel", style: "cancel" });
    Alert.alert(name, member.email, buttons);
  };

  const statusLabel = (status: TripMember["status"]) =>
    status === "active" ? "Editor" : status === "pending" ? "Invited" : "Declined";

  const renderAvatar = (
    avatarUrl: string | null,
    name: string,
    dimmed = false,
  ) =>
    avatarUrl ? (
      <Image source={{ uri: avatarUrl }} style={styles.avatar} />
    ) : (
      <View style={[styles.avatar, styles.avatarFallback, dimmed && styles.avatarDim]}>
        <Text style={styles.avatarInitial}>{name.charAt(0).toUpperCase()}</Text>
      </View>
    );

  const renderRow = (member: TripMember) => {
    const name = displayName(member);
    const busy = busyId === member.id;
    // The owner manages everyone. Everyone else has exactly one action, on
    // their own row, and it is "leave".
    const canManage = isOwner && !member.is_you;
    const canLeave = member.is_you;

    return (
      <View key={member.id} style={styles.row}>
        {renderAvatar(member.avatar_url, name, member.status !== "active")}
        <View style={styles.rowText}>
          <Text style={styles.rowName} numberOfLines={1}>
            {name}
            {member.is_you ? " · You" : ""}
          </Text>
          <Text style={styles.rowMeta} numberOfLines={1}>
            {statusLabel(member.status)}
            {member.full_name ? ` · ${member.email}` : ""}
          </Text>
        </View>

        {busy ? (
          <ActivityIndicator size="small" color={colors.textMuted} />
        ) : canManage ? (
          <TouchableOpacity
            onPress={() => openMemberActions(member)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={`Manage ${name}`}
          >
            <Ionicons
              name="ellipsis-horizontal"
              size={20}
              color={colors.textMuted}
            />
          </TouchableOpacity>
        ) : canLeave ? (
          <TouchableOpacity
            onPress={() => confirmLeave(member)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={`Leave ${tripTitle}`}
          >
            <Text style={styles.leaveAction}>Leave</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onShow={handleShow}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.overlay}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.sheet}>
            <View style={styles.header}>
              <Text style={styles.title}>Trip members</Text>
              <TouchableOpacity
                onPress={onClose}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Close trip members"
              >
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {loading ? (
              <ActivityIndicator
                size="large"
                color={colors.primary}
                style={styles.loader}
              />
            ) : loadError ? (
              <Text style={styles.errorText}>{loadError}</Text>
            ) : members ? (
              <>
                <View style={styles.row}>
                  {renderAvatar(
                    members.owner.avatar_url,
                    displayName(members.owner),
                  )}
                  <View style={styles.rowText}>
                    <Text style={styles.rowName} numberOfLines={1}>
                      {displayName(members.owner)}
                      {members.owner.is_you ? " · You" : ""}
                    </Text>
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      Owner
                      {members.owner.full_name ? ` · ${members.owner.email}` : ""}
                    </Text>
                  </View>
                </View>

                {members.collaborators.map(renderRow)}

                {members.collaborators.length === 0 && (
                  <Text style={styles.emptyText}>
                    Nobody else is on this trip yet.
                  </Text>
                )}

                {isOwner && (
                  <View style={styles.addSection}>
                    <Text style={styles.addLabel}>Add by email</Text>
                    <View style={styles.addRow}>
                      <TextInput
                        style={[
                          styles.input,
                          !!emailError && styles.inputError,
                        ]}
                        placeholder="name@example.com"
                        placeholderTextColor={colors.textDisabled}
                        value={email}
                        onChangeText={(text) => {
                          setEmail(text);
                          if (emailError) setEmailError(null);
                        }}
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="email-address"
                        onSubmitEditing={handleAdd}
                        returnKeyType="done"
                        editable={!isAdding}
                      />
                      <TouchableOpacity
                        style={[styles.addButton, isAdding && styles.addButtonBusy]}
                        onPress={handleAdd}
                        disabled={isAdding}
                        accessibilityRole="button"
                        accessibilityLabel="Send invitation"
                      >
                        {isAdding ? (
                          <ActivityIndicator
                            size="small"
                            color={colors.sharedContrast}
                          />
                        ) : (
                          <Ionicons
                            name="add"
                            size={24}
                            color={colors.sharedContrast}
                          />
                        )}
                      </TouchableOpacity>
                    </View>
                    {emailError ? (
                      <Text style={styles.fieldError}>{emailError}</Text>
                    ) : (
                      <Text style={styles.addHint}>
                        They will get an invitation to accept before they can
                        edit.
                      </Text>
                    )}
                  </View>
                )}
              </>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    overlay: { flex: 1, backgroundColor: colors.overlay },
    scrollContent: {
      flexGrow: 1,
      justifyContent: "center",
      padding: Spacing.xl,
    },
    sheet: {
      backgroundColor: colors.surface,
      borderRadius: Radius.xl,
      padding: Spacing.xxl,
      ...Elevation.lg,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: Spacing.xl,
    },
    title: {
      fontSize: FontSize.h2,
      fontFamily: FontFamily.bold,
      color: colors.textPrimary,
    },
    loader: { marginVertical: Spacing.xl },

    row: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: Spacing.md,
    },
    rowText: { flex: 1, marginLeft: Spacing.md },
    rowName: {
      fontSize: FontSize.body,
      fontFamily: FontFamily.semibold,
      color: colors.textPrimary,
    },
    rowMeta: {
      fontSize: FontSize.caption,
      fontFamily: FontFamily.regular,
      color: colors.textSecondary,
      marginTop: 2,
    },
    leaveAction: {
      fontSize: FontSize.small,
      fontFamily: FontFamily.semibold,
      color: colors.danger,
    },

    avatar: { width: 40, height: 40, borderRadius: Radius.pill },
    avatarFallback: {
      backgroundColor: colors.sharedSoft,
      alignItems: "center",
      justifyContent: "center",
    },
    // An invitation nobody has answered yet should not look like a member.
    avatarDim: { opacity: 0.6 },
    avatarInitial: {
      fontSize: FontSize.body,
      fontFamily: FontFamily.bold,
      color: colors.shared,
    },

    emptyText: {
      fontSize: FontSize.small,
      fontFamily: FontFamily.regular,
      color: colors.textMuted,
      paddingVertical: Spacing.md,
    },

    addSection: {
      marginTop: Spacing.lg,
      paddingTop: Spacing.lg,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    addLabel: {
      fontSize: FontSize.small,
      fontFamily: FontFamily.semibold,
      color: colors.textPrimary,
      marginBottom: Spacing.sm,
    },
    addRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
    input: {
      flex: 1,
      backgroundColor: colors.surfaceSunken,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.md,
      fontSize: FontSize.body,
      fontFamily: FontFamily.regular,
      color: colors.textPrimary,
    },
    inputError: { borderColor: colors.danger },
    addButton: {
      width: 48,
      height: 48,
      borderRadius: Radius.md,
      backgroundColor: colors.shared,
      alignItems: "center",
      justifyContent: "center",
    },
    addButtonBusy: { opacity: 0.7 },
    addHint: {
      fontSize: FontSize.caption,
      fontFamily: FontFamily.regular,
      color: colors.textMuted,
      marginTop: Spacing.sm,
    },
    fieldError: {
      fontSize: FontSize.caption,
      fontFamily: FontFamily.regular,
      color: colors.danger,
      marginTop: Spacing.sm,
    },
    errorText: {
      fontSize: FontSize.small,
      fontFamily: FontFamily.regular,
      color: colors.danger,
      paddingVertical: Spacing.md,
    },
  });
