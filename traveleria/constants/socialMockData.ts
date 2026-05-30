// Mock data for the Social tab. Replace with real backend data once DB is ready.

export type SocialUser = {
  id: string;
  name: string;
  avatar?: string;
};

export type Reply = {
  id: string;
  user: SocialUser;
  text: string;
  createdAt: string; // ISO
};

export type Comment = {
  id: string;
  user: SocialUser;
  text: string;
  createdAt: string;
  replies: Reply[];
};

export type Post = {
  id: string;
  user: SocialUser;
  text?: string;
  imageUri?: string;
  createdAt: string;
  likes: SocialUser[]; // users who liked
  comments: Comment[];
};

// The currently logged-in user. In the future this will come from the
// profile screen / auth context.
export const CURRENT_USER: SocialUser = {
  id: "u_me",
  name: "Your Name",
  avatar: "https://i.pravatar.cc/150?img=12",
};

const USERS: SocialUser[] = [
  { id: "u_1", name: "Maya Cohen", avatar: "https://i.pravatar.cc/150?img=47" },
  { id: "u_2", name: "Daniel Levi", avatar: "https://i.pravatar.cc/150?img=33" },
  { id: "u_3", name: "Noa Bar", avatar: "https://i.pravatar.cc/150?img=5" },
  { id: "u_4", name: "Yuval Mor", avatar: "https://i.pravatar.cc/150?img=15" },
];

export const INITIAL_POSTS: Post[] = [
  {
    id: "p_1",
    user: USERS[0],
    text: "Sunset at Santorini was unreal — colors I've never seen before.",
    imageUri:
      "https://picsum.photos/seed/santorini/900/600",
    createdAt: "2026-04-26T18:32:00Z",
    likes: [USERS[1], USERS[2], CURRENT_USER],
    comments: [
      {
        id: "c_1",
        user: USERS[1],
        text: "Stunning! adding it to my list.",
        createdAt: "2026-04-26T19:00:00Z",
        replies: [
          {
            id: "r_1",
            user: USERS[0],
            text: "You'll love it. Go in May!",
            createdAt: "2026-04-26T19:10:00Z",
          },
        ],
      },
    ],
  },
  {
    id: "p_2",
    user: USERS[2],
    text: "Hidden ramen spot in Tokyo. 10/10. Drop a comment if you want the address.",
    createdAt: "2026-04-25T12:00:00Z",
    likes: [USERS[0], USERS[3]],
    comments: [],
  },
  {
    id: "p_3",
    user: USERS[3],
    text: "Sahara at dawn ✨",
    imageUri:
      "https://picsum.photos/seed/sahara/900/600",
    createdAt: "2026-04-24T05:45:00Z",
    likes: [USERS[0], USERS[1], USERS[2]],
    comments: [
      {
        id: "c_2",
        user: USERS[0],
        text: "Bucket list 🐪",
        createdAt: "2026-04-24T08:30:00Z",
        replies: [],
      },
    ],
  },
];
