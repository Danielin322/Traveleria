import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import {
  Alert,
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
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FontFamily, ThemeColors } from "../../constants/theme";
import { useThemeColors } from "../../contexts/ThemeContext";
import { Comment, Post, Reply } from "../../services/socialService";
import { Avatar } from "./Avatar";
import { timeAgo } from "./timeAgo";

type CommentsSheetProps = {
  post: Post | null;
  myId: string | null;
  onClose: () => void;
  onPressUser: (userId: string) => void;
  onSubmitComment: (text: string, parentCommentId?: string) => Promise<void>;
  onDeleteComment: (commentId: string) => void;
};

/**
 * Comments + replies for one post, as a bottom sheet. Owns its own draft and
 * reply-target state so it can be dropped into any screen that has a Post
 * to show -- the feed and a profile's post list both use it, which is what
 * keeps liking/commenting behaviour identical in both places.
 */
export function CommentsSheet({
  post,
  myId,
  onClose,
  onPressUser,
  onSubmitComment,
  onDeleteComment,
}: CommentsSheetProps) {
  const colors = useThemeColors();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();

  const [commentDraft, setCommentDraft] = useState("");
  const [replyTarget, setReplyTarget] = useState<{
    commentId: string;
    userName: string;
  } | null>(null);
  // Replies are collapsed by default; this tracks which top-level comments
  // have been expanded to show theirs.
  const [expandedComments, setExpandedComments] = useState<Set<string>>(new Set());

  // A fresh post (or the sheet closing) starts with a clean slate rather than
  // carrying over a draft or reply target meant for a different post. Reset
  // during render (not an effect) so it lands in the same commit as the new
  // post, instead of flashing the stale draft for one frame first.
  const [shownPostId, setShownPostId] = useState(post?.id ?? null);
  if ((post?.id ?? null) !== shownPostId) {
    setShownPostId(post?.id ?? null);
    setCommentDraft("");
    setReplyTarget(null);
    setExpandedComments(new Set());
  }

  const toggleExpanded = (commentId: string) => {
    setExpandedComments((prev) => {
      const next = new Set(prev);
      if (next.has(commentId)) {
        next.delete(commentId);
      } else {
        next.add(commentId);
      }
      return next;
    });
  };

  const submitComment = async () => {
    if (!commentDraft.trim()) return;
    const text = commentDraft.trim();
    const parentCommentId = replyTarget?.commentId;
    setCommentDraft("");
    setReplyTarget(null);
    await onSubmitComment(text, parentCommentId);
  };

  const removeComment = (commentId: string) => {
    Alert.alert("Delete comment?", "", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => onDeleteComment(commentId) },
    ]);
  };

  return (
    <Modal visible={!!post} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.commentsOverlay}
      >
        <View
          style={[
            styles.commentsSheet,
            // The system nav bar / gesture strip on Android sits under this
            // sheet's fixed paddingBottom, which is why the send button was
            // getting covered. insets.bottom is the actual reserved height
            // on this specific device.
            { paddingBottom: 36 + insets.bottom },
          ]}
        >
          <View style={styles.commentsHeader}>
            <Text style={styles.modalTitle}>Comments</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={26} color={colors.danger} />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flex: 1 }}>
            {post?.comments.length === 0 && (
              <Text style={styles.emptyText}>No comments yet. Be the first!</Text>
            )}
            {post?.comments.map((c: Comment) => (
              <View key={c.id} style={styles.commentBlock}>
                <View style={styles.commentRow}>
                  <TouchableOpacity onPress={() => onPressUser(c.user.id)}>
                    <Avatar uri={c.user.avatar} size={36} iconSize={18} style={styles.avatarMargin} />
                  </TouchableOpacity>
                  <View style={{ flex: 1 }}>
                    <TouchableOpacity onPress={() => onPressUser(c.user.id)}>
                      <Text style={styles.commentName}>{c.user.name}</Text>
                    </TouchableOpacity>
                    <Text style={styles.commentText}>{c.text}</Text>
                    <View style={styles.commentMetaRow}>
                      <Text style={styles.commentMeta}>{timeAgo(c.createdAt)}</Text>
                      <TouchableOpacity
                        onPress={() => setReplyTarget({ commentId: c.id, userName: c.user.name })}
                      >
                        <Text style={styles.replyLink}>Reply</Text>
                      </TouchableOpacity>
                      {c.user.id === myId && (
                        <TouchableOpacity onPress={() => removeComment(c.id)}>
                          <Text style={[styles.replyLink, { color: colors.danger }]}>Delete</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                </View>

                {c.replies.length > 0 && (
                  <TouchableOpacity
                    style={styles.viewRepliesBtn}
                    onPress={() => toggleExpanded(c.id)}
                  >
                    <View style={styles.viewRepliesLine} />
                    <Text style={styles.viewRepliesText}>
                      {expandedComments.has(c.id)
                        ? "Hide replies"
                        : `View ${c.replies.length} ${c.replies.length === 1 ? "reply" : "replies"}`}
                    </Text>
                  </TouchableOpacity>
                )}

                {expandedComments.has(c.id) &&
                  c.replies.map((r: Reply) => (
                    <View
                      key={r.id}
                      style={[
                        styles.replyRow,
                        // A gentle per-level shift, not a big one -- the
                        // connecting line (in the base style) is what shows
                        // the thread's shape, so indent alone doesn't have
                        // to. Capped so a very deep thread still leaves room
                        // for the text on a phone screen.
                        { marginLeft: 46 + Math.min(r.depth - 1, 4) * 16 },
                      ]}
                    >
                      <TouchableOpacity onPress={() => onPressUser(r.user.id)}>
                        <Avatar uri={r.user.avatar} size={28} iconSize={14} style={styles.tinyAvatarMargin} />
                      </TouchableOpacity>
                      <View style={{ flex: 1 }}>
                        <TouchableOpacity onPress={() => onPressUser(r.user.id)}>
                          <Text style={styles.commentName}>{r.user.name}</Text>
                        </TouchableOpacity>
                        <Text style={styles.commentText}>
                          {r.replyingToName && (
                            <Text style={styles.replyingToTag}>@{r.replyingToName} </Text>
                          )}
                          {r.text}
                        </Text>
                        <View style={styles.commentMetaRow}>
                          <Text style={styles.commentMeta}>{timeAgo(r.createdAt)}</Text>
                          <TouchableOpacity
                            onPress={() =>
                              setReplyTarget({ commentId: r.id, userName: r.user.name })
                            }
                          >
                            <Text style={styles.replyLink}>Reply</Text>
                          </TouchableOpacity>
                          {r.user.id === myId && (
                            <TouchableOpacity onPress={() => removeComment(r.id)}>
                              <Text style={[styles.replyLink, { color: colors.danger }]}>
                                Delete
                              </Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                    </View>
                  ))}
              </View>
            ))}
          </ScrollView>

          {replyTarget && (
            <View style={styles.replyBanner}>
              <Text style={styles.replyBannerText}>Replying to {replyTarget.userName}</Text>
              <TouchableOpacity onPress={() => setReplyTarget(null)}>
                <Ionicons name="close" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.commentInputRow}>
            <TextInput
              style={styles.commentInput}
              placeholder={replyTarget ? "Write a reply..." : "Add a comment..."}
              placeholderTextColor={colors.textDisabled}
              value={commentDraft}
              onChangeText={setCommentDraft}
              multiline
            />
            <TouchableOpacity style={styles.sendBtn} onPress={submitComment}>
              <Ionicons name="send" size={20} color={colors.primaryContrast} />
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    modalTitle: {
      fontSize: 20,
      fontFamily: FontFamily.bold,
      textAlign: "center",
      color: colors.textPrimary,
    },
    commentsOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
    commentsSheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      paddingHorizontal: 18,
      paddingTop: 14,
      paddingBottom: 36,
      height: "78%",
    },
    commentsHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 8,
    },
    emptyText: { textAlign: "center", color: colors.textMuted, marginTop: 30, fontSize: 14 },
    commentBlock: { marginBottom: 14 },
    commentRow: { flexDirection: "row", alignItems: "flex-start" },
    avatarMargin: { marginRight: 10 },
    tinyAvatarMargin: { marginRight: 8 },
    viewRepliesBtn: { flexDirection: "row", alignItems: "center", marginTop: 8, marginLeft: 46 },
    viewRepliesLine: { width: 24, height: 1, backgroundColor: colors.border, marginRight: 8 },
    viewRepliesText: { fontSize: 12, color: colors.textMuted, fontFamily: FontFamily.semibold },
    replyRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      marginTop: 10,
      // The connecting line down the side of a thread -- this is what
      // actually shows the nesting; the indent itself only needs to shift
      // gently.
      borderLeftWidth: 2,
      borderLeftColor: colors.border,
      paddingLeft: 10,
    },
    commentName: { fontFamily: FontFamily.bold, color: colors.textPrimary, fontSize: 14 },
    commentText: { color: colors.textPrimary, fontSize: 14, marginTop: 2 },
    replyingToTag: { color: colors.primary, fontFamily: FontFamily.semibold },
    commentMetaRow: { flexDirection: "row", alignItems: "center", marginTop: 4 },
    commentMeta: { fontSize: 12, color: colors.textMuted, marginRight: 14 },
    replyLink: {
      fontSize: 12,
      color: colors.primary,
      fontFamily: FontFamily.semibold,
      marginRight: 14,
    },
    replyBanner: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      backgroundColor: colors.primarySoft,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 10,
      marginBottom: 6,
    },
    replyBannerText: { color: colors.primary, fontSize: 13, fontFamily: FontFamily.semibold },
    commentInputRow: {
      flexDirection: "row",
      alignItems: "flex-end",
      paddingTop: 6,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    commentInput: {
      flex: 1,
      maxHeight: 100,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 18,
      paddingHorizontal: 14,
      paddingVertical: 8,
      fontSize: 14,
      marginRight: 8,
      color: colors.textPrimary,
      backgroundColor: colors.surfaceSunken,
    },
    sendBtn: {
      backgroundColor: colors.primary,
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
    },
  });
