/**
 * The social feed: posts, likes, and comments (including replies to
 * replies), backed by the traveleria-social Lambda.
 *
 * Post images follow the same two-phase S3 upload as wallet documents: the
 * backend never handles file bytes, so creating a post with a photo is
 * three steps — reserve a row and get an upload URL, PUT the file, confirm.
 */

import { apiFetch } from "./apiClient";
import { ItineraryEvent } from "../utils/itinerary";

export type SocialUser = {
  id: string;
  name: string;
  avatar: string | null;
};

export type Reply = {
  id: string;
  user: SocialUser;
  text: string;
  createdAt: string; // ISO
  /** 1 = direct reply to the top-level comment, 2 = reply to a reply, etc. */
  depth: number;
  /** Set when this reply was aimed at another reply, not the top-level comment. */
  replyingToName: string | null;
};

export type Comment = {
  id: string;
  user: SocialUser;
  text: string;
  createdAt: string;
  replies: Reply[];
};

export type SharedTrip = {
  id: string;
  title: string;
  location: string;
  date: string; // "DD.MM.YYYY - DD.MM.YYYY"
  eventsCount: number;
};

export type Post = {
  id: string;
  user: SocialUser;
  text?: string | null;
  imageUri?: string | null;
  sharedTrip: SharedTrip | null;
  createdAt: string;
  likes: SocialUser[];
  comments: Comment[];
};

export type PublicProfile = SocialUser & {
  postsCount: number;
  followersCount: number;
  followingCount: number;
  isFollowing: boolean;
  isMe: boolean;
};

export type PersonListItem = SocialUser & {
  isFollowing: boolean;
  followersCount: number;
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
    return "The social API is not deployed yet (HTTP 403).";
  }
  return `${fallback} (HTTP ${response.status})`;
}

export async function listPosts(): Promise<Post[]> {
  const response = await apiFetch("/social/posts");
  if (!response.ok) {
    throw new Error(await failureReason(response, "Could not load the feed."));
  }
  return response.json();
}

type NewPost = {
  text?: string;
  image?: {
    /** Local file:// URI from the image picker. */
    uri: string;
    mimeType: string;
    size?: number;
  };
  /** Shares one of the caller's own trips instead of (or alongside) text. Mutually exclusive with image. */
  sharedTripId?: string;
};

/**
 * Creates a post. When it has a photo, uploads straight to S3 with the
 * presigned URL the backend returns, then confirms — mirroring
 * walletService.createDocument. A text-only post skips the upload entirely.
 */
export async function createPost(post: NewPost): Promise<void> {
  const createResponse = await apiFetch("/social/posts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: post.text,
      mimeType: post.image?.mimeType,
      size: post.image?.size,
      sharedTripId: post.sharedTripId,
    }),
  });
  if (!createResponse.ok) {
    throw new Error(await failureReason(createResponse, "Could not create the post."));
  }

  const { id, uploadUrl, contentType } = await createResponse.json();
  if (!post.image) return;
  if (!uploadUrl) {
    throw new Error(
      "The server did not return an upload URL for the image, so it could not be attached.",
    );
  }

  const fileBody = await fetch(post.image.uri).then((r) => r.blob());
  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: fileBody,
  });
  if (!uploadResponse.ok) {
    throw new Error(
      `Image upload failed (HTTP ${uploadResponse.status}). Please try again.`,
    );
  }

  const confirmResponse = await apiFetch(`/social/posts/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmUpload: true }),
  });
  if (!confirmResponse.ok) {
    throw new Error(await failureReason(confirmResponse, "Could not finish posting."));
  }
}

export async function deletePost(postId: string): Promise<void> {
  const response = await apiFetch(`/social/posts/${postId}`, { method: "DELETE" });
  if (!response.ok) {
    throw new Error(await failureReason(response, "Could not delete the post."));
  }
}

/** Edits a post's text. Images are immutable — this never touches imageUri. */
export async function editPostText(postId: string, text: string): Promise<void> {
  const response = await apiFetch(`/social/posts/${postId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) {
    throw new Error(await failureReason(response, "Could not update the post."));
  }
}

