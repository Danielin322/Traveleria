import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { Spacing, ThemeColors } from "../../constants/theme";
import { useThemeColors } from "../../contexts/ThemeContext";
import {
  FollowConnection,
  followUser,
  getFollowers,
  getFollowing,
  unfollowUser,
} from "../../services/socialService";
import { Avatar } from "./Avatar";

export type PeopleListKind = "followers" | "following";

export type PeopleListModalProps = {
  /** Which list to show. */
  kind: PeopleListKind;
  /** Whose followers / following to list. */
  userId: string;
  onClose: () => void;
  onSelectUser: (userId: string) => void;
  /**
   * Called after a follow or unfollow from inside the list, so the screen can
   * refresh its own follower counts.
   */
  onFollowChanged?: () => void;
};

/**
 * The "Followers" / "Following" list for one person.
 *
 * Fetches on open rather than taking rows as a prop: the counts on a profile
 * come from the profile payload, and loading the people behind them only when
 * someone actually taps is cheaper than fetching two lists nobody may open.
 *
 * Render it only while a list is open — `{kind && <PeopleListModal ... />}`.
 * Mounting on open is what lets `loading` start out true, so the fetch effect
 * never has to set state synchronously just to show a spinner.
 */
export function PeopleListModal({
  kind,
  userId,
  onClose,
  onSelectUser,
  onFollowChanged,
}: PeopleListModalProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [people, setPeople] = useState<FollowConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchList = useCallback(
    () => (kind === "followers" ? getFollowers(userId) : getFollowing(userId)),
    [kind, userId]
  );

  useEffect(() => {
    // Every state update here happens after an await, never synchronously
    // during the effect — `loading` already starts true because the component
    // is mounted only while the list is open.
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchList();
        if (!cancelled) setPeople(rows);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Could not load this list."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchList]);

  /** Retry, from the error state. An event handler, so setState is fine here. */
  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      setPeople(await fetchList());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this list.");
    } finally {
      setLoading(false);
    }
  };

  const toggleFollow = async (person: FollowConnection) => {
    setBusyId(person.id);
    try {
      if (person.isFollowing) {
        await unfollowUser(person.id);
      } else {
        await followUser(person.id);
      }
      // Flip just this row rather than refetching: the list's membership does
      // not change when you follow someone in it, only the button does.
      setPeople((prev) =>
        prev.map((p) =>
          p.id === person.id ? { ...p, isFollowing: !p.isFollowing } : p
        )
      );
      onFollowChanged?.();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not update follow status."
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>
            {kind === "followers" ? "Followers" : "Following"}
          </Text>

          {loading ? (
            <View style={styles.stateBox}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : error ? (
            <View style={styles.stateBox}>
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity onPress={reload}>
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : people.length === 0 ? (
            <View style={styles.stateBox}>
              <Text style={styles.emptyText}>
                {kind === "followers"
                  ? "No followers yet."
                  : "Not following anyone yet."}
              </Text>
            </View>
          ) : (
            <ScrollView style={styles.list}>
              {people.map((person) => (
                <View key={person.id} style={styles.personRow}>
                  <TouchableOpacity
                    style={styles.personTappable}
                    onPress={() => {
                      onClose();
                      onSelectUser(person.id);
                    }}
                  >
                    <Avatar
                      uri={person.avatar}
                      style={styles.avatar}
                      iconSize={18}
                    />
                    <Text style={styles.personName} numberOfLines={1}>
                      {person.name}
                    </Text>
                  </TouchableOpacity>

                  {!person.isMe && (
                    <TouchableOpacity
                      style={[
                        styles.followBtn,
                        person.isFollowing && styles.followingBtn,
                      ]}
                      onPress={() => toggleFollow(person)}
                      disabled={busyId === person.id}
                    >
                      {busyId === person.id ? (
                        <ActivityIndicator
                          size="small"
                          color={
                            person.isFollowing
                              ? colors.textPrimary
                              : colors.primaryContrast
                          }
                        />
                      ) : (
                        <Text
                          style={[
                            styles.followBtnText,
                            person.isFollowing && styles.followingBtnText,
                          ]}
                        >
                          {person.isFollowing ? "Following" : "Follow"}
                        </Text>
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </ScrollView>
          )}

          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    modalOverlay: {
      flex: 1,
      justifyContent: "center",
      backgroundColor: "rgba(0,0,0,0.5)",
      padding: 20,
    },
    modalContent: {
      backgroundColor: colors.surface,
      borderRadius: 20,
      padding: 22,
      minHeight: 380,
    },
    modalTitle: {
      fontSize: 20,
      fontWeight: "bold",
      marginBottom: 14,
      textAlign: "center",
      color: colors.textPrimary,
    },
    list: { minHeight: 240, maxHeight: 380 },
    stateBox: {
      minHeight: 240,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: Spacing.lg,
    },
    emptyText: { color: colors.textMuted, fontSize: 14, textAlign: "center" },
    errorText: {
      color: colors.danger,
      fontSize: 14,
      textAlign: "center",
      marginBottom: 8,
    },
    retryText: { color: colors.primary, fontSize: 14, fontWeight: "600" },
    personRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 8,
    },
    personTappable: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      marginRight: 10,
    },
    avatar: { width: 36, height: 36, borderRadius: 18, marginRight: 10 },
    personName: { flex: 1, fontSize: 15, color: colors.textPrimary },
    followBtn: {
      backgroundColor: colors.primary,
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: 16,
      minWidth: 92,
      alignItems: "center",
      justifyContent: "center",
    },
    followingBtn: {
      backgroundColor: colors.surfaceSunken,
      borderWidth: 1,
      borderColor: colors.border,
    },
    followBtnText: {
      color: colors.primaryContrast,
      fontWeight: "bold",
      fontSize: 13,
    },
    followingBtnText: { color: colors.textPrimary },
    closeBtn: {
      backgroundColor: colors.primary,
      borderRadius: 10,
      marginTop: 16,
      marginBottom: 8,
      paddingVertical: 18,
      alignItems: "center",
      justifyContent: "center",
    },
    closeBtnText: { color: colors.surface, fontWeight: "bold", fontSize: 18 },
  });
