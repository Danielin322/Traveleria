import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import {
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

import { ThemeColors } from "../../constants/theme";
import { useThemeColors } from "../../contexts/ThemeContext";
import { Comment, Post, Reply } from "../../services/socialService";
import { timeAgo } from "../../utils/timeAgo";
import { Avatar } from "./Avatar";

export type CommentsSheetProps = {
  /** The post whose thread is open, or null when the sheet is closed. */
  post: Post | null;
  myId: string | null;
  onClose: () => void;
  /** parentCommentId is undefined for a top-level comment. */
  onSubmit: (text: string, parentCommentId?: string) => void;
  onDeleteComment: (commentId: string) => void;
  onGoToProfile: (userId: string) => void;
};

/**
 * The comment thread for one post, as a bottom sheet.
 *
 * Draft text, the reply target and which threads are expanded are local to
 * the sheet: they are throwaway UI state that should reset when it closes,
 * and no screen hosting it needs to read them.
 */
export function CommentsSheet({
  post,
  myId,
  onClose,
  onSubmit,
  onDeleteComment,
  onGoToProfile,
}: CommentsSheetProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

  const [draft, setDraft] = useState("");
  // replyTarget.commentId is whatever comment or reply is being replied to
  // directly — the backend has no depth limit, so this works the same whether
  // it points at a top-level comment or a reply.
  const [replyTarget, setReplyTarget] = useState<{
    commentId: string;
    userName: string;
  } | null>(null);
  // Replies are collapsed by default; this tracks which top-level comments
  // have been expanded to show theirs.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpanded = (commentId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(commentId)) {
        next.delete(commentId);
      } else {
        next.add(commentId);
      }
      return next;
    });
  };

  const reset = () => {
    setDraft("");
    setReplyTarget(null);
    setExpanded(new Set());
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = () => {
    if (!draft.trim()) return;
    const text = draft.trim();
    const parentCommentId = replyTarget?.commentId;
    setDraft("");
    setReplyTarget(null);
    onSubmit(text, parentCommentId);
  };

  return (
    <Modal
      visible={!!post}
      animationType="slide"
      transparent
      onRequestClose={close}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.commentsOverlay}
      >
        <View
          style={[
            styles.commentsSheet,
            // The system nav bar / gesture strip on Android sits under this
            // sheet's fixed paddingBottom, which is why the send button was
            // getting covered. insets.bottom is the actual reserved height on
            // this specific device.
            { paddingBottom: 36 + insets.bottom },
          ]}
        >
          <View style={styles.commentsHeader}>
            <Text style={styles.modalTitle}>Comments</Text>
            <TouchableOpacity onPress={close}>
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
                  <TouchableOpacity onPress={() => onGoToProfile(c.user.id)}>
                    <Avatar
                      uri={c.user.avatar}
                      style={styles.smallAvatar}
                      iconSize={18}
                    />
                  </TouchableOpacity>
                  <View style={{ flex: 1 }}>
                    <TouchableOpacity onPress={() => onGoToProfile(c.user.id)}>
                      <Text style={styles.commentName}>{c.user.name}</Text>
                    </TouchableOpacity>
                    <Text style={styles.commentText}>{c.text}</Text>
                    <View style={styles.commentMetaRow}>
                      <Text style={styles.commentMeta}>
                        {timeAgo(c.createdAt)}
                      </Text>
                      <TouchableOpacity
                        onPress={() =>
                          setReplyTarget({
                            commentId: c.id,
                            userName: c.user.name,
                          })
                        }
                      >
                        <Text style={styles.replyLink}>Reply</Text>
                      </TouchableOpacity>
                      {c.user.id === myId && (
                        <TouchableOpacity onPress={() => onDeleteComment(c.id)}>
                          <Text
                            style={[styles.replyLink, { color: colors.danger }]}
                          >
                            Delete
                          </Text>
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
                      {expanded.has(c.id)
                        ? "Hide replies"
                        : `View ${c.replies.length} ${
                            c.replies.length === 1 ? "reply" : "replies"
                          }`}
                    </Text>
                  </TouchableOpacity>
                )}

                {expanded.has(c.id) &&
                  c.replies.map((r: Reply) => (
                    <View
                      key={r.id}
                      style={[
                        styles.replyRow,
                        // A gentle per-level shift, not a big one — the
                        // connecting line (in the base style) is what shows
                        // the thread's shape, so indent alone doesn't have
                        // to. Capped so a very deep thread still leaves room
                        // for the text on a phone screen.
                        { marginLeft: 46 + Math.min(r.depth - 1, 4) * 16 },
                      ]}
                    >
                      <TouchableOpacity onPress={() => onGoToProfile(r.user.id)}>
                        <Avatar
                          uri={r.user.avatar}
                          style={styles.tinyAvatar}
                          iconSize={14}
                        />
                      </TouchableOpacity>
                      <View style={{ flex: 1 }}>
                        <TouchableOpacity
                          onPress={() => onGoToProfile(r.user.id)}
                        >
                          <Text style={styles.commentName}>{r.user.name}</Text>
                        </TouchableOpacity>
                        <Text style={styles.commentText}>
                          {r.replyingToName && (
                            <Text style={styles.replyingToTag}>
                              @{r.replyingToName}{" "}
                            </Text>
                          )}
                          {r.text}
                        </Text>
                        <View style={styles.commentMetaRow}>
                          <Text style={styles.commentMeta}>
                            {timeAgo(r.createdAt)}
                          </Text>
                          <TouchableOpacity
                            onPress={() =>
                              setReplyTarget({
                                commentId: r.id,
                                userName: r.user.name,
                              })
                            }
                          >
                            <Text style={styles.replyLink}>Reply</Text>
                          </TouchableOpacity>
                          {r.user.id === myId && (
                            <TouchableOpacity
                              onPress={() => onDeleteComment(r.id)}
                            >
                              <Text
                                style={[
                                  styles.replyLink,
                                  { color: colors.danger },
                                ]}
                              >
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
              <Text style={styles.replyBannerText}>
                Replying to {replyTarget.userName}
              </Text>
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
              value={draft}
              onChangeText={setDraft}
              multiline
            />
            <TouchableOpacity style={styles.sendBtn} onPress={submit}>
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
    commentsOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      justifyContent: "flex-end",
    },
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
    modalTitle: {
      fontSize: 20,
      fontWeight: "bold",
      marginBottom: 14,
      textAlign: "center",
      // Never had a colour, so it rendered in the system default (black),
      // unreadable against the dark surface these modals use in dark mode.
      color: colors.textPrimary,
    },
    emptyText: {
      textAlign: "center",
      color: colors.textMuted,
      marginTop: 30,
      fontSize: 14,
    },
    smallAvatar: { width: 36, height: 36, borderRadius: 18, marginRight: 10 },
    tinyAvatar: { width: 28, height: 28, borderRadius: 14, marginRight: 8 },
    commentBlock: { marginBottom: 14 },
    commentRow: { flexDirection: "row", alignItems: "flex-start" },
    viewRepliesBtn: {
      flexDirection: "row",
      alignItems: "center",
      marginTop: 8,
      marginLeft: 46,
    },
    viewRepliesLine: {
      width: 24,
      height: 1,
      backgroundColor: colors.border,
      marginRight: 8,
    },
    viewRepliesText: { fontSize: 12, color: colors.textMuted, fontWeight: "600" },
    replyRow: {
      // marginLeft is set per-reply based on depth — see the render call.
      flexDirection: "row",
      alignItems: "flex-start",
      marginTop: 10,
      // The connecting line down the side of a thread — this is what actually
      // shows the nesting; the indent itself only needs to shift gently.
      borderLeftWidth: 2,
      borderLeftColor: colors.border,
      paddingLeft: 10,
    },
    commentName: { fontWeight: "bold", color: colors.textPrimary, fontSize: 14 },
    commentText: { color: colors.textPrimary, fontSize: 14, marginTop: 2 },
    replyingToTag: { color: colors.primary, fontWeight: "600" },
    commentMetaRow: { flexDirection: "row", alignItems: "center", marginTop: 4 },
    commentMeta: { fontSize: 12, color: colors.textMuted, marginRight: 14 },
    replyLink: {
      fontSize: 12,
      color: colors.primary,
      fontWeight: "600",
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
    replyBannerText: { color: colors.primary, fontSize: 13, fontWeight: "600" },
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
      // Without an explicit colour a TextInput renders black in both themes.
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
