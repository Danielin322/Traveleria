import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
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
  Post,
  PublicProfile,
  followUser,
  getUserPosts,
  getUserProfile,
  unfollowUser,
} from "../services/socialService";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString();
}

export default function UserProfileScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const userId = params.id as string;

  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [followBusy, setFollowBusy] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      setError(null);
      const [profileData, postsData] = await Promise.all([
        getUserProfile(userId),
        getUserPosts(userId),
      ]);
      setProfile(profileData);
      setPosts(postsData);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load this profile."
      );
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const toggleFollow = async () => {
    if (!profile || followBusy) return;
    setFollowBusy(true);
    try {
      if (profile.isFollowing) {
        await unfollowUser(profile.id);
      } else {
        await followUser(profile.id);
      }
      await load();
    } catch (err) {
      Alert.alert(
        "Could not update follow status",
        err instanceof Error ? err.message : "Please try again."
      );
    } finally {
      setFollowBusy(false);
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
      <Text style={styles.headerTitle}>{profile?.name ?? "Profile"}</Text>
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

      <FlatList
        data={posts}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ paddingBottom: 30 }}
        ListHeaderComponent={
          profile ? (
            <View style={styles.profileHeader}>
              {profile.avatar ? (
                <Image source={{ uri: profile.avatar }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarPlaceholder]}>
                  <Ionicons name="person" size={40} color={colors.textMuted} />
                </View>
              )}
              <Text style={styles.name}>{profile.name}</Text>

              <View style={styles.statsRow}>
                <View style={styles.statItem}>
                  <Text style={styles.statNumber}>{profile.postsCount}</Text>
                  <Text style={styles.statLabel}>Posts</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statNumber}>{profile.followersCount}</Text>
                  <Text style={styles.statLabel}>Followers</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statNumber}>{profile.followingCount}</Text>
                  <Text style={styles.statLabel}>Following</Text>
                </View>
              </View>

              {!profile.isMe && (
                <TouchableOpacity
                  style={[
                    styles.followBtn,
                    profile.isFollowing && styles.followingBtn,
                  ]}
                  onPress={toggleFollow}
                  disabled={followBusy}
                >
                  {followBusy ? (
                    <ActivityIndicator
                      size="small"
                      color={
                        profile.isFollowing ? colors.textPrimary : colors.surface
                      }
                    />
                  ) : (
                    <Text
                      style={[
                        styles.followBtnText,
                        profile.isFollowing && styles.followingBtnText,
                      ]}
                    >
                      {profile.isFollowing ? "Following" : "Follow"}
                    </Text>
                  )}
                </TouchableOpacity>
              )}

              <Text style={styles.postsHeading}>Posts</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <View style={styles.postCard}>
            <Text style={styles.postTime}>{timeAgo(item.createdAt)}</Text>
            {item.text ? <Text style={styles.postText}>{item.text}</Text> : null}
            {item.imageUri ? (
              <Image source={{ uri: item.imageUri }} style={styles.postImage} />
            ) : null}
            <View style={styles.postMetaRow}>
              <Ionicons name="heart-outline" size={16} color={colors.textMuted} />
              <Text style={styles.postMetaText}>{item.likes.length}</Text>
              <Ionicons
                name="chatbubble-outline"
                size={16}
                color={colors.textMuted}
                style={{ marginLeft: 14 }}
              />
              <Text style={styles.postMetaText}>
                {item.comments.length +
                  item.comments.reduce((sum, c) => sum + c.replies.length, 0)}
              </Text>
            </View>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.emptyText}>No posts yet.</Text>}
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
    profileHeader: {
      alignItems: "center",
      paddingHorizontal: Spacing.xl,
      paddingBottom: Spacing.lg,
    },
    avatar: { width: 88, height: 88, borderRadius: 44, marginBottom: Spacing.md },
    avatarPlaceholder: {
      backgroundColor: colors.surfaceSunken,
      alignItems: "center",
      justifyContent: "center",
    },
    name: {
      fontSize: FontSize.h2,
      fontFamily: FontFamily.bold,
      color: colors.textPrimary,
      marginBottom: Spacing.lg,
    },
    statsRow: { flexDirection: "row", marginBottom: Spacing.lg },
    statItem: { alignItems: "center", marginHorizontal: Spacing.xl },
    statNumber: {
      fontSize: FontSize.h3,
      fontFamily: FontFamily.bold,
      color: colors.textPrimary,
    },
    statLabel: { fontSize: FontSize.caption, color: colors.textMuted, marginTop: 2 },
    followBtn: {
      backgroundColor: colors.primary,
      paddingHorizontal: Spacing.xxl,
      paddingVertical: Spacing.sm,
      borderRadius: Radius.pill,
      minWidth: 140,
      alignItems: "center",
      marginBottom: Spacing.xl,
    },
    followingBtn: {
      backgroundColor: colors.surfaceSunken,
      borderWidth: 1,
      borderColor: colors.border,
    },
    followBtnText: {
      color: colors.primaryContrast,
      fontFamily: FontFamily.semibold,
      fontSize: FontSize.body,
    },
    followingBtnText: { color: colors.textPrimary },
    postsHeading: {
      alignSelf: "flex-start",
      fontSize: FontSize.small,
      fontFamily: FontFamily.semibold,
      color: colors.textMuted,
      marginTop: Spacing.md,
      marginBottom: Spacing.sm,
    },
    postCard: {
      backgroundColor: colors.surface,
      borderRadius: Radius.lg,
      padding: Spacing.lg,
      marginHorizontal: Spacing.xl,
      marginBottom: Spacing.md,
      ...Elevation.sm,
    },
    postTime: {
      fontSize: FontSize.tiny,
      color: colors.textMuted,
      marginBottom: Spacing.xs,
    },
    postText: {
      fontSize: FontSize.small,
      color: colors.textPrimary,
      marginBottom: Spacing.sm,
    },
    postImage: {
      width: "100%",
      height: 200,
      borderRadius: Radius.md,
      backgroundColor: colors.border,
      marginBottom: Spacing.sm,
    },
    postMetaRow: { flexDirection: "row", alignItems: "center" },
    postMetaText: {
      fontSize: FontSize.caption,
      color: colors.textMuted,
      marginLeft: 4,
    },
    emptyText: {
      textAlign: "center",
      color: colors.textMuted,
      marginTop: Spacing.xxl,
      fontSize: FontSize.small,
    },
  });
