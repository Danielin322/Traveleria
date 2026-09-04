/**
 * Co-editing: who is on a trip, and the invitations that put them there.
 *
 * Sharing is by email address and nothing else — there is no friends graph in
 * the app to pick from. An invited address does not need an account yet; the
 * invitation waits and is claimed the first time that address signs in.
 *
 * Every one of these is a route on the trips Lambda. Errors carry the server's
 * own message where there is one, because "could not add" without a reason
 * makes a validation failure look like a broken button.
 */

import { apiFetch } from "./apiClient";

export type MemberStatus = "pending" | "active" | "declined";

export type TripMember = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  status: MemberStatus;
  /** Computed by the server, which already knows who is asking. */
  is_you: boolean;
};

export type TripOwner = {
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  is_you: boolean;
};

export type TripMembers = {
  owner: TripOwner;
  collaborators: TripMember[];
  your_role: "owner" | "editor";
};

export type Invitation = {
  id: string;
  trip: { title: string; location: string; date: string };
  invited_by: {
    email: string | null;
    full_name: string | null;
    avatar_url: string | null;
  };
  created_at: string;
};

/** Pulls the server's own message out of a failed response. */
async function failureReason(response: Response, fallback: string) {
  try {
    const body = await response.json();
    const detail = body?.detail || body?.error || body?.message;
    if (detail) return detail;
  } catch {
    // Non-JSON body; the status alone will have to do.
  }
  // API Gateway answers an unrouted path with 403 "Missing Authentication
  // Token", which reads as an auth failure and is not one.
  if (response.status === 403) {
    return "Trip sharing is not deployed on the API yet.";
  }
  return `${fallback} (HTTP ${response.status})`;
}

export async function listMembers(tripId: string): Promise<TripMembers> {
  const response = await apiFetch(`/trips/${tripId}/collaborators`);
  if (!response.ok) {
    throw new Error(await failureReason(response, "Could not load trip members."));
  }
  return response.json();
}

export async function addMember(
  tripId: string,
  email: string,
): Promise<{ collaborator: TripMember; message: string }> {
  const response = await apiFetch(`/trips/${tripId}/collaborators`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) {
    throw new Error(await failureReason(response, "Could not send the invitation."));
  }
  return response.json();
}

/**
 * Removes someone from a trip. The owner may remove anyone; everyone else may
 * only remove themselves, which is what "Leave trip" is underneath.
 */
export async function removeMember(tripId: string, memberId: string) {
  const response = await apiFetch(`/trips/${tripId}/collaborators/${memberId}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(await failureReason(response, "Could not remove them from the trip."));
  }
  return response.json();
}

export async function transferOwnership(tripId: string, memberId: string) {
  const response = await apiFetch(`/trips/${tripId}/owner`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ collaborator_id: memberId }),
  });
  if (!response.ok) {
    throw new Error(await failureReason(response, "Could not transfer ownership."));
  }
  return response.json();
}

export async function listInvitations(): Promise<Invitation[]> {
  const response = await apiFetch("/invitations");
  if (!response.ok) {
    throw new Error(await failureReason(response, "Could not load invitations."));
  }
  return response.json();
}

/**
 * Accepting returns the trip in the same shape `GET /trips` uses, so the home
 * list can absorb it without a second request.
 */
export async function respondToInvitation(
  invitationId: string,
  action: "accept" | "decline",
): Promise<{ message: string; trip?: any }> {
  const response = await apiFetch(`/invitations/${invitationId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  if (!response.ok) {
    throw new Error(
      await failureReason(
        response,
        action === "accept"
          ? "Could not accept the invitation."
          : "Could not decline the invitation.",
      ),
    );
  }
  return response.json();
}

/** The label to show for a person: their name if they have set one. */
export function displayName(person: {
  full_name?: string | null;
  email?: string | null;
}) {
  return person.full_name || person.email || "Someone";
}
