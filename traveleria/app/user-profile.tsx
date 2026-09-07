import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import {
  dietaryLabels,
  genderLabel,
  interestLabels,
} from "../constants/profileOptions";
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
import { Avatar } from "../components/social/Avatar";
import { CommentsSheet } from "../components/social/CommentsSheet";
import { LikesModal } from "../components/social/LikesModal";
import { PostCard } from "../components/social/PostCard";

export default function UserProfileScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const userId = params.id as string;

  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [myId, setMyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [followBusy, setFollowBusy] = useState(false);

  const [likesModalUsers, setLikesModalUsers] = useState<SocialUser[] | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [commentsPostId, setCommentsPostId] = useState<string | null>(null);

  const activePost = useMemo(
    () => posts.find((p) => p.id === commentsPostId) ?? null,
    [posts, commentsPostId]
  );

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      setError(null);
      const [profileData, postsData, meResponse] = await Promise.all([
        getUserProfile(userId),
        getUserPosts(userId),
        apiFetch("/users/me"),
      ]);
      setProfile(profileData);
      setPosts(postsData);
      if (meResponse.ok) {
        const me = await meResponse.json();
        setMyId(me.id ?? null);
      }
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

  const refreshPosts = useCallback(async () => {
    setPosts(await getUserPosts(userId));
  }, [userId]);

  const goToProfile = (id: string) => {
    if (id === userId) return;
    router.push({ pathname: "/user-profile", params: { id } });
  };

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

  const removeComment = async (commentId: string) => {
    try {
      await deleteCommentApi(commentId);
      await refreshPosts();
    } catch (err) {
      Alert.alert(
        "Could not delete",
        err instanceof Error ? err.message : "Please try again."
      );
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

  const aboutMe = profile?.aboutMe;
  const hasAboutMe =
    !!aboutMe &&
    (aboutMe.country ||
      aboutMe.language ||
      aboutMe.age ||
      aboutMe.gender ||
      aboutMe.dietary.length > 0 ||
      aboutMe.interests.length > 0);

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
        contentContainerStyle={{ paddingHorizontal: Spacing.xl, paddingBottom: 30 }}
        ListHeaderComponent={
          profile ? (
            <View style={styles.profileHeader}>
              <Avatar uri={profile.avatar} size={88} iconSize={40} style={styles.avatarMargin} />
              <Text style={styles.name}>{profile.name}</Text>

              <View style={styles.statsRow}>
                <View style={styles.statItem}>
                  <Text style={styles.statNumber}>{profile.postsCount}</Text>
                  <Text style={styles.statLabel}>Posts</Text>
                </View>
                <TouchableOpacity
                  style={styles.statItem}
                  onPress={() =>
                    router.push({
                      pathname: "/people-list",
                      params: { userId: profile.id, type: "followers" },
                    })
                  }
                >
                  <Text style={styles.statNumber}>{profile.followersCount}</Text>
                  <Text style={styles.statLabel}>Followers</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.statItem}
                  onPress={() =>
                    router.push({
                      pathname: "/people-list",
                      params: { userId: profile.id, type: "following" },
                    })
                  }
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

              {hasAboutMe && (
                <View style={styles.aboutSection}>
                  <Text style={styles.aboutHeading}>About Me</Text>
                  {aboutMe!.country && (
                    <View style={styles.aboutRow}>
                      <Ionicons name="flag-outline" size={18} color={colors.primary} />
                      <Text style={styles.aboutText}>{aboutMe!.country}</Text>
                    </View>
                  )}
                  {aboutMe!.language && (
                    <View style={styles.aboutRow}>
                      <Ionicons name="language-outline" size={18} color={colors.primary} />
                      <Text style={styles.aboutText}>{aboutMe!.language}</Text>
                    </View>
                  )}
                  {aboutMe!.age && (
                    <View style={styles.aboutRow}>
                      <Ionicons name="calendar-outline" size={18} color={colors.primary} />
                      <Text style={styles.aboutText}>{aboutMe!.age} years old</Text>
                    </View>
                  )}
                  {aboutMe!.gender && (
                    <View style={styles.aboutRow}>
                      <Ionicons name="person-outline" size={18} color={colors.primary} />
                      <Text style={styles.aboutText}>{genderLabel(aboutMe!.gender)}</Text>
                    </View>
                  )}
                  {aboutMe!.dietary.length > 0 && (
                    <View style={styles.aboutTagsGrid}>
                      {dietaryLabels(aboutMe!.dietary).map((label, i) => (
                        <View key={i} style={styles.aboutTag}>
                          <Text style={styles.aboutTagText}>{label}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                  {aboutMe!.interests.length > 0 && (
                    <View style={styles.aboutTagsGrid}>
                      {interestLabels(aboutMe!.interests).map((label, i) => (
                        <View key={i} style={styles.aboutTag}>
                          <Text style={styles.aboutTagText}>{label}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              )}

              <Text style={styles.postsHeading}>Posts</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <PostCard
            post={item}
            myId={myId}
            onPressUser={goToProfile}
            onToggleLike={toggleLike}
            onOpenComments={setCommentsPostId}
            onPressImage={setPreviewImage}
            onPressSharedTrip={(tripId) =>
              router.push({ pathname: "/shared-trip-view", params: { id: tripId } })
            }
            onPressLikes={setLikesModalUsers}
          />
        )}
        ListEmptyComponent={<Text style={styles.emptyText}>No posts yet.</Text>}
      />

      <LikesModal
        users={likesModalUsers}
        onClose={() => setLikesModalUsers(null)}
        onPressUser={(id) => {
          setLikesModalUsers(null);
          goToProfile(id);
        }}
      />

      <CommentsSheet
        post={activePost}
        myId={myId}
        onClose={() => setCommentsPostId(null)}
        onPressUser={goToProfile}
        onSubmitComment={submitComment}
        onDeleteComment={removeComment}
      />

      <Modal
        visible={!!previewImage}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewImage(null)}
      >
        <TouchableOpacity
          style={styles.previewOverlay}
          activeOpacity={1}
          onPress={() => setPreviewImage(null)}
        >
          <TouchableOpacity
            style={styles.previewClose}
            onPress={() => setPreviewImage(null)}
          >
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          {previewImage && (
            <Image
              source={{ uri: previewImage }}
              style={styles.previewImage}
              resizeMode="contain"
            />
          )}
        </TouchableOpacity>
      </Modal>
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
      paddingBottom: Spacing.lg,
    },
    avatarMargin: { marginBottom: Spacing.md },
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
    aboutSection: {
      width: "100%",
      backgroundColor: colors.surface,
      borderRadius: Radius.lg,
      padding: Spacing.lg,
      marginBottom: Spacing.xl,
      ...Elevation.sm,
    },
    aboutHeading: {
      fontSize: FontSize.small,
      fontFamily: FontFamily.semibold,
      color: colors.textMuted,
      marginBottom: Spacing.md,
    },
    aboutRow: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: Spacing.sm,
    },
    aboutText: {
      marginLeft: Spacing.md,
      fontSize: FontSize.body,
      fontFamily: FontFamily.medium,
      color: colors.textPrimary,
    },
    aboutTagsGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: Spacing.sm,
      marginTop: Spacing.sm,
    },
    aboutTag: {
      backgroundColor: colors.primarySoft,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.sm,
      borderRadius: Radius.pill,
    },
    aboutTagText: {
      color: colors.primary,
      fontFamily: FontFamily.semibold,
      fontSize: FontSize.small,
    },
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
    previewOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.95)",
      justifyContent: "center",
      alignItems: "center",
    },
    previewImage: { width: "100%", height: "100%" },
    previewClose: {
      position: "absolute",
      top: 50,
      right: 20,
      backgroundColor: "rgba(0,0,0,0.5)",
      width: 42,
      height: 42,
      borderRadius: 21,
      alignItems: "center",
      justifyContent: "center",
      zIndex: 10,
    },
  });
