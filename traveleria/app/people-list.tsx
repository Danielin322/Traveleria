import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { FontFamily, FontSize, Radius, Spacing, ThemeColors } from "../constants/theme";
import { useThemeColors } from "../contexts/ThemeContext";
import {
  PersonListItem,
  followUser,
  getFollowers,
  getFollowing,
  unfollowUser,
} from "../services/socialService";
import { Avatar } from "../components/social/Avatar";

type ListType = "followers" | "following";

export default function PeopleListScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const userId = params.userId as string;
  const type = (params.type as ListType) || "followers";

  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [people, setPeople] = useState<PersonListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      setError(null);
      const list = type === "followers" ? await getFollowers(userId) : await getFollowing(userId);
      setPeople(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this list.");
    } finally {
      setLoading(false);
    }
  }, [userId, type]);

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
        <Text style={styles.headerTitle}>
          {type === "followers" ? "Followers" : "Following"}
        </Text>
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

      {loading ? (
        <View style={[styles.container, styles.centered]}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={people}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ paddingHorizontal: Spacing.xl, paddingBottom: 30 }}
          ListEmptyComponent={
            <Text style={styles.emptyText}>
              {type === "followers" ? "No followers yet." : "Not following anyone yet."}
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
                <Avatar uri={item.avatar} size={48} iconSize={20} style={styles.avatarMargin} />
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
    row: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: Spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    avatarMargin: { marginRight: Spacing.md },
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
