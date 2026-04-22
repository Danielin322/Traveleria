import { Ionicons } from "@expo/vector-icons";
import { getCurrentUser } from "aws-amplify/auth";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Image,
  ImageBackground,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { WebView } from "react-native-webview";
import { API_URL } from "../../constants/api";

const APPLE_COLORS = [
  "#000000", "#FF3B30", "#FF9500", "#34C759", "#007AFF", "#5856D6",
];

const DOC_TYPES = ["Passport", "Flight Ticket", "Hotel", "Insurance", "Other"];
const FILTERS = ["All", "Images", "PDFs", "Other"];

const getFileIcon = (mimeType: string): any => {
  if (mimeType?.includes("image")) return "image-outline";
  if (mimeType?.includes("pdf")) return "document-text-outline";
  return "document-outline";
};

const getFileTypeLabel = (mimeType: string): string => {
  if (mimeType?.includes("image")) return "IMAGE";
  if (mimeType?.includes("pdf")) return "PDF";
  return "FILE";
};

// --- Individual card with its own flip animation ---
const DocumentCard = ({
  item,
  index,
  onPress,
  onOptions,
}: {
  item: any;
  index: number;
  onPress: (item: any) => void;
  onOptions: (item: any) => void;
}) => {
  const flipAnim = useRef(new Animated.Value(1)).current;
  const isImage = item.mimeType?.includes("image");

  const handlePress = () => {
    Animated.sequence([
      Animated.timing(flipAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(flipAnim, { toValue: 1, duration: 150, useNativeDriver: true }),
    ]).start(() => onPress(item));
  };

  return (
    <Animated.View style={[styles.cardWrapper, { marginTop: index === 0 ? 0 : -100, transform: [{ scaleX: flipAnim }] }]}>
      <TouchableOpacity activeOpacity={0.9} onPress={handlePress}>
        {isImage ? (
          <ImageBackground
            source={{ uri: item.url }}
            style={[styles.card, { backgroundColor: item.color }]}
            imageStyle={{ borderRadius: 15 }}
          >
            <View style={styles.imageOverlay} />
            <View style={styles.cardContent}>
              <View style={styles.cardTagsRow}>
                {item.docType && <View style={styles.docTypeBadge}><Text style={styles.docTypeBadgeText}>{item.docType}</Text></View>}
                <View style={styles.fileTypeBadge}><Text style={styles.fileTypeBadgeText}>IMAGE</Text></View>
              </View>
              <View style={styles.cardHeader}>
                <Ionicons name="image-outline" size={18} color="rgba(255,255,255,0.85)" style={{ marginRight: 8 }} />
                <Text style={styles.cardTopTitle} numberOfLines={1}>{item.title}</Text>
                <TouchableOpacity style={styles.optionsButton} onPress={() => onOptions(item)}>
                  <Ionicons name="ellipsis-horizontal" size={24} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>
          </ImageBackground>
        ) : (
          <View style={[styles.card, { backgroundColor: item.color }]}>
            <View style={styles.cardBgIcon}>
              <Ionicons name={getFileIcon(item.mimeType)} size={110} color="rgba(255,255,255,0.12)" />
            </View>
            <View style={styles.cardContent}>
              <View style={styles.cardTagsRow}>
                {item.docType && <View style={styles.docTypeBadge}><Text style={styles.docTypeBadgeText}>{item.docType}</Text></View>}
                <View style={styles.fileTypeBadge}><Text style={styles.fileTypeBadgeText}>{getFileTypeLabel(item.mimeType)}</Text></View>
              </View>
              <View style={styles.cardHeader}>
                <Ionicons name={getFileIcon(item.mimeType)} size={18} color="rgba(255,255,255,0.85)" style={{ marginRight: 8 }} />
                <Text style={styles.cardTopTitle} numberOfLines={1}>{item.title}</Text>
                <TouchableOpacity style={styles.optionsButton} onPress={() => onOptions(item)}>
                  <Ionicons name="ellipsis-horizontal" size={24} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
};

// --- Main Screen ---
export default function WalletScreen() {
  const [documents, setDocuments] = useState<any[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const [activeFilter, setActiveFilter] = useState("All");

  const [isAddModalVisible, setAddModalVisible] = useState(false);
  const [modalStep, setModalStep] = useState<"form" | "source">("form");
  const [newDocTitle, setNewDocTitle] = useState("");
  const [newDocColor, setNewDocColor] = useState(APPLE_COLORS[0]);
  const [newDocType, setNewDocType] = useState(DOC_TYPES[0]);

  const [selectedDoc, setSelectedDoc] = useState<any>(null);
  const [isEditModalVisible, setEditModalVisible] = useState(false);
  const [editingDoc, setEditingDoc] = useState<any>(null);
  const [editDocTitle, setEditDocTitle] = useState("");
  const [editDocColor, setEditDocColor] = useState(APPLE_COLORS[0]);

  const filteredDocuments = documents
    .filter((doc) => {
      if (activeFilter === "All") return true;
      if (activeFilter === "Images") return doc.mimeType?.includes("image");
      if (activeFilter === "PDFs") return doc.mimeType?.includes("pdf");
      return !doc.mimeType?.includes("image") && !doc.mimeType?.includes("pdf");
    })
    .sort((a, b) => a.title.localeCompare(b.title));

  const getUserId = async (): Promise<string> => {
    const { userId } = await getCurrentUser();
    return userId;
  };

  const fetchDocuments = async () => {
    try {
      const userId = await getUserId();
      const response = await fetch(`${API_URL}/wallet/documents?user_id=${userId}`);
      const data = await response.json();
      setDocuments(data);
    } catch (error) {
      console.error("Error fetching documents:", error);
    } finally {
      setLoadingDocs(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, []);

  const updateProgress = (progress: number) => {
    setUploadProgress(progress);
    Animated.timing(progressAnim, {
      toValue: progress,
      duration: 100,
      useNativeDriver: false,
    }).start();
  };

  const uploadWithProgress = (formData: FormData): Promise<any> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_URL}/wallet/upload`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) updateProgress(e.loaded / e.total);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText));
        } else {
          reject(new Error("Upload failed"));
        }
      };
      xhr.onerror = () => reject(new Error("Network error"));
      xhr.send(formData);
    });
  };

  const uploadAsset = async (uri: string, name: string, mimeType: string) => {
    setUploading(true);
    updateProgress(0);
    try {
      const userId = await getUserId();
      const formData = new FormData();
      formData.append("file", { uri, name, type: mimeType } as any);
      formData.append("title", newDocTitle);
      formData.append("color", newDocColor);
      formData.append("user_id", userId);
      formData.append("doc_type", newDocType);
      const newDoc = await uploadWithProgress(formData);
      setDocuments((prev) => [newDoc, ...prev]);
    } catch (error) {
      console.error("Upload error:", error);
      alert("Upload failed. Check your connection.");
    } finally {
      setUploading(false);
      setUploadProgress(0);
      progressAnim.setValue(0);
      setNewDocTitle("");
      setNewDocColor(APPLE_COLORS[0]);
      setNewDocType(DOC_TYPES[0]);
    }
  };

  const closeAddModal = () => {
    setAddModalVisible(false);
    setModalStep("form");
    setNewDocTitle("");
    setNewDocColor(APPLE_COLORS[0]);
    setNewDocType(DOC_TYPES[0]);
  };

  const handlePickFromFiles = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: "*/*" });
    if (result.canceled) return;
    const asset = result.assets[0];
    setAddModalVisible(false);
    setModalStep("form");
    await uploadAsset(asset.uri, asset.name, asset.mimeType || "application/octet-stream");
  };

  const handlePickFromGallery = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { alert("Gallery permission is required."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    const name = asset.uri.split("/").pop() || "photo.jpg";
    setAddModalVisible(false);
    setModalStep("form");
    await uploadAsset(asset.uri, name, asset.mimeType || "image/jpeg");
  };

  const openEditMenu = (doc: any) => {
    setEditingDoc(doc);
    setEditDocTitle(doc.title);
    setEditDocColor(doc.color);
    setEditModalVisible(true);
  };

  const handleSaveEdit = async () => {
    if (!editDocTitle.trim()) { alert("Please enter a document name"); return; }
    try {
      const userId = await getUserId();
      const formData = new FormData();
      formData.append("user_id", userId);
      formData.append("title", editDocTitle);
      formData.append("color", editDocColor);
      await fetch(`${API_URL}/wallet/documents/${encodeURIComponent(editingDoc.id)}`, {
        method: "PATCH",
        body: formData,
      });
      setDocuments(documents.map((doc) =>
        doc.id === editingDoc.id ? { ...doc, title: editDocTitle, color: editDocColor } : doc
      ));
    } catch (error) {
      console.error("Update error:", error);
      alert("Failed to save changes.");
    }
    setEditModalVisible(false);
    setEditingDoc(null);
  };

  const handleDelete = async () => {
    try {
      const userId = await getUserId();
      await fetch(`${API_URL}/wallet/documents/${encodeURIComponent(editingDoc.id)}?user_id=${userId}`, { method: "DELETE" });
      setDocuments(documents.filter((doc) => doc.id !== editingDoc.id));
    } catch (error) {
      console.error("Delete error:", error);
      alert("Failed to delete document.");
    } finally {
      setEditModalVisible(false);
      setEditingDoc(null);
    }
  };

  const progressBarWidth = progressAnim.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] });

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Wallet</Text>
        <TouchableOpacity onPress={() => setAddModalVisible(true)} style={styles.addButton}>
          <Ionicons name="add" size={30} color="#2f6deb" />
        </TouchableOpacity>
      </View>

      {/* Upload Progress */}
      {uploading && (
        <View style={styles.progressContainer}>
          <View style={styles.progressHeader}>
            <ActivityIndicator color="#0a84ff" size="small" />
            <Text style={styles.uploadingText}>Uploading to secure storage...</Text>
            <Text style={styles.progressPercent}>{Math.round(uploadProgress * 100)}%</Text>
          </View>
          <View style={styles.progressBarBg}>
            <Animated.View style={[styles.progressBarFill, { width: progressBarWidth }]} />
          </View>
        </View>
      )}

      {/* Filter Bar */}
      <View style={styles.filterBarWrapper}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterBarContent}>
          {FILTERS.map((filter) => (
            <TouchableOpacity
              key={filter}
              style={[styles.filterChip, activeFilter === filter && styles.filterChipActive]}
              onPress={() => setActiveFilter(filter)}
            >
              <Text style={[styles.filterChipText, activeFilter === filter && styles.filterChipTextActive]}>{filter}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Document List */}
      {loadingDocs ? (
        <ActivityIndicator color="#fff" size="large" style={{ marginTop: 60 }} />
      ) : (
        <FlatList
          data={filteredDocuments}
          renderItem={({ item, index }) => (
            <DocumentCard item={item} index={index} onPress={setSelectedDoc} onOptions={openEditMenu} />
          )}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <View style={styles.emptyIconCircle}>
                <Ionicons name="wallet-outline" size={48} color="#555" />
              </View>
              <Text style={styles.emptyTitle}>Your wallet is empty</Text>
              <Text style={styles.emptySubText}>
                Keep your travel documents safe in one place.{"\n"}Tap + to add your first document.
              </Text>
            </View>
          }
        />
      )}

      {/* Add Document Modal — single modal, two steps */}
      <Modal visible={isAddModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {modalStep === "form" ? (
              <>
                <Text style={styles.modalTitle}>New Document</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Document Name..."
                  placeholderTextColor="#888"
                  value={newDocTitle}
                  onChangeText={setNewDocTitle}
                />
                <Text style={styles.colorLabel}>Document Type:</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
                  {DOC_TYPES.map((type) => (
                    <TouchableOpacity
                      key={type}
                      style={[styles.typeChip, newDocType === type && styles.typeChipActive]}
                      onPress={() => setNewDocType(type)}
                    >
                      <Text style={[styles.typeChipText, newDocType === type && styles.typeChipTextActive]}>{type}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <Text style={styles.colorLabel}>Label Color:</Text>
                <View style={styles.colorPicker}>
                  {APPLE_COLORS.map((color) => (
                    <TouchableOpacity
                      key={color}
                      style={[styles.colorCircle, { backgroundColor: color }, newDocColor === color && styles.selectedColorCircle]}
                      onPress={() => setNewDocColor(color)}
                    />
                  ))}
                </View>
                <View style={styles.modalButtons}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={closeAddModal}>
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.createBtn}
                    onPress={() => {
                      if (!newDocTitle.trim()) { alert("Please enter a document name"); return; }
                      setModalStep("source");
                    }}
                  >
                    <Text style={styles.createBtnText}>Create</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.modalTitle}>Choose Source</Text>
                <TouchableOpacity style={styles.sourceBtn} onPress={handlePickFromGallery}>
                  <Ionicons name="image-outline" size={26} color="#0a84ff" />
                  <View style={styles.sourceBtnText}>
                    <Text style={styles.sourceBtnTitle}>Photo Gallery</Text>
                    <Text style={styles.sourceBtnSub}>Pick an image from your photos</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color="#555" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.sourceBtn} onPress={handlePickFromFiles}>
                  <Ionicons name="folder-outline" size={26} color="#5856D6" />
                  <View style={styles.sourceBtnText}>
                    <Text style={styles.sourceBtnTitle}>Files</Text>
                    <Text style={styles.sourceBtnSub}>Pick a PDF or document from Files</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color="#555" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.backBtn} onPress={() => setModalStep("form")}>
                  <Text style={styles.cancelBtnText}>Back</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Edit Document Modal */}
      <Modal visible={isEditModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Edit Document</Text>
            <TextInput
              style={styles.input}
              placeholder="Document Name..."
              placeholderTextColor="#888"
              value={editDocTitle}
              onChangeText={setEditDocTitle}
            />
            <Text style={styles.colorLabel}>Change Label Color:</Text>
            <View style={styles.colorPicker}>
              {APPLE_COLORS.map((color) => (
                <TouchableOpacity
                  key={color}
                  style={[styles.colorCircle, { backgroundColor: color }, editDocColor === color && styles.selectedColorCircle]}
                  onPress={() => setEditDocColor(color)}
                />
              ))}
            </View>
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditModalVisible(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.createBtn} onPress={handleSaveEdit}>
                <Text style={styles.createBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.deleteBtnFull} onPress={handleDelete}>
              <Ionicons name="trash-outline" size={20} color="#ff453a" style={{ marginRight: 8 }} />
              <Text style={styles.deleteBtnFullText}>Delete Document</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Document Viewer Modal */}
      <Modal visible={!!selectedDoc} transparent animationType="fade">
        <View style={styles.viewModalOverlay}>
          <View style={styles.viewModalHeader}>
            <View>
              <Text style={styles.viewModalTitle}>{selectedDoc?.title}</Text>
              {selectedDoc?.docType && (
                <Text style={styles.viewModalSubtitle}>{selectedDoc.docType}</Text>
              )}
            </View>
            <TouchableOpacity onPress={() => setSelectedDoc(null)}>
              <Ionicons name="close-circle" size={36} color="#fff" />
            </TouchableOpacity>
          </View>
          <View style={styles.documentContainer}>
            {selectedDoc?.mimeType?.includes("image") ? (
              <Image source={{ uri: selectedDoc.url }} style={styles.fullDocImage} resizeMode="contain" />
            ) : (
              <WebView source={{ uri: selectedDoc?.url }} style={styles.webview} originWhitelist={["*"]} />
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 60,
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  headerTitle: { fontSize: 34, fontWeight: "bold", color: "#fff" },
  addButton: { backgroundColor: "#1c1c1e", borderRadius: 20, padding: 5 },

  // Progress bar
  progressContainer: {
    marginHorizontal: 20,
    marginBottom: 12,
    backgroundColor: "#1c1c1e",
    borderRadius: 12,
    padding: 14,
  },
  progressHeader: { flexDirection: "row", alignItems: "center", marginBottom: 10, gap: 8 },
  uploadingText: { color: "#fff", fontWeight: "600", fontSize: 13, flex: 1 },
  progressPercent: { color: "#0a84ff", fontWeight: "bold", fontSize: 13 },
  progressBarBg: { height: 6, backgroundColor: "#3a3a3c", borderRadius: 3, overflow: "hidden" },
  progressBarFill: { height: "100%", backgroundColor: "#0a84ff", borderRadius: 3 },

  // Filter bar
  filterBarWrapper: {
    backgroundColor: "#000",
    paddingVertical: 6,
    marginBottom: 16,
    zIndex: 1,
  },
  filterBarContent: { paddingHorizontal: 20, gap: 8 },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: "#1c1c1e",
    borderWidth: 1,
    borderColor: "#3a3a3c",
  },
  filterChipActive: { backgroundColor: "#0a84ff", borderColor: "#0a84ff" },
  filterChipText: { color: "#aaa", fontSize: 14, fontWeight: "600" },
  filterChipTextActive: { color: "#fff" },

  // List
  listContent: { paddingHorizontal: 20, paddingBottom: 120 },

  // Card
  cardWrapper: { width: "100%" },
  card: {
    height: 200,
    width: "100%",
    borderRadius: 15,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 5,
    overflow: "hidden",
  },
  imageOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: 15,
  },
  cardBgIcon: {
    position: "absolute",
    right: -10,
    bottom: -10,
    opacity: 1,
  },
  cardContent: { flex: 1, padding: 20, justifyContent: "flex-start", gap: 10 },
  cardTagsRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardHeader: { flexDirection: "row", alignItems: "center" },
  cardTopTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1.5,
    flex: 1,
  },
  optionsButton: { padding: 5 },
  cardFooter: { flexDirection: "row", alignItems: "center", gap: 8 },
  docTypeBadge: {
    backgroundColor: "rgba(255,255,255,0.25)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  docTypeBadgeText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  fileTypeBadge: {
    backgroundColor: "rgba(0,0,0,0.3)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  fileTypeBadgeText: { color: "rgba(255,255,255,0.8)", fontSize: 11, fontWeight: "700" },

  // Empty state
  emptyState: { alignItems: "center", marginTop: 80 },
  emptyIconCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "#1c1c1e",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  emptyTitle: { color: "#fff", fontSize: 20, fontWeight: "bold", marginBottom: 8 },
  emptySubText: { color: "#666", fontSize: 14, textAlign: "center", lineHeight: 22 },

  // Modals
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center" },
  modalContent: { width: "88%", backgroundColor: "#1c1c1e", borderRadius: 20, padding: 25, alignItems: "center" },
  modalTitle: { color: "#fff", fontSize: 22, fontWeight: "bold", marginBottom: 20 },
  input: {
    width: "100%",
    backgroundColor: "#2c2c2e",
    color: "#fff",
    padding: 15,
    borderRadius: 10,
    fontSize: 16,
    marginBottom: 16,
  },
  colorLabel: { color: "#aaa", alignSelf: "flex-start", marginBottom: 10, fontSize: 13, fontWeight: "600" },
  typeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#2c2c2e",
    marginRight: 8,
    borderWidth: 1,
    borderColor: "#3a3a3c",
  },
  typeChipActive: { backgroundColor: "#0a84ff", borderColor: "#0a84ff" },
  typeChipText: { color: "#aaa", fontSize: 13, fontWeight: "600" },
  typeChipTextActive: { color: "#fff" },
  colorPicker: { flexDirection: "row", justifyContent: "space-between", width: "100%", marginBottom: 24 },
  colorCircle: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: "transparent" },
  selectedColorCircle: { borderColor: "#fff" },
  modalButtons: { flexDirection: "row", justifyContent: "space-between", width: "100%" },
  cancelBtn: { flex: 1, padding: 15, alignItems: "center", borderRadius: 10, backgroundColor: "#3a3a3c", marginRight: 10 },
  backBtn: { marginTop: 8, width: "100%", padding: 15, alignItems: "center", borderRadius: 10, backgroundColor: "rgba(255,69,58,0.15)" },
  cancelBtnText: { color: "#ff453a", fontSize: 16, fontWeight: "bold" },
  createBtn: { flex: 1, padding: 15, alignItems: "center", borderRadius: 10, backgroundColor: "#0a84ff", marginLeft: 10 },
  sourceBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#2c2c2e",
    borderRadius: 14,
    padding: 16,
    width: "100%",
    marginBottom: 10,
    gap: 14,
  },
  sourceBtnText: { flex: 1 },
  sourceBtnTitle: { color: "#fff", fontSize: 16, fontWeight: "700" },
  sourceBtnSub: { color: "#888", fontSize: 12, marginTop: 2 },
  createBtnText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  deleteBtnFull: {
    flexDirection: "row",
    marginTop: 16,
    padding: 15,
    backgroundColor: "rgba(255, 69, 58, 0.15)",
    borderRadius: 10,
    width: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
  deleteBtnFullText: { color: "#ff453a", fontSize: 16, fontWeight: "bold" },

  // Viewer
  viewModalOverlay: { flex: 1, backgroundColor: "#000" },
  viewModalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 20,
    backgroundColor: "#1c1c1e",
  },
  viewModalTitle: { color: "#fff", fontSize: 20, fontWeight: "bold" },
  viewModalSubtitle: { color: "#aaa", fontSize: 13, marginTop: 2 },
  documentContainer: { flex: 1, backgroundColor: "#fff" },
  fullDocImage: { flex: 1, width: "100%", height: "100%" },
  webview: { flex: 1 },
});
