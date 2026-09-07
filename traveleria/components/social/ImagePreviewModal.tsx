import { Ionicons } from "@expo/vector-icons";
import { Image, Modal, StyleSheet, TouchableOpacity } from "react-native";

export type ImagePreviewModalProps = {
  /** The image to show full-screen, or null when the preview is closed. */
  uri: string | null;
  onClose: () => void;
};

/** Full-screen view of a post's photo. */
export function ImagePreviewModal({ uri, onClose }: ImagePreviewModalProps) {
  return (
    <Modal
      visible={!!uri}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.previewOverlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <TouchableOpacity style={styles.previewClose} onPress={onClose}>
          <Ionicons name="close" size={28} color="#fff" />
        </TouchableOpacity>
        {uri && (
          <Image
            source={{ uri }}
            style={styles.previewImage}
            resizeMode="contain"
          />
        )}
      </TouchableOpacity>
    </Modal>
  );
}

// Fixed colours rather than theme tokens: this is a full-screen photo viewer
// that is deliberately dark in both themes.
const styles = StyleSheet.create({
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
