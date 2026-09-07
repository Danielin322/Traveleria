import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { FontFamily, ThemeColors } from "../../constants/theme";
import { useThemeColors } from "../../contexts/ThemeContext";
import { SocialUser } from "../../services/socialService";
import { Avatar } from "./Avatar";

export function LikesModal({
  users,
  onClose,
  onPressUser,
}: {
  users: SocialUser[] | null;
  onClose: () => void;
  onPressUser: (userId: string) => void;
}) {
  const colors = useThemeColors();
  const styles = makeStyles(colors);

  return (
    <Modal visible={!!users} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { minHeight: 380 }]}>
          <Text style={styles.modalTitle}>Liked by</Text>
          <ScrollView style={{ minHeight: 240, maxHeight: 380 }}>
            {users?.map((u) => (
              <TouchableOpacity
                key={u.id}
                style={styles.likeRow}
                onPress={() => {
                  onClose();
                  onPressUser(u.id);
                }}
              >
                <Avatar uri={u.avatar} size={36} iconSize={18} style={styles.avatarMargin} />
                <Text style={styles.likeName}>{u.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity
            style={[
              styles.modalButton,
              {
                marginTop: 16,
                marginBottom: 24,
                paddingVertical: 22,
                minHeight: 64,
                justifyContent: "center",
              },
            ]}
            onPress={onClose}
          >
            <Text style={[styles.saveButtonText, { fontSize: 18 }]}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    modalOverlay: {
      flex: 1,
      justifyContent: "center",
      backgroundColor: "rgba(0,0,0,0.5)",
      padding: 20,
    },
    modalContent: { backgroundColor: colors.surface, borderRadius: 20, padding: 22 },
    modalTitle: {
      fontSize: 20,
      fontFamily: FontFamily.bold,
      marginBottom: 14,
      textAlign: "center",
      color: colors.textPrimary,
    },
    modalButton: {
      padding: 14,
      borderRadius: 10,
      alignItems: "center",
      backgroundColor: colors.primary,
    },
    saveButtonText: { color: colors.surface, fontFamily: FontFamily.bold },
    likeRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8 },
    avatarMargin: { marginRight: 10 },
    likeName: { fontSize: 15, color: colors.textPrimary },
  });
