import { fetchAuthSession } from "aws-amplify/auth";

import { API_URL } from "../constants/api";

export const apiFetch = async (path: string, options: RequestInit = {}) => {
  if (!API_URL) {
    throw new Error(
      "API URL is not configured. Please set EXPO_PUBLIC_API_URL in your .env file.",
    );
  }

  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();

  if (!token) {
    throw new Error("User is not signed in.");
  }

  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${token}`);

  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });
};
