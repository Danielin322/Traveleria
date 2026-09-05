import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import {
  Comment,
  Post,
  Reply,
  SocialUser,
  addComment,
  createPost,
  deleteComment as deleteCommentApi,
  deletePost as deletePostApi,
  editPostText,
  likePost,
  listPosts,
  unlikePost,
} from "../../services/socialService";
import { apiFetch } from "../../services/apiClient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { formatTripDates } from "../../utils/tripFormat";
import {
  Elevation,
  FontFamily,
  FontSize,
  Radius,
  Spacing,
  ThemeColors,
} from "../../constants/theme";
import { useThemeColors } from "../../contexts/ThemeContext";

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

type DraftImage = { uri: string; mimeType: string; size?: number };
type MyTrip = { id: string; title: string; location: string; date: string };
type DraftTrip = { id: string; title: string; date: string };

export default function SocialScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

  const goToProfile = (userId: string) =>
    router.push({ pathname: "/user-profile", params: { id: userId } });

  // A photo icon rather than a random stock photo for "no avatar set" -- a
  // real-looking placeholder photo reads as someone else's actual picture,
  // which is exactly the confusion it caused.
  const renderAvatar = (uri: string | null, avatarStyle: object, iconSize: number) =>
    uri ? (
      <Image source={{ uri }} style={avatarStyle} />
    ) : (
      <View style={[avatarStyle, styles.avatarPlaceholder]}>
        <Ionicons name="person" size={iconSize} color={colors.textMuted} />
      </View>
    );

  const [posts, setPosts] = useState<Post[]>([]);
  const [myId, setMyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);

  // Create-post modal
  const [composerOpen, setComposerOpen] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [draftImage, setDraftImage] = useState<DraftImage | undefined>(undefined);
  const [draftTrip, setDraftTrip] = useState<DraftTrip | undefined>(undefined);

  // Trip picker, opened from the composer's "Trip" button
  const [tripPickerOpen, setTripPickerOpen] = useState(false);
  const [myTrips, setMyTrips] = useState<MyTrip[]>([]);
  const [loadingMyTrips, setLoadingMyTrips] = useState(false);

  // Edit-post modal (text only — images are immutable)
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [editText, setEditText] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Likes modal
  const [likesModalUsers, setLikesModalUsers] = useState<SocialUser[] | null>(
    null
  );

  // Image preview modal
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // Comments modal. replyTarget.commentId is whatever comment or reply is
  // being replied to directly — the backend has no depth limit, so this
  // works the same whether it points at a top-level comment or a reply.
  const [commentsPostId, setCommentsPostId] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [replyTarget, setReplyTarget] = useState<{
    commentId: string;
    userName: string;
  } | null>(null);
  // Replies are collapsed by default; this tracks which top-level comments
  // have been expanded to show theirs.
  const [expandedComments, setExpandedComments] = useState<Set<string>>(
    new Set()
  );
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

  const activePost = useMemo(
    () => posts.find((p) => p.id === commentsPostId) ?? null,
    [posts, commentsPostId]
  );

  // ---------- Data loading ----------
  const fetchMyId = useCallback(async () => {
    try {
      const response = await apiFetch("/users/me");
      if (response.ok) {
        const data = await response.json();
        setMyId(data.id ?? null);
      }
    } catch {
      // Non-fatal: "is this mine" checks just won't match until this loads.
    }
  }, []);

  const refreshPosts = useCallback(async () => {
    const feed = await listPosts();
    setPosts(feed);
  }, []);

  const loadAll = useCallback(async () => {
    try {
      setError(null);
      await Promise.all([fetchMyId(), refreshPosts()]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load the social feed."
      );
    } finally {
      setLoading(false);
    }
  }, [fetchMyId, refreshPosts]);

  useFocusEffect(
    useCallback(() => {
      loadAll();
    }, [loadAll])
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  };

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
    const asset = !result.canceled ? result.assets?.[0] : undefined;
    if (asset?.uri) {
      setDraftTrip(undefined);
      setDraftImage({
        uri: asset.uri,
        mimeType: asset.mimeType || "image/jpeg",
        size: asset.fileSize,
      });
    }
  };

  const openTripPicker = async () => {
    setTripPickerOpen(true);
    setLoadingMyTrips(true);
    try {
      const response = await apiFetch("/trips");
      setMyTrips(await response.json());
    } catch {
      setMyTrips([]);
    } finally {
      setLoadingMyTrips(false);
    }
  };

  const selectTripToShare = (trip: MyTrip) => {
    setDraftImage(undefined);
    setDraftTrip({ id: trip.id, title: trip.title, date: trip.date });
    setTripPickerOpen(false);
  };

  const submitPost = async () => {
    if (!draftText.trim() && !draftImage && !draftTrip) {
      Alert.alert("Empty post", "Add some text, a photo, or a trip first.");
      return;
    }
    setPosting(true);
    try {
      await createPost({
        text: draftText.trim() || undefined,
        image: draftImage,
        sharedTripId: draftTrip?.id,
      });
      setDraftText("");
      setDraftImage(undefined);
      setDraftTrip(undefined);
      setComposerOpen(false);
      await refreshPosts();
    } catch (err) {
      Alert.alert(
        "Could not post",
        err instanceof Error ? err.message : "Please try again."
      );
    } finally {
      setPosting(false);
    }
  };

  const openEditPost = (post: Post) => {
    setEditingPost(post);
    setEditText(post.text ?? "");
  };

  const submitEditPost = async () => {
    if (!editingPost || !editText.trim()) return;
    setSavingEdit(true);
    try {
      await editPostText(editingPost.id, editText.trim());
      setEditingPost(null);
      await refreshPosts();
    } catch (err) {
      Alert.alert(
        "Could not update post",
        err instanceof Error ? err.message : "Please try again."
      );
    } finally {
      setSavingEdit(false);
    }
  };

  const confirmDeletePost = (postId: string) => {
    Alert.alert("Delete post?", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deletePostApi(postId);
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

  // ---------- Likes ----------
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

  // ---------- Comments / Replies ----------
  const submitComment = async () => {
    if (!commentsPostId || !commentDraft.trim()) return;
    const text = commentDraft.trim();
    const parentCommentId = replyTarget?.commentId;
    setCommentDraft("");
    setReplyTarget(null);
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

  // ---------- Render ----------
  const renderPost = ({ item }: { item: Post }) => {
    const liked = item.likes.some((u) => u.id === myId);
    const isMine = item.user.id === myId;
    const commentCount =
      item.comments.length +
      item.comments.reduce((sum, c) => sum + c.replies.length, 0);

    return (
      <View style={styles.postCard}>
        <View style={styles.postHeader}>
          <TouchableOpacity
            style={styles.postHeaderTappable}
            onPress={() => goToProfile(item.user.id)}
          >
            {renderAvatar(item.user.avatar, styles.avatar, 22)}
            <View style={{ flex: 1 }}>
              <Text style={styles.userName}>{item.user.name}</Text>
              <Text style={styles.timestamp}>{timeAgo(item.createdAt)}</Text>
            </View>
          </TouchableOpacity>
          {isMine && !item.imageUri && (
            <TouchableOpacity
              onPress={() => openEditPost(item)}
              style={{ marginRight: 14 }}
            >
              <Ionicons name="pencil-outline" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          )}
          {isMine && (
            <TouchableOpacity onPress={() => confirmDeletePost(item.id)}>
              <Ionicons name="trash-outline" size={20} color={colors.danger} />
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
        {item.sharedTrip ? (
          <TouchableOpacity
            style={styles.tripCard}
            activeOpacity={0.8}
            onPress={() =>
              router.push({
                pathname: "/shared-trip-view",
                params: { id: item.sharedTrip!.id },
              })
            }
          >
            <View style={styles.tripCardIcon}>
              <Ionicons name="airplane" size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.tripCardTitle}>{item.sharedTrip.title}</Text>
              <Text style={styles.tripCardMeta}>
                {formatTripDates(item.sharedTrip.date)} ·{" "}
                {item.sharedTrip.eventsCount}{" "}
                {item.sharedTrip.eventsCount === 1 ? "stop" : "stops"}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        ) : null}

        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => toggleLike(item)}
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
            onPress={() => setCommentsPostId(item.id)}
          >
            <Ionicons name="chatbubble-outline" size={20} color={colors.textPrimary} />
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

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={loadAll}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>Social</Text>
          <Text style={styles.subtitle}>Share your travel moments.</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.findPeopleBtn}
            onPress={() => router.push("/find-people")}
            accessibilityRole="button"
            accessibilityLabel="Find people"
          >
            <Ionicons name="people-outline" size={22} color={colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.newBtn}
            onPress={() => setComposerOpen(true)}
          >
            <Ionicons name="add" size={22} color={colors.primaryContrast} />
            <Text style={styles.newBtnText}>Post</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={posts}
        renderItem={renderPost}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ paddingBottom: 30 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.welcomeState}>
            <Ionicons name="airplane-outline" size={56} color={colors.primary} />
            <Text style={styles.welcomeTitle}>Welcome to Traveleria Social</Text>
            <Text style={styles.welcomeSubtitle}>
              Follow other travelers to see their trips and photos here, or
              share your own adventure to get started.
            </Text>
            <TouchableOpacity
              style={styles.welcomePrimaryBtn}
              onPress={() => setComposerOpen(true)}
            >
              <Ionicons name="add" size={20} color={colors.primaryContrast} />
              <Text style={styles.welcomePrimaryBtnText}>Create a Post</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.welcomeSecondaryBtn}
              onPress={() => router.push("/find-people")}
            >
              <Ionicons name="people-outline" size={20} color={colors.primary} />
              <Text style={styles.welcomeSecondaryBtnText}>
                Find People to Follow
              </Text>
            </TouchableOpacity>
          </View>
        }
      />

      {/* ---------- Composer Modal (also hosts the trip picker as a second view, never a second stacked Modal) ---------- */}
      <Modal
        visible={composerOpen}
        animationType="slide"
        transparent
        onRequestClose={() => {
          if (tripPickerOpen) {
            setTripPickerOpen(false);
          } else {
            setComposerOpen(false);
            setDraftText("");
            setDraftImage(undefined);
            setDraftTrip(undefined);
          }
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            {tripPickerOpen ? (
              <>
                <View style={styles.commentsHeader}>
                  <TouchableOpacity
                    onPress={() => setTripPickerOpen(false)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons name="chevron-back" size={24} color={colors.primary} />
                  </TouchableOpacity>
                  <Text style={styles.modalTitle}>Select a Trip</Text>
                  <View style={{ width: 24 }} />
                </View>
                {loadingMyTrips ? (
                  <ActivityIndicator
                    size="large"
                    color={colors.primary}
                    style={{ marginVertical: 30 }}
                  />
                ) : (
                  <ScrollView style={{ minHeight: 200, maxHeight: 340 }}>
                    {myTrips.length === 0 && (
                      <Text style={styles.emptyText}>
                        You don't have any trips yet.
                      </Text>
                    )}
                    {myTrips.map((trip) => (
                      <TouchableOpacity
                        key={trip.id}
                        style={styles.tripPickerRow}
                        onPress={() => selectTripToShare(trip)}
                      >
                        <Ionicons
                          name="airplane-outline"
                          size={20}
                          color={colors.primary}
                        />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                          <Text style={styles.tripCardTitle}>{trip.title}</Text>
                          <Text style={styles.tripCardMeta}>
                            {formatTripDates(trip.date)}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}
              </>
            ) : (
              <>
                <Text style={styles.modalTitle}>New Post</Text>
                <TextInput
                  style={styles.composerInput}
                  placeholder="Share an experience..."
                  placeholderTextColor={colors.textDisabled}
                  value={draftText}
                  onChangeText={setDraftText}
                  multiline
                />
                {draftImage && (
                  <View style={styles.draftImageWrap}>
                    <Image
                      source={{ uri: draftImage.uri }}
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
                {draftTrip && (
                  <View style={styles.draftTripChip}>
                    <Ionicons name="airplane" size={18} color={colors.primary} />
                    <View style={{ flex: 1, marginLeft: 8 }}>
                      <Text style={styles.draftTripTitle}>{draftTrip.title}</Text>
                      <Text style={styles.draftTripDate}>
                        {formatTripDates(draftTrip.date)}
                      </Text>
                    </View>
                    <TouchableOpacity onPress={() => setDraftTrip(undefined)}>
                      <Ionicons name="close" size={18} color={colors.textMuted} />
                    </TouchableOpacity>
                  </View>
                )}

                <View style={styles.composerActions}>
                  <TouchableOpacity
                    style={styles.iconBtn}
                    onPress={() => pickImage(false)}
                  >
                    <Ionicons name="image-outline" size={22} color={colors.primary} />
                    <Text style={styles.iconBtnText}>Gallery</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.iconBtn}
                    onPress={() => pickImage(true)}
                  >
                    <Ionicons name="camera-outline" size={22} color={colors.primary} />
                    <Text style={styles.iconBtnText}>Camera</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.iconBtn} onPress={openTripPicker}>
                    <Ionicons name="airplane-outline" size={22} color={colors.primary} />
                    <Text style={styles.iconBtnText}>Trip</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.modalButtons}>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.cancelButton]}
                    onPress={() => {
                      setComposerOpen(false);
                      setDraftText("");
                      setDraftImage(undefined);
                      setDraftTrip(undefined);
                      setTripPickerOpen(false);
                    }}
                    disabled={posting}
                  >
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.modalButton,
                      styles.saveButton,
                      posting && { opacity: 0.6 },
                    ]}
                    onPress={submitPost}
                    disabled={posting}
                  >
                {posting ? (
                  <ActivityIndicator size="small" color={colors.surface} />
                ) : (
                  <Text style={styles.saveButtonText}>Post</Text>
                )}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ---------- Edit Post Modal ---------- */}
      <Modal
        visible={!!editingPost}
        animationType="slide"
        transparent
        onRequestClose={() => setEditingPost(null)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Edit Post</Text>
            <TextInput
              style={styles.composerInput}
              placeholder="Share an experience..."
              placeholderTextColor={colors.textDisabled}
              value={editText}
              onChangeText={setEditText}
              multiline
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => setEditingPost(null)}
                disabled={savingEdit}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalButton,
                  styles.saveButton,
                  savingEdit && { opacity: 0.6 },
                ]}
                onPress={submitEditPost}
                disabled={savingEdit}
              >
                {savingEdit ? (
                  <ActivityIndicator size="small" color={colors.surface} />
                ) : (
                  <Text style={styles.saveButtonText}>Save</Text>
                )}
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
              {likesModalUsers?.map((u) => (
                <TouchableOpacity
                  key={u.id}
                  style={styles.likeRow}
                  onPress={() => {
                    setLikesModalUsers(null);
                    goToProfile(u.id);
                  }}
                >
                  {renderAvatar(u.avatar, styles.smallAvatar, 18)}
                  <Text style={styles.likeName}>{u.name}</Text>
                </TouchableOpacity>
              ))}
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
          setExpandedComments(new Set());
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.commentsOverlay}
        >
          <View
            style={[
              styles.commentsSheet,
              // The system nav bar / gesture strip on Android sits under
              // this sheet's fixed paddingBottom, which is why the send
              // button was getting covered. insets.bottom is the actual
              // reserved height on this specific device.
              { paddingBottom: 36 + insets.bottom },
            ]}
          >
            <View style={styles.commentsHeader}>
              <Text style={styles.modalTitle}>Comments</Text>
              <TouchableOpacity
                onPress={() => {
                  setCommentsPostId(null);
                  setReplyTarget(null);
                  setCommentDraft("");
                }}
              >
                <Ionicons name="close" size={26} color={colors.danger} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ flex: 1 }}>
              {activePost?.comments.length === 0 && (
                <Text style={styles.emptyText}>
                  No comments yet. Be the first!
                </Text>
              )}
              {activePost?.comments.map((c: Comment) => (
                <View key={c.id} style={styles.commentBlock}>
                  <View style={styles.commentRow}>
                    <TouchableOpacity onPress={() => goToProfile(c.user.id)}>
                      {renderAvatar(c.user.avatar, styles.smallAvatar, 18)}
                    </TouchableOpacity>
                    <View style={{ flex: 1 }}>
                      <TouchableOpacity onPress={() => goToProfile(c.user.id)}>
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
                          <TouchableOpacity onPress={() => removeComment(c.id)}>
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
                        {expandedComments.has(c.id)
                          ? "Hide replies"
                          : `View ${c.replies.length} ${
                              c.replies.length === 1 ? "reply" : "replies"
                            }`}
                      </Text>
                    </TouchableOpacity>
                  )}

                  {expandedComments.has(c.id) && c.replies.map((r: Reply) => (
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
                      <TouchableOpacity onPress={() => goToProfile(r.user.id)}>
                        {renderAvatar(r.user.avatar, styles.tinyAvatar, 14)}
                      </TouchableOpacity>
                      <View style={{ flex: 1 }}>
                        <TouchableOpacity onPress={() => goToProfile(r.user.id)}>
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
                              onPress={() => removeComment(r.id)}
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
                placeholder={
                  replyTarget ? "Write a reply..." : "Add a comment..."
                }
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
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: 20, paddingTop: 60 },
  centered: { justifyContent: "center", alignItems: "center" },
  errorBanner: {
    backgroundColor: colors.dangerSoft,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: Radius.sm,
    marginBottom: 12,
  },
  errorBannerText: {
    color: colors.danger,
    fontSize: FontSize.caption,
    fontFamily: FontFamily.regular,
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
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 18,
  },
  title: { fontSize: 30, fontWeight: "bold", color: colors.textPrimary },
  subtitle: { fontSize: 14, color: colors.textMuted, marginTop: 2 },
  headerActions: { flexDirection: "row", alignItems: "center" },
  findPeopleBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
    backgroundColor: colors.primarySoft,
  },
  newBtn: {
    backgroundColor: colors.primary,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
  },
  newBtnText: { color: colors.surface, fontWeight: "bold", marginLeft: 4 },

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
  avatarPlaceholder: {
    backgroundColor: colors.surfaceSunken,
    alignItems: "center",
    justifyContent: "center",
  },
  userName: { fontSize: 15, fontWeight: "bold", color: colors.textPrimary },
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
  tripCardTitle: { fontSize: 14, fontWeight: "bold", color: colors.textPrimary },
  tripCardMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  draftTripChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceSunken,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  draftTripTitle: { fontSize: 14, fontWeight: "bold", color: colors.textPrimary },
  draftTripDate: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  tripPickerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  actionsRow: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 8,
    marginTop: 4,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    marginRight: 22,
  },
  actionText: { marginLeft: 6, color: colors.textPrimary, fontWeight: "500" },
  metaText: { fontSize: 13, color: colors.textMuted, marginTop: 6 },

  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
    padding: 20,
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 22,
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
  composerInput: {
    minHeight: 90,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    fontSize: 15,
    textAlignVertical: "top",
    marginBottom: 12,
    // Without an explicit colour a TextInput renders black in both themes.
    color: colors.textPrimary,
    backgroundColor: colors.surfaceSunken,
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
    backgroundColor: colors.primarySoft,
    borderRadius: 10,
    marginRight: 10,
  },
  iconBtnText: { marginLeft: 6, color: colors.primary, fontWeight: "600" },

  modalButtons: { flexDirection: "row", justifyContent: "space-between" },
  modalButton: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    alignItems: "center",
    marginHorizontal: 4,
  },
  cancelButton: { backgroundColor: colors.border },
  saveButton: { backgroundColor: colors.primary },
  cancelButtonText: { color: colors.textSecondary, fontWeight: "bold" },
  saveButtonText: { color: colors.surface, fontWeight: "bold" },

  likeRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8 },
  smallAvatar: { width: 36, height: 36, borderRadius: 18, marginRight: 10 },
  tinyAvatar: { width: 28, height: 28, borderRadius: 14, marginRight: 8 },
  likeName: { fontSize: 15, color: colors.textPrimary },

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
  emptyText: {
    textAlign: "center",
    color: colors.textMuted,
    marginTop: 30,
    fontSize: 14,
  },
  welcomeState: {
    alignItems: "center",
    paddingTop: 60,
    paddingHorizontal: 30,
  },
  welcomeTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: colors.textPrimary,
    marginTop: 16,
    textAlign: "center",
  },
  welcomeSubtitle: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: 8,
    lineHeight: 20,
  },
  welcomePrimaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    marginTop: 24,
  },
  welcomePrimaryBtnText: {
    color: colors.primaryContrast,
    fontWeight: "bold",
    marginLeft: 8,
    fontSize: 15,
  },
  welcomeSecondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  welcomeSecondaryBtnText: {
    color: colors.primary,
    fontWeight: "bold",
    marginLeft: 8,
    fontSize: 15,
  },
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
  viewRepliesText: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: "600",
  },
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
  replyLink: { fontSize: 12, color: colors.primary, fontWeight: "600", marginRight: 14 },

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
