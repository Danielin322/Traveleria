import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Image,
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
import {
  Comment,
  INITIAL_POSTS,
  Post,
  Reply,
  SocialUser,
} from "../../constants/socialMockData";
import {
  CURRENT_USER_ID,
  useCurrentUser,
} from "../../contexts/CurrentUserContext";

const PRIMARY = "#2f6deb";
const BG = "#f4f6f8";
const CARD = "#fff";
const MUTED = "#888";
const TEXT = "#1a1a1a";

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

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export default function SocialScreen() {
  const currentUser = useCurrentUser();
  const me: SocialUser = {
    id: CURRENT_USER_ID,
    name: currentUser.name,
    avatar: currentUser.avatar,
  };

  // Resolve a stored user reference against the live current-user info,
  // so name/avatar updates in profile reflect everywhere immediately.
  const displayUser = (u: SocialUser): SocialUser =>
    u.id === CURRENT_USER_ID ? me : u;

  const [posts, setPosts] = useState<Post[]>(INITIAL_POSTS);

  // Create-post modal
  const [composerOpen, setComposerOpen] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [draftImage, setDraftImage] = useState<string | undefined>(undefined);

  // Likes modal
  const [likesModalUsers, setLikesModalUsers] = useState<SocialUser[] | null>(
    null
  );

  // Image preview modal
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // Comments modal
  const [commentsPostId, setCommentsPostId] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [replyTarget, setReplyTarget] = useState<{
    commentId: string;
    userName: string;
  } | null>(null);

  const activePost = useMemo(
    () => posts.find((p) => p.id === commentsPostId) ?? null,
    [posts, commentsPostId]
  );

  // ---------- Posts ----------
  const pickImage = async (fromCamera: boolean) => {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "Please allow access to continue.");
      return;
    }
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.7,
        });
    if (!result.canceled && result.assets?.[0]?.uri) {
      setDraftImage(result.assets[0].uri);
    }
  };

  const submitPost = () => {
    if (!draftText.trim() && !draftImage) {
      Alert.alert("Empty post", "Add some text or a photo first.");
      return;
    }
    const newPost: Post = {
      id: uid("p"),
      user: me,
      text: draftText.trim() || undefined,
      imageUri: draftImage,
      createdAt: new Date().toISOString(),
      likes: [],
      comments: [],
    };
    setPosts((prev) => [newPost, ...prev]);
    setDraftText("");
    setDraftImage(undefined);
    setComposerOpen(false);
  };

  const deletePost = (postId: string) => {
    Alert.alert("Delete post?", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => setPosts((prev) => prev.filter((p) => p.id !== postId)),
      },
    ]);
  };

  // ---------- Likes ----------
  const toggleLike = (postId: string) => {
    setPosts((prev) =>
      prev.map((p) => {
        if (p.id !== postId) return p;
        const liked = p.likes.some((u) => u.id === CURRENT_USER_ID);
        return {
          ...p,
          likes: liked
            ? p.likes.filter((u) => u.id !== CURRENT_USER_ID)
            : [...p.likes, me],
        };
      })
    );
  };

  // ---------- Comments / Replies ----------
  const submitComment = () => {
    if (!commentsPostId || !commentDraft.trim()) return;
    const text = commentDraft.trim();
    setPosts((prev) =>
      prev.map((p) => {
        if (p.id !== commentsPostId) return p;
        if (replyTarget) {
          return {
            ...p,
            comments: p.comments.map((c) =>
              c.id === replyTarget.commentId
                ? {
                    ...c,
                    replies: [
                      ...c.replies,
                      {
                        id: uid("r"),
                        user: me,
                        text,
                        createdAt: new Date().toISOString(),
                      } as Reply,
                    ],
                  }
                : c
            ),
          };
        }
        return {
          ...p,
          comments: [
            ...p.comments,
            {
              id: uid("c"),
              user: me,
              text,
              createdAt: new Date().toISOString(),
              replies: [],
            } as Comment,
          ],
        };
      })
    );
    setCommentDraft("");
    setReplyTarget(null);
  };

  const deleteComment = (postId: string, commentId: string) => {
    Alert.alert("Delete comment?", "", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () =>
          setPosts((prev) =>
            prev.map((p) =>
              p.id === postId
                ? {
                    ...p,
                    comments: p.comments.filter((c) => c.id !== commentId),
                  }
                : p
            )
          ),
      },
    ]);
  };

  const deleteReply = (
    postId: string,
    commentId: string,
    replyId: string
  ) => {
    setPosts((prev) =>
      prev.map((p) =>
        p.id === postId
          ? {
              ...p,
              comments: p.comments.map((c) =>
                c.id === commentId
                  ? {
                      ...c,
                      replies: c.replies.filter((r) => r.id !== replyId),
                    }
                  : c
              ),
            }
          : p
      )
    );
  };

  // ---------- Render ----------
  const renderPost = ({ item }: { item: Post }) => {
    const liked = item.likes.some((u) => u.id === CURRENT_USER_ID);
    const isMine = item.user.id === CURRENT_USER_ID;
    const author = displayUser(item.user);
    const commentCount =
      item.comments.length +
      item.comments.reduce((sum, c) => sum + c.replies.length, 0);

    return (
      <View style={styles.postCard}>
        <View style={styles.postHeader}>
          <Image
            source={{
              uri:
                author.avatar ?? "https://i.pravatar.cc/150?u=" + author.id,
            }}
            style={styles.avatar}
          />
          <View style={{ flex: 1 }}>
            <Text style={styles.userName}>{author.name}</Text>
            <Text style={styles.timestamp}>{timeAgo(item.createdAt)}</Text>
          </View>
          {isMine && (
            <TouchableOpacity onPress={() => deletePost(item.id)}>
              <Ionicons name="trash-outline" size={20} color="#e53935" />
            </TouchableOpacity>
          )}
        </View>

        {item.text ? <Text style={styles.postText}>{item.text}</Text> : null}
        {item.imageUri ? (
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => setPreviewImage(item.imageUri!)}
          >
            <Image source={{ uri: item.imageUri }} style={styles.postImage} />
          </TouchableOpacity>
        ) : null}

        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => toggleLike(item.id)}
          >
            <Ionicons
              name={liked ? "heart" : "heart-outline"}
              size={22}
              color={liked ? "#e53935" : TEXT}
            />
            <Text style={styles.actionText}>
              {liked ? "Liked" : "Like"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => setCommentsPostId(item.id)}
          >
            <Ionicons name="chatbubble-outline" size={20} color={TEXT} />
            <Text style={styles.actionText}>Comment</Text>
          </TouchableOpacity>
        </View>

        {item.likes.length > 0 && (
          <TouchableOpacity onPress={() => setLikesModalUsers(item.likes)}>
            <Text style={styles.metaText}>
              {item.likes.length} {item.likes.length === 1 ? "like" : "likes"}
            </Text>
          </TouchableOpacity>
        )}
        {commentCount > 0 && (
          <TouchableOpacity onPress={() => setCommentsPostId(item.id)}>
            <Text style={styles.metaText}>
              View {commentCount}{" "}
              {commentCount === 1 ? "comment" : "comments"}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>Social</Text>
          <Text style={styles.subtitle}>Share your travel moments.</Text>
        </View>
        <TouchableOpacity
          style={styles.newBtn}
          onPress={() => setComposerOpen(true)}
        >
          <Ionicons name="add" size={22} color="#fff" />
          <Text style={styles.newBtnText}>Post</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={posts}
        renderItem={renderPost}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ paddingBottom: 30 }}
        showsVerticalScrollIndicator={false}
      />

      {/* ---------- Composer Modal ---------- */}
      <Modal visible={composerOpen} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>New Post</Text>
            <TextInput
              style={styles.composerInput}
              placeholder="Share an experience..."
              value={draftText}
              onChangeText={setDraftText}
              multiline
            />
            {draftImage && (
              <View style={styles.draftImageWrap}>
                <Image
                  source={{ uri: draftImage }}
                  style={styles.draftImage}
                />
                <TouchableOpacity
                  style={styles.removeImgBtn}
                  onPress={() => setDraftImage(undefined)}
                >
                  <Ionicons name="close" size={18} color="#fff" />
                </TouchableOpacity>
              </View>
            )}

            <View style={styles.composerActions}>
              <TouchableOpacity
                style={styles.iconBtn}
                onPress={() => pickImage(false)}
              >
                <Ionicons name="image-outline" size={22} color={PRIMARY} />
                <Text style={styles.iconBtnText}>Gallery</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.iconBtn}
                onPress={() => pickImage(true)}
              >
                <Ionicons name="camera-outline" size={22} color={PRIMARY} />
                <Text style={styles.iconBtnText}>Camera</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => {
                  setComposerOpen(false);
                  setDraftText("");
                  setDraftImage(undefined);
                }}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.saveButton]}
                onPress={submitPost}
              >
                <Text style={styles.saveButtonText}>Post</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ---------- Image Preview Modal ---------- */}
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

      {/* ---------- Likes Modal ---------- */}
      <Modal
        visible={!!likesModalUsers}
        animationType="fade"
        transparent
        onRequestClose={() => setLikesModalUsers(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { minHeight: 380 }]}>
            <Text style={styles.modalTitle}>Liked by</Text>
            <ScrollView style={{ minHeight: 240, maxHeight: 380 }}>
              {likesModalUsers?.map((rawUser) => {
                const u = displayUser(rawUser);
                return (
                  <View key={u.id} style={styles.likeRow}>
                    <Image
                      source={{
                        uri:
                          u.avatar ?? "https://i.pravatar.cc/150?u=" + u.id,
                      }}
                      style={styles.smallAvatar}
                    />
                    <Text style={styles.likeName}>{u.name}</Text>
                  </View>
                );
              })}
            </ScrollView>
            <TouchableOpacity
              style={[
                styles.modalButton,
                styles.saveButton,
                {
                  marginTop: 16,
                  marginBottom: 24,
                  paddingVertical: 22,
                  minHeight: 64,
                  justifyContent: "center",
                },
              ]}
              onPress={() => setLikesModalUsers(null)}
            >
              <Text style={[styles.saveButtonText, { fontSize: 18 }]}>
                Close
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ---------- Comments Modal ---------- */}
      <Modal
        visible={!!commentsPostId}
        animationType="slide"
        transparent
        onRequestClose={() => {
          setCommentsPostId(null);
          setReplyTarget(null);
          setCommentDraft("");
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.commentsOverlay}
        >
          <View style={styles.commentsSheet}>
            <View style={styles.commentsHeader}>
              <Text style={styles.modalTitle}>Comments</Text>
              <TouchableOpacity
                onPress={() => {
                  setCommentsPostId(null);
                  setReplyTarget(null);
                  setCommentDraft("");
                }}
              >
                <Ionicons name="close" size={26} color="#e53935" />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ flex: 1 }}>
              {activePost?.comments.length === 0 && (
                <Text style={styles.emptyText}>
                  No comments yet. Be the first!
                </Text>
              )}
              {activePost?.comments.map((c) => {
                const cu = displayUser(c.user);
                return (
                <View key={c.id} style={styles.commentBlock}>
                  <View style={styles.commentRow}>
                    <Image
                      source={{
                        uri:
                          cu.avatar ?? "https://i.pravatar.cc/150?u=" + cu.id,
                      }}
                      style={styles.smallAvatar}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.commentName}>{cu.name}</Text>
                      <Text style={styles.commentText}>{c.text}</Text>
                      <View style={styles.commentMetaRow}>
                        <Text style={styles.commentMeta}>
                          {timeAgo(c.createdAt)}
                        </Text>
                        <TouchableOpacity
                          onPress={() =>
                            setReplyTarget({
                              commentId: c.id,
                              userName: cu.name,
                            })
                          }
                        >
                          <Text style={styles.replyLink}>Reply</Text>
                        </TouchableOpacity>
                        {c.user.id === CURRENT_USER_ID && (
                          <TouchableOpacity
                            onPress={() =>
                              deleteComment(activePost.id, c.id)
                            }
                          >
                            <Text
                              style={[styles.replyLink, { color: "#e53935" }]}
                            >
                              Delete
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  </View>

                  {c.replies.map((r) => {
                    const ru = displayUser(r.user);
                    return (
                    <View key={r.id} style={styles.replyRow}>
                      <Image
                        source={{
                          uri:
                            ru.avatar ?? "https://i.pravatar.cc/150?u=" + ru.id,
                        }}
                        style={styles.tinyAvatar}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.commentName}>{ru.name}</Text>
                        <Text style={styles.commentText}>{r.text}</Text>
                        <View style={styles.commentMetaRow}>
                          <Text style={styles.commentMeta}>
                            {timeAgo(r.createdAt)}
                          </Text>
                          {r.user.id === CURRENT_USER_ID && (
                            <TouchableOpacity
                              onPress={() =>
                                deleteReply(activePost.id, c.id, r.id)
                              }
                            >
                              <Text
                                style={[
                                  styles.replyLink,
                                  { color: "#e53935" },
                                ]}
                              >
                                Delete
                              </Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                    </View>
                    );
                  })}
                </View>
                );
              })}
            </ScrollView>

            {replyTarget && (
              <View style={styles.replyBanner}>
                <Text style={styles.replyBannerText}>
                  Replying to {replyTarget.userName}
                </Text>
                <TouchableOpacity onPress={() => setReplyTarget(null)}>
                  <Ionicons name="close" size={18} color={MUTED} />
                </TouchableOpacity>
              </View>
            )}

            <View style={styles.commentInputRow}>
              <TextInput
                style={styles.commentInput}
                placeholder={
                  replyTarget ? "Write a reply..." : "Add a comment..."
                }
                value={commentDraft}
                onChangeText={setCommentDraft}
                multiline
              />
              <TouchableOpacity
                style={styles.sendBtn}
                onPress={submitComment}
              >
                <Ionicons name="send" size={20} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG, padding: 20, paddingTop: 60 },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 18,
  },
  title: { fontSize: 30, fontWeight: "bold", color: TEXT },
  subtitle: { fontSize: 14, color: MUTED, marginTop: 2 },
  newBtn: {
    backgroundColor: PRIMARY,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
  },
  newBtnText: { color: "#fff", fontWeight: "bold", marginLeft: 4 },

  postCard: {
    backgroundColor: CARD,
    borderRadius: 15,
    padding: 14,
    marginBottom: 14,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
  },
  postHeader: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  avatar: { width: 40, height: 40, borderRadius: 20, marginRight: 10 },
  userName: { fontSize: 15, fontWeight: "bold", color: TEXT },
  timestamp: { fontSize: 12, color: MUTED, marginTop: 1 },
  postText: { fontSize: 15, color: TEXT, lineHeight: 21, marginBottom: 10 },
  postImage: {
    width: "100%",
    height: 240,
    borderRadius: 12,
    marginBottom: 8,
    backgroundColor: "#eee",
  },
  actionsRow: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#eee",
    paddingTop: 8,
    marginTop: 4,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    marginRight: 22,
  },
  actionText: { marginLeft: 6, color: TEXT, fontWeight: "500" },
  metaText: { fontSize: 13, color: MUTED, marginTop: 6 },

  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
    padding: 20,
  },
  modalContent: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 22,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 14,
    textAlign: "center",
  },
  composerInput: {
    minHeight: 90,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 12,
    padding: 12,
    fontSize: 15,
    textAlignVertical: "top",
    marginBottom: 12,
  },
  draftImageWrap: { position: "relative", marginBottom: 12 },
  draftImage: { width: "100%", height: 180, borderRadius: 12 },
  removeImgBtn: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 14,
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  composerActions: { flexDirection: "row", marginBottom: 14 },
  iconBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: "#eef2ff",
    borderRadius: 10,
    marginRight: 10,
  },
  iconBtnText: { marginLeft: 6, color: PRIMARY, fontWeight: "600" },

  modalButtons: { flexDirection: "row", justifyContent: "space-between" },
  modalButton: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    alignItems: "center",
    marginHorizontal: 4,
  },
  cancelButton: { backgroundColor: "#eee" },
  saveButton: { backgroundColor: PRIMARY },
  cancelButtonText: { color: "#666", fontWeight: "bold" },
  saveButtonText: { color: "#fff", fontWeight: "bold" },

  likeRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8 },
  smallAvatar: { width: 36, height: 36, borderRadius: 18, marginRight: 10 },
  tinyAvatar: { width: 28, height: 28, borderRadius: 14, marginRight: 8 },
  likeName: { fontSize: 15, color: TEXT },

  commentsOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  commentsSheet: {
    backgroundColor: "#fff",
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
  emptyText: {
    textAlign: "center",
    color: MUTED,
    marginTop: 30,
    fontSize: 14,
  },
  commentBlock: { marginBottom: 14 },
  commentRow: { flexDirection: "row", alignItems: "flex-start" },
  replyRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginTop: 10,
    marginLeft: 46,
  },
  commentName: { fontWeight: "bold", color: TEXT, fontSize: 14 },
  commentText: { color: TEXT, fontSize: 14, marginTop: 2 },
  commentMetaRow: { flexDirection: "row", alignItems: "center", marginTop: 4 },
  commentMeta: { fontSize: 12, color: MUTED, marginRight: 14 },
  replyLink: { fontSize: 12, color: PRIMARY, fontWeight: "600", marginRight: 14 },

  replyBanner: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#eef2ff",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    marginBottom: 6,
  },
  replyBannerText: { color: PRIMARY, fontSize: 13, fontWeight: "600" },

  commentInputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: "#eee",
  },
  commentInput: {
    flex: 1,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 14,
    marginRight: 8,
  },
  sendBtn: {
    backgroundColor: PRIMARY,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
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
