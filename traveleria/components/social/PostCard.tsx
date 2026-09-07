import { Ionicons } from "@expo/vector-icons";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { Elevation, FontFamily, ThemeColors } from "../../constants/theme";
import { useThemeColors } from "../../contexts/ThemeContext";
import { formatTripDates } from "../../utils/tripFormat";
import { Post, SocialUser } from "../../services/socialService";
import { Avatar } from "./Avatar";
import { timeAgo } from "./timeAgo";

type PostCardProps = {
  post: Post;
  myId: string | null;
  onPressUser: (userId: string) => void;
  onToggleLike: (post: Post) => void;
  onOpenComments: (postId: string) => void;
  onPressImage: (uri: string) => void;
  onPressSharedTrip: (tripId: string) => void;
  onPressLikes: (likes: SocialUser[]) => void;
  /** Present only when the caller wants edit/delete shown — both are only
   * ever rendered for the post's own author, same as the original feed. */
  onEdit?: (post: Post) => void;
  onDelete?: (postId: string) => void;
};

/**
 * One post: header, text/photo/shared-trip body, and the like/comment
 * actions row. Shared between the main feed and a profile's post list so
 * liking or commenting from either place stays in sync automatically --
 * they both just call the same social API underneath.
 */
export function PostCard({
  post,
  myId,
  onPressUser,
  onToggleLike,
  onOpenComments,
  onPressImage,
  onPressSharedTrip,
  onPressLikes,
  onEdit,
  onDelete,
}: PostCardProps) {
  const colors = useThemeColors();
  const styles = makeStyles(colors);

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
          onPress={() => onPressUser(post.user.id)}
        >
          <Avatar uri={post.user.avatar} size={40} iconSize={22} style={styles.avatarMargin} />
          <View style={{ flex: 1 }}>
            <Text style={styles.userName}>{post.user.name}</Text>
            <Text style={styles.timestamp}>{timeAgo(post.createdAt)}</Text>
          </View>
        </TouchableOpacity>
        {isMine && onEdit && !post.imageUri && (
          <TouchableOpacity onPress={() => onEdit(post)} style={{ marginRight: 14 }}>
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
        <TouchableOpacity activeOpacity={0.9} onPress={() => onPressImage(post.imageUri!)}>
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
              {formatTripDates(post.sharedTrip.date)} · {post.sharedTrip.eventsCount}{" "}
              {post.sharedTrip.eventsCount === 1 ? "stop" : "stops"}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      ) : null}

      <View style={styles.actionsRow}>
        <TouchableOpacity style={styles.actionBtn} onPress={() => onToggleLike(post)}>
          <Ionicons
            name={liked ? "heart" : "heart-outline"}
            size={22}
            color={liked ? colors.danger : colors.textPrimary}
          />
          <Text style={styles.actionText}>{liked ? "Liked" : "Like"}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionBtn} onPress={() => onOpenComments(post.id)}>
          <Ionicons name="chatbubble-outline" size={20} color={colors.textPrimary} />
          <Text style={styles.actionText}>Comment</Text>
        </TouchableOpacity>
      </View>

      {post.likes.length > 0 && (
        <TouchableOpacity onPress={() => onPressLikes(post.likes)}>
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
      ...Elevation.sm,
    },
    postHeader: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
    postHeaderTappable: { flex: 1, flexDirection: "row", alignItems: "center" },
    avatarMargin: { marginRight: 10 },
    userName: { fontSize: 15, fontFamily: FontFamily.bold, color: colors.textPrimary },
    timestamp: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
    postText: { fontSize: 15, color: colors.textPrimary, lineHeight: 21, marginBottom: 10 },
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
    tripCardTitle: { fontSize: 14, fontFamily: FontFamily.bold, color: colors.textPrimary },
    tripCardMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
    actionsRow: {
      flexDirection: "row",
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: 8,
      marginTop: 4,
    },
    actionBtn: { flexDirection: "row", alignItems: "center", marginRight: 22 },
    actionText: { marginLeft: 6, color: colors.textPrimary, fontFamily: FontFamily.medium },
    metaText: { fontSize: 13, color: colors.textMuted, marginTop: 6 },
  });
