/**
 * Wallet documents, stored in S3.
 *
 * The backend never handles file bytes: it returns presigned URLs and the app
 * transfers directly to and from S3. So a create is three steps — reserve a
 * row and get an upload URL, PUT the file, confirm — and this module exists so
 * the screen does not have to know that.
 */

import { apiFetch } from "./apiClient";

export type WalletDocument = {
  id: string;
  title: string;
  color: string | null;
  /** Ionicons glyph name, or null for documents saved before icons existed. */
  icon: string | null;
  mimeType: string | null;
  fileName: string | null;
  tripId: string | null;
  /** Presigned GET URL. Short-lived — refetch the list rather than caching it. */
  url: string;
};

/** Pulls the server's own message out of a failed response. */
async function failureReason(response: Response, fallback: string) {
  try {
    const body = await response.json();
    const detail = body?.detail || body?.error || body?.message;
    if (detail) return `${detail} (HTTP ${response.status})`;
  } catch {
    // Non-JSON body; the status alone will have to do.
  }
  // API Gateway answers an unrouted path with 403 "Missing Authentication
  // Token", which reads as an auth failure and is not one.
  if (response.status === 403) {
    return "The wallet API is not deployed yet (HTTP 403).";
  }
  return `${fallback} (HTTP ${response.status})`;
}

export async function listDocuments(): Promise<WalletDocument[]> {
  const response = await apiFetch("/wallet");
  if (!response.ok) {
    throw new Error(await failureReason(response, "Could not load documents."));
  }
  return response.json();
}

type NewDocument = {
  title: string;
  color: string;
  icon: string;
  /** Local file:// URI from the document picker. */
  uri: string;
  fileName: string;
  mimeType: string;
  size?: number;
};

/**
 * Creates a document: reserves the row, uploads the bytes, then confirms.
 *
 * If the upload fails the row is left `pending` rather than deleted, so a
 * half-finished document never shows as a card the user can tap into. The
 * backend hides pending rows older than an hour.
 */
export async function createDocument(doc: NewDocument): Promise<void> {
  const createResponse = await apiFetch("/wallet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: doc.title,
      color: doc.color,
      icon: doc.icon,
      fileName: doc.fileName,
      mimeType: doc.mimeType,
      size: doc.size,
    }),
  });

  if (!createResponse.ok) {
    throw new Error(await failureReason(createResponse, "Could not add the document."));
  }

  const { id, uploadUrl, contentType } = await createResponse.json();

  // Read the picked file, then PUT the bytes straight to S3. The Content-Type
  // must match what the URL was signed for or S3 rejects the request.
  const fileBody = await fetch(doc.uri).then((r) => r.blob());
  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: fileBody,
  });

  if (!uploadResponse.ok) {
    throw new Error(
      `Upload to storage failed (HTTP ${uploadResponse.status}). Please try again.`,
    );
  }

  // Only now is the document real.
  const confirmResponse = await apiFetch(`/wallet/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmUpload: true }),
  });

  if (!confirmResponse.ok) {
    throw new Error(await failureReason(confirmResponse, "Could not finish saving."));
  }
}

export async function updateDocument(
  id: string,
  changes: { title?: string; color?: string; icon?: string },
): Promise<void> {
  const response = await apiFetch(`/wallet/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  });
  if (!response.ok) {
    throw new Error(await failureReason(response, "Could not save changes."));
  }
}

export async function deleteDocument(id: string): Promise<void> {
  const response = await apiFetch(`/wallet/${id}`, { method: "DELETE" });
  if (!response.ok) {
    throw new Error(await failureReason(response, "Could not delete the document."));
  }
}

/**
 * Uploads a new profile photo and returns nothing — the caller refetches the
 * profile to get a fresh presigned view URL.
 *
 * Rides on PATCH /users/me rather than a route of its own: the endpoint
 * already exists, and a photo is part of the profile.
 */
export async function uploadAvatar(uri: string, mimeType: string): Promise<void> {
  const response = await apiFetch("/users/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ avatar_content_type: mimeType }),
  });

  if (!response.ok) {
    throw new Error(await failureReason(response, "Could not update your photo."));
  }

  const { avatar_upload_url: uploadUrl } = await response.json();
  if (!uploadUrl) {
    throw new Error("The server did not return an upload URL.");
  }

  const fileBody = await fetch(uri).then((r) => r.blob());
  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": mimeType },
    body: fileBody,
  });

  if (!uploadResponse.ok) {
    throw new Error(
      `Photo upload failed (HTTP ${uploadResponse.status}). Please try again.`,
    );
  }
}
