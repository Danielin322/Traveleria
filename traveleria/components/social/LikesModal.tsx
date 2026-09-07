import { useMemo } from "react";
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { ThemeColors } from "../../constants/theme";
import { useThemeColors } from "../../contexts/ThemeContext";
import { SocialUser } from "../../services/socialService";
import { Avatar } from "./Avatar";

export type LikesModalProps = {
  /** Who liked the post, or null when the modal is closed. */
  users: SocialUser[] | null;
  onClose: () => void;
  onSelectUser: (userId: string) => void;
};

/** The "Liked by" list for one post. */
export function LikesModal({ users, onClose, onSelectUser }: LikesModalProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <Modal
      visible={!!users}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
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
                  onSelectUser(u.id);
                }}
              >
                <Avatar uri={u.avatar} style={styles.smallAvatar} iconSize={18} />
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
      color: colors.textPrimary,
    },
    likeRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8 },
    smallAvatar: { width: 36, height: 36, borderRadius: 18, marginRight: 10 },
    likeName: { fontSize: 15, color: colors.textPrimary },
    modalButton: {
      flex: 1,
      padding: 14,
      borderRadius: 10,
      alignItems: "center",
      marginHorizontal: 4,
    },
    saveButton: { backgroundColor: colors.primary },
    saveButtonText: { color: colors.surface, fontWeight: "bold" },
  });
