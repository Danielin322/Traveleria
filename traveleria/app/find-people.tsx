import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import {
  FontFamily,
  FontSize,
  Radius,
  Spacing,
  ThemeColors,
} from "../constants/theme";
import { useThemeColors } from "../contexts/ThemeContext";
import {
  PersonListItem,
  followUser,
  listPeople,
  unfollowUser,
} from "../services/socialService";

export default function FindPeopleScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [people, setPeople] = useState<PersonListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // Tracks in-flight follow/unfollow taps per person, so only that row
  // shows a spinner and a double-tap can't fire the request twice.
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const filteredPeople = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return people;
    return people.filter((p) => p.name.toLowerCase().includes(q));
  }, [people, query]);

  const load = useCallback(async () => {
    try {
      setError(null);
      setPeople(await listPeople());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load people.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const toggleFollow = async (person: PersonListItem) => {
    if (busyIds.has(person.id)) return;
    setBusyIds((prev) => new Set(prev).add(person.id));
    try {
      if (person.isFollowing) {
        await unfollowUser(person.id);
      } else {
        await followUser(person.id);
      }
      await load();
    } catch (err) {
      Alert.alert(
        "Could not update follow status",
        err instanceof Error ? err.message : "Please try again."
      );
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(person.id);
        return next;
      });
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={26} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Find People</Text>
        <View style={{ width: 26 }} />
      </View>

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={load}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.searchRow}>
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name..."
          placeholderTextColor={colors.textDisabled}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery("")}>
            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <View style={[styles.container, styles.centered]}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={filteredPeople}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ paddingHorizontal: Spacing.xl, paddingBottom: 30 }}
          ListEmptyComponent={
            <Text style={styles.emptyText}>
              {query
                ? `No one named "${query}" found.`
                : "No one else has joined yet."}
            </Text>
          }
          renderItem={({ item }) => {
            const busy = busyIds.has(item.id);
            return (
              <TouchableOpacity
                style={styles.row}
                onPress={() =>
                  router.push({ pathname: "/user-profile", params: { id: item.id } })
                }
              >
                {item.avatar ? (
                  <Image source={{ uri: item.avatar }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarPlaceholder]}>
                    <Ionicons name="person" size={20} color={colors.textMuted} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{item.name}</Text>
                  <Text style={styles.followerCount}>
                    {item.followersCount}{" "}
                    {item.followersCount === 1 ? "follower" : "followers"}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.followBtn, item.isFollowing && styles.followingBtn]}
                  onPress={() => toggleFollow(item)}
                  disabled={busy}
                >
                  {busy ? (
                    <ActivityIndicator
                      size="small"
                      color={item.isFollowing ? colors.textPrimary : colors.surface}
                    />
                  ) : (
                    <Text
                      style={[
                        styles.followBtnText,
                        item.isFollowing && styles.followingBtnText,
                      ]}
                    >
                      {item.isFollowing ? "Following" : "Follow"}
                    </Text>
                  )}
                </TouchableOpacity>
              </TouchableOpacity>
            );
          }}
        />
      )}
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
    searchRow: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.surfaceSunken,
      marginHorizontal: Spacing.xl,
      marginBottom: Spacing.md,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      borderRadius: Radius.pill,
    },
    searchInput: {
      flex: 1,
      marginLeft: Spacing.sm,
      fontSize: FontSize.body,
      color: colors.textPrimary,
      paddingVertical: 2,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: Spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    avatar: { width: 48, height: 48, borderRadius: 24, marginRight: Spacing.md },
    avatarPlaceholder: {
      backgroundColor: colors.surfaceSunken,
      alignItems: "center",
      justifyContent: "center",
    },
    name: {
      fontSize: FontSize.body,
      fontFamily: FontFamily.semibold,
      color: colors.textPrimary,
    },
    followerCount: {
      fontSize: FontSize.caption,
      color: colors.textMuted,
      marginTop: 2,
    },
    followBtn: {
      backgroundColor: colors.primary,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.sm,
      borderRadius: Radius.pill,
      minWidth: 96,
      alignItems: "center",
    },
    followingBtn: {
      backgroundColor: colors.surfaceSunken,
      borderWidth: 1,
      borderColor: colors.border,
    },
    followBtnText: {
      color: colors.primaryContrast,
      fontFamily: FontFamily.semibold,
      fontSize: FontSize.caption,
    },
    followingBtnText: { color: colors.textPrimary },
    emptyText: {
      textAlign: "center",
      color: colors.textMuted,
      marginTop: Spacing.xxl,
      fontSize: FontSize.small,
    },
  });
