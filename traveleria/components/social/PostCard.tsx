import { Ionicons } from "@expo/vector-icons";
import { useMemo } from "react";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { Elevation, ThemeColors } from "../../constants/theme";
import { useThemeColors } from "../../contexts/ThemeContext";
import { Post, SocialUser } from "../../services/socialService";
import { timeAgo } from "../../utils/timeAgo";
import { formatTripDates } from "../../utils/tripFormat";
import { Avatar } from "./Avatar";

export type PostCardProps = {
  post: Post;
  /** The signed-in user, for "did I like this" and "is this mine" checks. */
  myId: string | null;
  onToggleLike: (post: Post) => void;
  onOpenComments: (postId: string) => void;
  onOpenLikes: (users: SocialUser[]) => void;
  onPressImage: (uri: string) => void;
  onGoToProfile: (userId: string) => void;
  onPressSharedTrip: (tripId: string) => void;
  /**
   * Author-only controls. Omitted on screens that do not host the edit
   * composer — the card simply does not render them rather than showing a
   * button that cannot do anything.
   */
  onEdit?: (post: Post) => void;
  onDelete?: (postId: string) => void;
};

/**
 * One post, as shown in the feed and on a profile.
 *
 * Both screens render this same component so that likes, comments and a
 * shared trip behave identically wherever a post appears. The profile screen
 * previously had its own read-only copy of this markup, which is why posts
 * opened from a profile could not be liked or commented on and never showed
 * their trip.
 */
export function PostCard({
  post,
  myId,
  onToggleLike,
  onOpenComments,
  onOpenLikes,
  onPressImage,
  onGoToProfile,
  onPressSharedTrip,
  onEdit,
  onDelete,
}: PostCardProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const liked = post.likes.some((u) => u.id === myId);
  const isMine = post.user.id === myId;
  const commentCount =
    post.comments.length +
    post.comments.reduce((sum, c) => sum + c.replies.length, 0);

  return (
    <View style={styles.postCard}>
      <View style={styles.postHeader}>
        <TouchableOpacity
          style={styles.postHeaderTappable}
          onPress={() => onGoToProfile(post.user.id)}
        >
          <Avatar uri={post.user.avatar} style={styles.avatar} iconSize={22} />
          <View style={{ flex: 1 }}>
            <Text style={styles.userName}>{post.user.name}</Text>
            <Text style={styles.timestamp}>{timeAgo(post.createdAt)}</Text>
          </View>
        </TouchableOpacity>
        {isMine && !post.imageUri && onEdit && (
          <TouchableOpacity
            onPress={() => onEdit(post)}
            style={{ marginRight: 14 }}
          >
            <Ionicons name="pencil-outline" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        )}
        {isMine && onDelete && (
          <TouchableOpacity onPress={() => onDelete(post.id)}>
            <Ionicons name="trash-outline" size={20} color={colors.danger} />
          </TouchableOpacity>
        )}
      </View>

      {post.text ? <Text style={styles.postText}>{post.text}</Text> : null}
      {post.imageUri ? (
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() => onPressImage(post.imageUri!)}
        >
          <Image source={{ uri: post.imageUri }} style={styles.postImage} />
        </TouchableOpacity>
      ) : null}
      {post.sharedTrip ? (
        <TouchableOpacity
          style={styles.tripCard}
          activeOpacity={0.8}
          onPress={() => onPressSharedTrip(post.sharedTrip!.id)}
        >
          <View style={styles.tripCardIcon}>
            <Ionicons name="airplane" size={20} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.tripCardTitle}>{post.sharedTrip.title}</Text>
            <Text style={styles.tripCardMeta}>
              {formatTripDates(post.sharedTrip.date)} ·{" "}
              {post.sharedTrip.eventsCount}{" "}
              {post.sharedTrip.eventsCount === 1 ? "stop" : "stops"}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      ) : null}

      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => onToggleLike(post)}
        >
          <Ionicons
            name={liked ? "heart" : "heart-outline"}
            size={22}
            color={liked ? colors.danger : colors.textPrimary}
          />
          <Text style={styles.actionText}>{liked ? "Liked" : "Like"}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => onOpenComments(post.id)}
        >
          <Ionicons
            name="chatbubble-outline"
            size={20}
            color={colors.textPrimary}
          />
          <Text style={styles.actionText}>Comment</Text>
        </TouchableOpacity>
      </View>

      {post.likes.length > 0 && (
        <TouchableOpacity onPress={() => onOpenLikes(post.likes)}>
          <Text style={styles.metaText}>
            {post.likes.length} {post.likes.length === 1 ? "like" : "likes"}
          </Text>
        </TouchableOpacity>
      )}
      {commentCount > 0 && (
        <TouchableOpacity onPress={() => onOpenComments(post.id)}>
          <Text style={styles.metaText}>
            View {commentCount} {commentCount === 1 ? "comment" : "comments"}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    postCard: {
      backgroundColor: colors.surface,
      borderRadius: 15,
      padding: 14,
      marginBottom: 14,
      // Shared with the rest of the app's cards (e.g. home.tsx's trip cards)
      // rather than a hand-rolled shadow — that's also what makes dark mode
      // look right, since a raw shadow barely shows against a dark background.
      ...Elevation.sm,
    },
    postHeader: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
    postHeaderTappable: { flex: 1, flexDirection: "row", alignItems: "center" },
    avatar: { width: 40, height: 40, borderRadius: 20, marginRight: 10 },
    userName: { fontSize: 15, fontWeight: "bold", color: colors.textPrimary },
    timestamp: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
    postText: {
      fontSize: 15,
      color: colors.textPrimary,
      lineHeight: 21,
      marginBottom: 10,
    },
    postImage: {
      width: "100%",
      height: 240,
      borderRadius: 12,
      marginBottom: 8,
      backgroundColor: colors.border,
    },
    tripCard: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.surfaceSunken,
      borderRadius: 12,
      padding: 12,
      marginBottom: 10,
    },
    tripCardIcon: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.primarySoft,
      alignItems: "center",
      justifyContent: "center",
      marginRight: 10,
    },
    tripCardTitle: {
      fontSize: 14,
      fontWeight: "bold",
      color: colors.textPrimary,
    },
    tripCardMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
    actionsRow: {
      flexDirection: "row",
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: 8,
      marginTop: 4,
    },
    actionBtn: { flexDirection: "row", alignItems: "center", marginRight: 22 },
    actionText: {
      marginLeft: 6,
      color: colors.textPrimary,
      fontWeight: "500",
    },
    metaText: { fontSize: 13, color: colors.textMuted, marginTop: 6 },
  });
