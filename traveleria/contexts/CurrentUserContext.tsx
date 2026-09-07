import { createContext, ReactNode, useContext, useState } from "react";

export const CURRENT_USER_ID = "u_me";

type CurrentUserCtx = {
  id: string;
  name: string;
  avatar: string;
  setName: (name: string) => void;
  setAvatar: (uri: string) => void;
};

const Context = createContext<CurrentUserCtx | null>(null);

export function CurrentUserProvider({ children }: { children: ReactNode }) {
  const [name, setName] = useState("Your Name");
  const [avatar, setAvatar] = useState("https://i.pravatar.cc/150?img=12");

  return (
    <Context.Provider
      value={{ id: CURRENT_USER_ID, name, avatar, setName, setAvatar }}
    >
      {children}
    </Context.Provider>
  );
}

export function useCurrentUser() {
  const ctx = useContext(Context);
  if (!ctx) {
    throw new Error("useCurrentUser must be used within CurrentUserProvider");
  }
  return ctx;
}
