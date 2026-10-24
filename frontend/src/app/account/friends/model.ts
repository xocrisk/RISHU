export type User = { id: string; publicId?: string; nickname: string; avatar: string; avatarUrl?: string };
export type FriendRequest = { id: string; from: string; to: string; status: "pending" | "accepted" | "rejected" };
export type Friendship = { userA: string; userB: string };
export type Group = { id: string; name: string; ownerId?: string; members: string[]; notice: string };
export type Message = { id: string; thread: string; from: string; text: string; createdAt: string };
export type FriendsState = { me: User; users: User[]; requests: FriendRequest[]; friendships: Friendship[]; groups: Group[]; messages: Message[] };
export type FriendsAction =
  | { type: "request"; userId: string }
  | { type: "respond"; requestId: string; accept: boolean }
  | { type: "remove"; userId: string }
  | { type: "create-group"; name: string; members: string[]; id: string }
  | { type: "join-group"; groupId: string }
  | { type: "message"; thread: string; text: string; id: string; createdAt: string };

export const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ#".split("");
export const sectionOf = (name: string) => /^[A-Z]/i.test(name) ? name[0].toUpperCase() : "#";
export const sortUsers = (users: User[]) => [...users].sort((a, b) => a.nickname.localeCompare(b.nickname, undefined, { numeric: true }));
export const friendsOf = (state: FriendsState) => sortUsers(state.users.filter((user) => state.friendships.some((f) =>
  f.userA === state.me.id && f.userB === user.id || f.userB === state.me.id && f.userA === user.id)));

export function seedFriends(): FriendsState {
  const me = { id: "XO000001", nickname: "You", avatar: "Y" };
  const users = Array.from({ length: 14 }, (_, index) => ({ id: `FR${String(index + 1).padStart(6, "0")}`, nickname: `Friend ${index + 1}`, avatar: String(index + 1) }));
  return {
    me, users,
    friendships: users.slice(0, 8).map((user) => ({ userA: me.id, userB: user.id })),
    requests: users.slice(8, 10).map((user) => ({ id: `request-${user.id}`, from: user.id, to: me.id, status: "pending" })),
    groups: [{ id: "GR000001", name: "Group 1", members: [users[0].id, users[1].id], notice: "Welcome to Group 1. Share your paper trading ideas here." },
      { id: "GR000002", name: "Group 2", members: [users[2].id], notice: "Welcome to Group 2. Keep the conversation friendly." }],
    messages: [{ id: "message-1", thread: users[0].id, from: users[0].id, text: "Ready for another day of paper trading?", createdAt: "2026-01-01T09:00:00Z" },
      { id: "message-2", thread: users[1].id, from: users[1].id, text: "Let's learn together!", createdAt: "2026-01-01T08:00:00Z" }],
  };
}

export function reduceFriends(state: FriendsState, action: FriendsAction): FriendsState {
  const friendIds = friendsOf(state).map((user) => user.id);
  switch (action.type) {
    case "request": {
      if (action.userId === state.me.id) throw new Error("You can't add yourself.");
      if (!state.users.some((user) => user.id === action.userId)) throw new Error("User ID not found in the sample directory.");
      if (friendIds.includes(action.userId)) throw new Error("You're already friends.");
      if (state.requests.some((r) => r.status === "pending" && (r.from === action.userId && r.to === state.me.id || r.to === action.userId && r.from === state.me.id))) throw new Error("A request is already pending. Check New Friends.");
      return { ...state, requests: [...state.requests, { id: `request-${state.requests.length}-${action.userId}`, from: state.me.id, to: action.userId, status: "pending" }] };
    }
    case "respond": {
      const request = state.requests.find((r) => r.id === action.requestId && r.to === state.me.id && r.status === "pending");
      if (!request) throw new Error("This request is no longer pending.");
      return { ...state, requests: state.requests.map((r) => r.id === request.id ? { ...r, status: action.accept ? "accepted" : "rejected" } : r),
        friendships: action.accept && !friendIds.includes(request.from) ? [...state.friendships, { userA: state.me.id, userB: request.from }] : state.friendships };
    }
    case "remove": return { ...state, friendships: state.friendships.filter((f) => !(f.userA === state.me.id && f.userB === action.userId || f.userB === state.me.id && f.userA === action.userId)) };
    case "create-group": {
      const members = [...new Set(action.members)];
      const name = action.name.trim();
      if (!name || name.length > 50) throw new Error("Enter a group name of 1–50 characters.");
      if (!members.length || members.some((id) => !friendIds.includes(id))) throw new Error("Select at least one current friend.");
      return { ...state, groups: [...state.groups, { id: action.id, name, members: [state.me.id, ...members], notice: "Your group is ready. Say hello!" }] };
    }
    case "join-group": {
      if (!state.groups.some((g) => g.id === action.groupId)) throw new Error("Group not found.");
      return { ...state, groups: state.groups.map((g) => g.id === action.groupId ? { ...g, members: [...new Set([...g.members, state.me.id])] } : g) };
    }
    case "message": {
      const canSend = friendIds.includes(action.thread) || state.groups.some((g) => g.id === action.thread && g.members.includes(state.me.id));
      if (!canSend) throw new Error("Add this friend or join the group before chatting.");
      const text = action.text.trim();
      if (!text || text.length > 1000) throw new Error("Enter a message of 1–1,000 characters.");
      return { ...state, messages: [...state.messages, { id: action.id, thread: action.thread, from: state.me.id, text, createdAt: action.createdAt }] };
    }
  }
}

/** Implement this interface with authenticated API calls when connecting the backend. */
export interface FriendsRepository {
  /** True for the local placeholder repository; the UI labels its content as sample data. */
  sample?: boolean;
  load(): Promise<FriendsState>;
  dispatch(action: FriendsAction): Promise<FriendsState>;
  searchUser?: (publicId: string) => Promise<User | null>;
  subscribe?: (onChange: () => void, onError: (error: Error) => void) => () => void;
}

/** Deliberately unimplemented extension points. Do not expose financial data by default. */
export interface FriendsIntegrations {
  loadLeaderboard?: (friendIds: string[]) => Promise<unknown>;
  sharePortfolio?: (recipientId: string, consent: { confirmed: true }) => Promise<void>;
}

export function createMockFriendsRepository(scope: string): FriendsRepository {
  const key = `xocrisk.friends.mock.v1:${scope}`;
  let state = seedFriends();
  return {
    sample: true,
    async load() {
      try {
        const raw = localStorage.getItem(key);
        if (raw) {
          const saved = JSON.parse(raw) as FriendsState;
          if (saved.me?.id === state.me.id && [saved.users, saved.requests, saved.friendships, saved.groups, saved.messages].every(Array.isArray)) state = saved;
        }
      } catch { /* Storage unavailable: keep a working in-memory sample. */ }
      return state;
    },
    async dispatch(action) {
      state = reduceFriends(state, action);
      try { localStorage.setItem(key, JSON.stringify(state)); } catch { /* In-memory mode. */ }
      return state;
    },
  };
}
