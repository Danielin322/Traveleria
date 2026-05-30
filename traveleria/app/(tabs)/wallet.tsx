import AsyncStorage from "@react-native-async-storage/async-storage";
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
} from "react-native";
import { WebView } from "react-native-webview";

// Apple Wallet style colors
const APPLE_COLORS = [
  "#000000",
  "#FF3B30",
  "#FF9500",
  "#34C759",
  "#007AFF",
  "#5856D6",
];

const STORAGE_KEY = "wallet_documents";

export default function WalletScreen() {
  const [documents, setDocuments] = useState<any[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (raw) setDocuments(JSON.parse(raw));
    });
  }, []);

  const saveDocuments = (docs: any[]) => {
    setDocuments(docs);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(docs));
  };

  // State for Add Document Modal
  const [isAddModalVisible, setAddModalVisible] = useState(false);
  const [newDocTitle, setNewDocTitle] = useState("");
  const [newDocColor, setNewDocColor] = useState(APPLE_COLORS[0]);

  // State for Document Viewer Modal
  const [selectedDoc, setSelectedDoc] = useState<any>(null);

  // --- State for Edit Document Modal ---
  const [isEditModalVisible, setEditModalVisible] = useState(false);
  const [editingDoc, setEditingDoc] = useState<any>(null);
  const [editDocTitle, setEditDocTitle] = useState("");
  const [editDocColor, setEditDocColor] = useState(APPLE_COLORS[0]);

  // Create Document Function
  const handleCreate = async () => {
    if (!newDocTitle.trim()) {
      alert("Please enter a document name");
      return;
    }
    let result = await DocumentPicker.getDocumentAsync({ type: "*/*" });
    if (!result.canceled) {
      const newDoc = {
        id: Math.random().toString(),
        title: newDocTitle,
        color: newDocColor,
        uri: result.assets[0].uri,
        mimeType: result.assets[0].mimeType,
      };
      saveDocuments([newDoc, ...documents]);
      setAddModalVisible(false);
      setNewDocTitle("");
      setNewDocColor(APPLE_COLORS[0]);
    }
  };

  // --- Edit and Delete Functions ---
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
    saveDocuments(
      documents.map((doc) =>
        doc.id === editingDoc.id
          ? { ...doc, title: editDocTitle, color: editDocColor }
          : doc,
      ),
    );
    setEditModalVisible(false);
    setEditingDoc(null);
  };

  const handleDelete = () => {
    saveDocuments(documents.filter((doc) => doc.id !== editingDoc.id));
    setEditModalVisible(false);
    setEditingDoc(null);
  };

  // Render each document card
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

          {/* The new 3-dots options button */}
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

      <FlatList
        data={documents}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />

      {/* --- Add Document Modal --- */}
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
                <Text style={styles.createBtnText}>Create</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* --- Edit Document Modal --- */}
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
              <TouchableOpacity
                style={styles.createBtn}
                onPress={handleSaveEdit}
              >
                <Text style={styles.createBtnText}>Save</Text>
              </TouchableOpacity>
            </View>

            {/* Prominent Apple-style delete button */}
            <TouchableOpacity
              style={styles.deleteBtnFull}
              onPress={handleDelete}
            >
              <Ionicons
                name="trash-outline"
                size={20}
                color="#ff453a"
                style={{ marginRight: 8 }}
              />
              <Text style={styles.deleteBtnFullText}>Delete Document</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* --- Full Document Viewer Modal --- */}
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
                source={{ uri: selectedDoc.uri }}
                style={styles.fullDocImage}
                resizeMode="contain"
              />
            ) : (
              <WebView
                source={{ uri: selectedDoc?.uri }}
                style={styles.webview}
                originWhitelist={["*"]}
                allowFileAccess={true}
                allowFileAccessFromFileURLs={true}
                allowUniversalAccessFromFileURLs={true}
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

  // Wallet Card Styles
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
  optionsButton: { padding: 5 }, // Comfortable hit area for the 3-dots button
  cardBody: { flex: 1, justifyContent: "flex-end", marginTop: 10 },

  // Add/Edit Modal Styles
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
  modalTitle: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "bold",
    marginBottom: 20,
  },
  input: {
    width: "100%",
    backgroundColor: "#2c2c2e",
    color: "#fff",
    padding: 15,
    borderRadius: 10,
    fontSize: 16,
    marginBottom: 20,
  },
  colorLabel: {
    color: "#fff",
    alignSelf: "flex-start",
    marginBottom: 10,
    fontSize: 16,
  },
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
  modalButtons: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
  },
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

  // New Delete Button Styles
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

  // Document Viewer Modal Styles
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
