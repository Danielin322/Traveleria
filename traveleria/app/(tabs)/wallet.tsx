import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import React, { useEffect, useState } from "react";
import {
  Animated,
  FlatList,
  Image,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ActivityIndicator,
} from "react-native";
import { WebView } from "react-native-webview";
import { getCurrentUser } from "aws-amplify/auth";
import { API_URL } from "../../constants/api";

const APPLE_COLORS = [
  "#000000",
  "#FF3B30",
  "#FF9500",
  "#34C759",
  "#007AFF",
  "#5856D6",
];

export default function WalletScreen() {
  const [documents, setDocuments] = useState<any[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [uploading, setUploading] = useState(false);

  const [isAddModalVisible, setAddModalVisible] = useState(false);
  const [newDocTitle, setNewDocTitle] = useState("");
  const [newDocColor, setNewDocColor] = useState(APPLE_COLORS[0]);

  const [selectedDoc, setSelectedDoc] = useState<any>(null);

  const [isEditModalVisible, setEditModalVisible] = useState(false);
  const [editingDoc, setEditingDoc] = useState<any>(null);
  const [editDocTitle, setEditDocTitle] = useState("");
  const [editDocColor, setEditDocColor] = useState(APPLE_COLORS[0]);

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

  const handleCreate = async () => {
    if (!newDocTitle.trim()) {
      alert("Please enter a document name");
      return;
    }

    const result = await DocumentPicker.getDocumentAsync({ type: "*/*" });
    if (result.canceled) return;

    const asset = result.assets[0];
    setUploading(true);
    setAddModalVisible(false);

    try {
      const userId = await getUserId();
      const formData = new FormData();
      formData.append("file", {
        uri: asset.uri,
        name: asset.name,
        type: asset.mimeType || "application/octet-stream",
      } as any);
      formData.append("title", newDocTitle);
      formData.append("color", newDocColor);
      formData.append("user_id", userId);

      const response = await fetch(`${API_URL}/wallet/upload`, {
        method: "POST",
        body: formData,
      });

      if (response.ok) {
        const newDoc = await response.json();
        setDocuments((prev) => [newDoc, ...prev]);
      } else {
        alert("Upload failed. Please try again.");
      }
    } catch (error) {
      console.error("Upload error:", error);
      alert("Upload failed. Check your connection.");
    } finally {
      setUploading(false);
      setNewDocTitle("");
      setNewDocColor(APPLE_COLORS[0]);
    }
  };

  const openEditMenu = (doc: any) => {
    setEditingDoc(doc);
    setEditDocTitle(doc.title);
    setEditDocColor(doc.color);
    setEditModalVisible(true);
  };

  const handleSaveEdit = () => {
    if (!editDocTitle.trim()) {
      alert("Please enter a document name");
      return;
    }
    setDocuments(
      documents.map((doc) =>
        doc.id === editingDoc.id
          ? { ...doc, title: editDocTitle, color: editDocColor }
          : doc,
      ),
    );
    setEditModalVisible(false);
    setEditingDoc(null);
  };

  const handleDelete = async () => {
    try {
      const userId = await getUserId();
      await fetch(`${API_URL}/wallet/documents/${encodeURIComponent(editingDoc.id)}?user_id=${userId}`, {
        method: "DELETE",
      });
      setDocuments(documents.filter((doc) => doc.id !== editingDoc.id));
    } catch (error) {
      console.error("Delete error:", error);
      alert("Failed to delete document.");
    } finally {
      setEditModalVisible(false);
      setEditingDoc(null);
    }
  };

  const renderItem = ({ item, index }: any) => (
    <TouchableOpacity activeOpacity={0.9} onPress={() => setSelectedDoc(item)}>
      <Animated.View
        style={[
          styles.card,
          { backgroundColor: item.color, marginTop: index === 0 ? 0 : -100 },
        ]}
      >
        <View style={styles.cardHeader}>
          <Text style={styles.cardTopTitle}>{item.title}</Text>
          <TouchableOpacity
            style={styles.optionsButton}
            onPress={() => openEditMenu(item)}
          >
            <Ionicons name="ellipsis-horizontal" size={24} color="#fff" />
          </TouchableOpacity>
        </View>
      </Animated.View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Wallet</Text>
        <TouchableOpacity
          onPress={() => setAddModalVisible(true)}
          style={styles.addButton}
        >
          <Ionicons name="add" size={30} color="#2f6deb" />
        </TouchableOpacity>
      </View>

      {uploading && (
        <View style={styles.uploadingBanner}>
          <ActivityIndicator color="#fff" size="small" />
          <Text style={styles.uploadingText}>Uploading to secure storage...</Text>
        </View>
      )}

      {loadingDocs ? (
        <ActivityIndicator color="#fff" size="large" style={{ marginTop: 60 }} />
      ) : (
        <FlatList
          data={documents}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="wallet-outline" size={60} color="#444" />
              <Text style={styles.emptyText}>No documents yet</Text>
              <Text style={styles.emptySubText}>Tap + to add your first document</Text>
            </View>
          }
        />
      )}

      {/* Add Document Modal */}
      <Modal visible={isAddModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>New Document</Text>
            <TextInput
              style={styles.input}
              placeholder="Document Name..."
              placeholderTextColor="#888"
              value={newDocTitle}
              onChangeText={setNewDocTitle}
            />
            <Text style={styles.colorLabel}>Choose Label Color:</Text>
            <View style={styles.colorPicker}>
              {APPLE_COLORS.map((color) => (
                <TouchableOpacity
                  key={color}
                  style={[
                    styles.colorCircle,
                    { backgroundColor: color },
                    newDocColor === color && styles.selectedColorCircle,
                  ]}
                  onPress={() => setNewDocColor(color)}
                />
              ))}
            </View>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setAddModalVisible(false)}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.createBtn} onPress={handleCreate}>
                <Text style={styles.createBtnText}>Choose File</Text>
              </TouchableOpacity>
            </View>
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
                  style={[
                    styles.colorCircle,
                    { backgroundColor: color },
                    editDocColor === color && styles.selectedColorCircle,
                  ]}
                  onPress={() => setEditDocColor(color)}
                />
              ))}
            </View>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setEditModalVisible(false)}
              >
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

      {/* Full Document Viewer Modal */}
      <Modal visible={!!selectedDoc} transparent animationType="fade">
        <View style={styles.viewModalOverlay}>
          <View style={styles.viewModalHeader}>
            <Text style={styles.viewModalTitle}>{selectedDoc?.title}</Text>
            <TouchableOpacity onPress={() => setSelectedDoc(null)}>
              <Ionicons name="close-circle" size={36} color="#fff" />
            </TouchableOpacity>
          </View>
          <View style={styles.documentContainer}>
            {selectedDoc?.mimeType?.includes("image") ? (
              <Image
                source={{ uri: selectedDoc.url }}
                style={styles.fullDocImage}
                resizeMode="contain"
              />
            ) : (
              <WebView
                source={{ uri: selectedDoc?.url }}
                style={styles.webview}
                originWhitelist={["*"]}
              />
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
    marginBottom: 20,
  },
  headerTitle: { fontSize: 34, fontWeight: "bold", color: "#fff" },
  addButton: { backgroundColor: "#1c1c1e", borderRadius: 20, padding: 5 },
  listContent: { paddingHorizontal: 20, paddingBottom: 100 },

  uploadingBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#0a84ff",
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 10,
    marginHorizontal: 20,
    borderRadius: 10,
    marginBottom: 10,
  },
  uploadingText: { color: "#fff", fontWeight: "600", fontSize: 14 },

  emptyState: { alignItems: "center", marginTop: 100 },
  emptyText: { color: "#666", fontSize: 18, fontWeight: "bold", marginTop: 16 },
  emptySubText: { color: "#444", fontSize: 14, marginTop: 6 },

  card: {
    height: 200,
    width: "100%",
    borderRadius: 15,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 5,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardTopTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1.5,
    flex: 1,
  },
  optionsButton: { padding: 5 },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    width: "85%",
    backgroundColor: "#1c1c1e",
    borderRadius: 20,
    padding: 25,
    alignItems: "center",
  },
  modalTitle: { color: "#fff", fontSize: 22, fontWeight: "bold", marginBottom: 20 },
  input: {
    width: "100%",
    backgroundColor: "#2c2c2e",
    color: "#fff",
    padding: 15,
    borderRadius: 10,
    fontSize: 16,
    marginBottom: 20,
  },
  colorLabel: { color: "#fff", alignSelf: "flex-start", marginBottom: 10, fontSize: 16 },
  colorPicker: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
    marginBottom: 30,
  },
  colorCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: "transparent",
  },
  selectedColorCircle: { borderColor: "#fff" },
  modalButtons: { flexDirection: "row", justifyContent: "space-between", width: "100%" },
  cancelBtn: {
    flex: 1,
    padding: 15,
    alignItems: "center",
    borderRadius: 10,
    backgroundColor: "#3a3a3c",
    marginRight: 10,
  },
  cancelBtnText: { color: "#ff453a", fontSize: 16, fontWeight: "bold" },
  createBtn: {
    flex: 1,
    padding: 15,
    alignItems: "center",
    borderRadius: 10,
    backgroundColor: "#0a84ff",
    marginLeft: 10,
  },
  createBtnText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  deleteBtnFull: {
    flexDirection: "row",
    marginTop: 20,
    padding: 15,
    backgroundColor: "rgba(255, 69, 58, 0.15)",
    borderRadius: 10,
    width: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
  deleteBtnFullText: { color: "#ff453a", fontSize: 16, fontWeight: "bold" },

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
  documentContainer: { flex: 1, backgroundColor: "#fff" },
  fullDocImage: { flex: 1, width: "100%", height: "100%" },
  webview: { flex: 1 },
});
