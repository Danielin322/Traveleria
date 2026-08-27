import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import React, { useEffect, useMemo, useState } from "react";
import {
    Alert,
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

import {
    Elevation,
    FontFamily,
    FontSize,
    Radius,
    Spacing,
    ThemeColors,
} from "../../constants/theme";
import { useThemeColors } from "../../contexts/ThemeContext";

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
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

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
      Alert.alert("Name required", "Please enter a document name.");
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
      Alert.alert("Name required", "Please enter a document name.");
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

  // Deleting a document cannot be undone, so confirm first — matching the
  // confirmation the itinerary already uses before removing an event.
  const handleDelete = () => {
    Alert.alert(
      "Delete Document",
      `Remove "${editingDoc?.title}" from your wallet? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            saveDocuments(documents.filter((doc) => doc.id !== editingDoc.id));
            setEditModalVisible(false);
            setEditingDoc(null);
          },
        },
      ],
    );
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
          <Ionicons name="add" size={30} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={documents}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="card-outline" size={52} color={colors.textDisabled} />
            <Text style={styles.emptyText}>No documents yet</Text>
            <Text style={styles.emptySubText}>
              Tap + to add a boarding pass, ticket or booking.
            </Text>
          </View>
        }
      />

      {/* --- Add Document Modal --- */}
      <Modal visible={isAddModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>New Document</Text>
            <TextInput
              style={styles.input}
              placeholder="Document Name..."
              placeholderTextColor={colors.textDisabled}
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
              placeholderTextColor={colors.textDisabled}
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
                color={colors.danger}
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
            <Text style={styles.viewModalTitle} numberOfLines={1}>
              {selectedDoc?.title}
            </Text>
            <TouchableOpacity
              onPress={() => setSelectedDoc(null)}
              accessibilityRole="button"
              accessibilityLabel="Close document"
            >
              <Ionicons name="close-circle" size={36} color={colors.textMuted} />
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

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    // White in light mode, dark in dark mode.
    container: { flex: 1, backgroundColor: colors.surface },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingTop: 60,
      paddingHorizontal: Spacing.xl,
      marginBottom: Spacing.xl,
    },
    headerTitle: {
      fontSize: FontSize.display,
      fontFamily: FontFamily.bold,
      color: colors.textPrimary,
    },
    addButton: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: Radius.xl,
      padding: Spacing.xs + 1,
    },
    listContent: {
      paddingHorizontal: Spacing.xl,
      paddingBottom: 100,
      flexGrow: 1,
    },
    emptyState: { alignItems: "center", marginTop: 60 },
    emptyText: {
      fontSize: FontSize.h3,
      fontFamily: FontFamily.semibold,
      color: colors.textMuted,
      marginTop: Spacing.md,
    },
    emptySubText: {
      fontSize: FontSize.small,
      fontFamily: FontFamily.regular,
      color: colors.textDisabled,
      marginTop: Spacing.xs,
      textAlign: "center",
    },

    // Wallet Card Styles. Cards keep the user-chosen APPLE_COLORS in both
    // themes, so their white text stays correct either way.
    card: {
      height: 200,
      width: "100%",
      borderRadius: Radius.lg,
      padding: Spacing.xl,
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
      fontSize: FontSize.h3,
      fontFamily: FontFamily.bold,
      textTransform: "uppercase",
      letterSpacing: 1.5,
      flex: 1,
    },
    optionsButton: { padding: Spacing.xs + 1 },
    cardBody: { flex: 1, justifyContent: "flex-end", marginTop: Spacing.md },

    // Add/Edit Modal Styles
    modalOverlay: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: "center",
      alignItems: "center",
    },
    modalContent: {
      width: "85%",
      backgroundColor: colors.surface,
      borderRadius: Radius.xl,
      padding: Spacing.xxl,
      alignItems: "center",
      ...Elevation.lg,
    },
    modalTitle: {
      color: colors.textPrimary,
      fontSize: FontSize.h2,
      fontFamily: FontFamily.bold,
      marginBottom: Spacing.xl,
    },
    input: {
      width: "100%",
      backgroundColor: colors.surfaceSunken,
      color: colors.textPrimary,
      padding: Spacing.lg,
      borderRadius: Radius.md,
      fontSize: FontSize.body,
      fontFamily: FontFamily.regular,
      marginBottom: Spacing.xl,
      borderWidth: 1,
      borderColor: colors.border,
    },
    colorLabel: {
      color: colors.textPrimary,
      alignSelf: "flex-start",
      marginBottom: Spacing.md,
      fontSize: FontSize.body,
      fontFamily: FontFamily.medium,
    },
    colorPicker: {
      flexDirection: "row",
      justifyContent: "space-between",
      width: "100%",
      marginBottom: Spacing.xxxl,
    },
    colorCircle: {
      width: 40,
      height: 40,
      borderRadius: 20,
      borderWidth: 2,
      borderColor: "transparent",
    },
    // Ring follows the theme so it is visible on both light and dark sheets.
    selectedColorCircle: { borderColor: colors.textPrimary },
    modalButtons: {
      flexDirection: "row",
      justifyContent: "space-between",
      width: "100%",
      gap: Spacing.md,
    },
    cancelBtn: {
      flex: 1,
      padding: Spacing.lg,
      alignItems: "center",
      borderRadius: Radius.md,
      backgroundColor: colors.surfaceAlt,
    },
    cancelBtnText: {
      color: colors.danger,
      fontSize: FontSize.body,
      fontFamily: FontFamily.semibold,
    },
    createBtn: {
      flex: 1,
      padding: Spacing.lg,
      alignItems: "center",
      borderRadius: Radius.md,
      backgroundColor: colors.primary,
    },
    createBtnText: {
      color: colors.primaryContrast,
      fontSize: FontSize.body,
      fontFamily: FontFamily.semibold,
    },

    deleteBtnFull: {
      flexDirection: "row",
      marginTop: Spacing.xl,
      padding: Spacing.lg,
      backgroundColor: colors.dangerSoft,
      borderRadius: Radius.md,
      width: "100%",
      justifyContent: "center",
      alignItems: "center",
    },
    deleteBtnFullText: {
      color: colors.danger,
      fontSize: FontSize.body,
      fontFamily: FontFamily.semibold,
    },

    // Document Viewer Modal Styles
    viewModalOverlay: { flex: 1, backgroundColor: colors.background },
    viewModalHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingTop: 60,
      paddingHorizontal: Spacing.xl,
      paddingBottom: Spacing.xl,
      backgroundColor: colors.surfaceAlt,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    viewModalTitle: {
      color: colors.textPrimary,
      fontSize: FontSize.h3,
      fontFamily: FontFamily.bold,
      flex: 1,
      marginRight: Spacing.md,
    },
    // Deliberately stays white in both themes: it renders third-party
    // documents that assume a white page, and inverting them looks wrong.
    documentContainer: { flex: 1, backgroundColor: "#fff" },
    fullDocImage: { flex: 1, width: "100%", height: "100%" },
    webview: { flex: 1 },
  });
