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
  SocialUser,
  addComment,
  deleteComment as deleteCommentApi,
  followUser,
  getUserPosts,
  getUserProfile,
  likePost,
  unfollowUser,
  unlikePost,
} from "../services/socialService";
import { apiFetch } from "../services/apiClient";
import { CommentsSheet } from "../components/social/CommentsSheet";
import { ImagePreviewModal } from "../components/social/ImagePreviewModal";
import { LikesModal } from "../components/social/LikesModal";
import { PostCard } from "../components/social/PostCard";
import {
  PeopleListKind,
  PeopleListModal,
} from "../components/social/PeopleListModal";

export default function UserProfileScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const userId = params.id as string;

  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const goToProfile = (id: string) =>
    router.push({ pathname: "/user-profile", params: { id } });

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [myId, setMyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [followBusy, setFollowBusy] = useState(false);

  const [likesModalUsers, setLikesModalUsers] = useState<SocialUser[] | null>(
    null
  );
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [commentsPostId, setCommentsPostId] = useState<string | null>(null);
  const [peopleList, setPeopleList] = useState<PeopleListKind | null>(null);

  const activePost = useMemo(
    () => posts.find((p) => p.id === commentsPostId) ?? null,
    [posts, commentsPostId]
  );

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

  // Needed for "did I like this" and "is this my comment" — the profile being
  // viewed is often someone else's, so profile.id is not the caller's id.
  const fetchMyId = useCallback(async () => {
    try {
      const response = await apiFetch("/users/me");
      if (response.ok) {
        const data = await response.json();
        setMyId(data.id ?? null);
      }
    } catch {
      // Non-fatal: those checks just won't match until this loads.
    }
  }, []);

  const refreshPosts = useCallback(async () => {
    if (!userId) return;
    setPosts(await getUserPosts(userId));
  }, [userId]);

  const toggleLike = async (post: Post) => {
    if (!myId) return;
    const alreadyLiked = post.likes.some((u) => u.id === myId);
    try {
      if (alreadyLiked) {
        await unlikePost(post.id);
      } else {
        await likePost(post.id);
      }
      await refreshPosts();
    } catch (err) {
      Alert.alert(
        "Could not update like",
        err instanceof Error ? err.message : "Please try again."
      );
    }
  };

  const submitComment = async (text: string, parentCommentId?: string) => {
    if (!commentsPostId) return;
    try {
      await addComment(commentsPostId, text, parentCommentId);
      await refreshPosts();
    } catch (err) {
      Alert.alert(
        "Could not post comment",
        err instanceof Error ? err.message : "Please try again."
      );
    }
  };

  const removeComment = (commentId: string) => {
    Alert.alert("Delete comment?", "", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteCommentApi(commentId);
            await refreshPosts();
          } catch (err) {
            Alert.alert(
              "Could not delete",
              err instanceof Error ? err.message : "Please try again."
            );
          }
        },
      },
    ]);
  };

  useFocusEffect(
    useCallback(() => {
      load();
      fetchMyId();
    }, [load, fetchMyId])
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
                <TouchableOpacity
                  style={styles.statItem}
                  onPress={() => setPeopleList("followers")}
                  accessibilityRole="button"
                  accessibilityLabel="See followers"
                >
                  <Text style={styles.statNumber}>{profile.followersCount}</Text>
                  <Text style={styles.statLabel}>Followers</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.statItem}
                  onPress={() => setPeopleList("following")}
                  accessibilityRole="button"
                  accessibilityLabel="See who they follow"
                >
                  <Text style={styles.statNumber}>{profile.followingCount}</Text>
                  <Text style={styles.statLabel}>Following</Text>
                </TouchableOpacity>
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
          <PostCard
            post={item}
            myId={myId}
            onToggleLike={toggleLike}
            onOpenComments={setCommentsPostId}
            onOpenLikes={setLikesModalUsers}
            onPressImage={setPreviewImage}
            onGoToProfile={goToProfile}
            onPressSharedTrip={(tripId) =>
              router.push({
                pathname: "/shared-trip-view",
                params: { id: tripId },
              })
            }
          />
        )}
        ListEmptyComponent={<Text style={styles.emptyText}>No posts yet.</Text>}
      />

      <ImagePreviewModal
        uri={previewImage}
        onClose={() => setPreviewImage(null)}
      />

      <LikesModal
        users={likesModalUsers}
        onClose={() => setLikesModalUsers(null)}
        onSelectUser={goToProfile}
      />

      <CommentsSheet
        post={activePost}
        myId={myId}
        onClose={() => setCommentsPostId(null)}
        onSubmit={submitComment}
        onDeleteComment={removeComment}
        onGoToProfile={goToProfile}
      />

      {peopleList && (
        <PeopleListModal
          kind={peopleList}
          userId={userId}
          onClose={() => setPeopleList(null)}
          onSelectUser={goToProfile}
          onFollowChanged={load}
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
    emptyText: {
      textAlign: "center",
      color: colors.textMuted,
      marginTop: Spacing.xxl,
      fontSize: FontSize.small,
    },
  });