export async function likePost(postId: string): Promise<void> {
  const response = await apiFetch(`/social/posts/${postId}/like`, { method: "POST" });
  if (!response.ok) {
    throw new Error(await failureReason(response, "Could not like the post."));
  }
}

export async function unlikePost(postId: string): Promise<void> {
  const response = await apiFetch(`/social/posts/${postId}/like`, { method: "DELETE" });
  if (!response.ok) {
    throw new Error(await failureReason(response, "Could not unlike the post."));
  }
}

/**
 * Adds a comment, or a reply when parentCommentId is set. parentCommentId
 * can point at a top-level comment or at another reply — the backend has no
 * depth limit, which is what lets a reply itself be replied to.
 */
export async function addComment(
  postId: string,
  text: string,
  parentCommentId?: string,
): Promise<void> {
  const response = await apiFetch(`/social/posts/${postId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, parentCommentId }),
  });
  if (!response.ok) {
    throw new Error(await failureReason(response, "Could not post your comment."));
  }
}

/** Deletes a comment or a reply — both live in the same table. */
export async function deleteComment(commentId: string): Promise<void> {
  const response = await apiFetch(`/social/comments/${commentId}`, { method: "DELETE" });
  if (!response.ok) {
    throw new Error(await failureReason(response, "Could not delete the comment."));
  }
}

/** Everyone but the current user, for a "find people to follow" list. */
export async function listPeople(): Promise<PersonListItem[]> {
  const response = await apiFetch("/social/people");
  if (!response.ok) {
    throw new Error(await failureReason(response, "Could not load people."));
  }
  return response.json();
}

export async function getUserProfile(userId: string): Promise<PublicProfile> {
  const response = await apiFetch(`/social/users/${userId}`);
  if (!response.ok) {
    throw new Error(await failureReason(response, "Could not load this profile."));
  }
  return response.json();
}

/** One person's posts, for their profile screen — same shape as the feed. */
export async function getUserPosts(userId: string): Promise<Post[]> {
  const response = await apiFetch(`/social/users/${userId}/posts`);
  if (!response.ok) {
    throw new Error(await failureReason(response, "Could not load their posts."));
  }
  return response.json();
}

export async function followUser(userId: string): Promise<void> {
  const response = await apiFetch(`/social/users/${userId}/follow`, { method: "POST" });
  if (!response.ok) {
    throw new Error(await failureReason(response, "Could not follow this person."));
  }
}

export async function unfollowUser(userId: string): Promise<void> {
  const response = await apiFetch(`/social/users/${userId}/follow`, { method: "DELETE" });
  if (!response.ok) {
    throw new Error(await failureReason(response, "Could not unfollow this person."));
  }
}

export type SharedTripDetail = {
  id: string;
  title: string;
  location: string;
  date: string;
  isOwner: boolean;
};

/** A shared trip's read-only itinerary, visible to anyone who can see a post sharing it. */
export async function getSharedTrip(
  tripId: string,
): Promise<{ trip: SharedTripDetail; itinerary: ItineraryEvent[] }> {
  const response = await apiFetch(`/social/shared-trips/${tripId}`);
  if (!response.ok) {
    throw new Error(await failureReason(response, "Could not load this trip."));
  }
  return response.json();
}

/** Clones a shared trip into the caller's own trips. Returns the new trip. */
export async function copySharedTrip(
  tripId: string,
): Promise<{ id: string; title: string; location: string; date: string }> {
  const response = await apiFetch(`/social/shared-trips/${tripId}/copy`, { method: "POST" });
  if (!response.ok) {
    throw new Error(await failureReason(response, "Could not copy this trip."));
  }
  const data = await response.json();
  return data.trip;
}
