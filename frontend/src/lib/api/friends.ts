"use client";

import { getSupabaseClient } from "../supabase/client";
import { ensureSupabaseSession } from "../supabase";
import { messageLifetimeMs, type FriendsRepository, type FriendsState, type Group, type Message, type User } from "../../app/account/friends/model";

type Profile = { id: string; nickname: string | null; avatar_url: string | null; public_id: string };
type RequestRow = { id: string; from_id: string; to_id: string; status: "pending" | "accepted" | "rejected" };
type MemberRow = { group_id: string; user_id: string; role: string };
type GroupRow = { id: string; name: string; owner_id: string };
type NoticeRow = { id: string; group_id: string; body: string; created_at: string };
type MessageRow = { id: string; thread_type: "direct" | "group"; group_id: string | null; from_id: string; to_id: string | null; body: string; created_at: string };
const profileFields = "id,nickname,avatar_url,public_id";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function friendlyFriendsError(error: { code?: string; message: string }): Error {
  if (error.code === "23505") return new Error("A friend request already exists between these accounts. Check New Friends.");
  if (error.code === "42501") return new Error(error.message.includes("Sign in") || error.message.includes("Complete XOCRISK") || error.message.includes("Verify") ? error.message : "You don't have permission for this action.");
  if (["42P01", "42703", "PGRST202", "PGRST205"].includes(error.code ?? "")) return new Error("Friends & Groups isn't configured on the server yet. Apply its Supabase migration.");
  if (error.message.includes("Failed to fetch")) return new Error("Can't reach Friends & Groups. Check your connection and retry.");
  return new Error(error.message || "Friends & Groups couldn't complete this action.");
}
function client() {
  const value = getSupabaseClient();
  if (!value) throw new Error("Configure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to enable Friends & Groups.");
  return value;
}
async function currentUser() {
  const { data, error } = await client().auth.getUser();
  if (!error && data.user) return data.user;
  // Email/password logins (and apps whose stored session a reinstall wiped) hold only a trading session.
  // Mint a Supabase session from it, then retry once, before giving up.
  const problem = await ensureSupabaseSession();
  if (!problem) {
    const retry = await client().auth.getUser();
    if (!retry.error && retry.data.user) return retry.data.user;
  }
  throw new Error(problem ?? "Friends & Groups couldn't connect to your account. Check your connection and try again.");
}
function asUser(profile: Profile): User {
  return { id: profile.id, publicId: profile.public_id, nickname: profile.nickname || "Trader", avatar: (profile.nickname || "T").slice(0, 1).toUpperCase(), avatarUrl: profile.avatar_url || undefined };
}
async function profiles(ids: string[]): Promise<User[]> {
  if (!ids.length) return [];
  const unique = [...new Set(ids)];
  const users: User[] = [];
  for (let start = 0; start < unique.length; start += 100) {
    const { data, error } = await client().from("profiles").select(profileFields).in("id", unique.slice(start, start + 100));
    if (error) throw friendlyFriendsError(error);
    users.push(...(data as Profile[]).map(asUser));
  }
  return users;
}

export async function getFriends(): Promise<User[]> {
  const me = await currentUser();
  const { data, error } = await client().from("friendships").select("user_b").eq("user_a", me.id);
  if (error) throw friendlyFriendsError(error);
  return profiles(data.map((row) => row.user_b as string));
}
export async function searchUserByPublicId(publicId: string): Promise<User | null> {
  const value = publicId.trim().toUpperCase();
  if (!value || value.length > 64) return null;
  const me = await currentUser();
  const { data, error } = await client().from("profiles").select(profileFields).eq("public_id", value).neq("id", me.id).maybeSingle();
  if (error) throw friendlyFriendsError(error);
  return data ? asUser(data as Profile) : null;
}
export async function sendRequest(toId: string): Promise<void> {
  const me = await currentUser();
  if (!uuidPattern.test(toId) || toId === me.id) throw new Error("Choose another user's profile to send a request.");
  const { error } = await client().from("friend_requests").insert({ from_id: me.id, to_id: toId });
  if (error) throw friendlyFriendsError(error);
}
export async function respondRequest(requestId: string, accept: boolean): Promise<void> {
  const me = await currentUser();
  if (accept) {
    const { error } = await client().rpc("accept_friend_request", { request_id: requestId });
    if (error) throw friendlyFriendsError(error);
  } else {
    const { data, error } = await client().from("friend_requests").update({ status: "rejected" }).eq("id", requestId).eq("to_id", me.id).eq("status", "pending").select("id");
    if (error) throw friendlyFriendsError(error);
    if (!data.length) throw new Error("This request is no longer pending.");
  }
}
export async function removeFriend(friendId: string): Promise<void> {
  const me = await currentUser();
  // Database trigger removes the reverse row and retires the old request atomically.
  const { error } = await client().from("friendships").delete().eq("user_a", me.id).eq("user_b", friendId);
  if (error) throw friendlyFriendsError(error);
}
export async function createGroup(name: string, memberIds: string[]): Promise<string> {
  await currentUser();
  const { data, error } = await client().rpc("create_group", { name: name.trim(), member_ids: [...new Set(memberIds)] });
  if (error) throw friendlyFriendsError(error);
  if (typeof data !== "string") throw new Error("The server didn't return the created group.");
  return data;
}
export async function getMyGroups(): Promise<Group[]> {
  await currentUser();
  // RLS restricts all three queries to groups where auth.uid() is a member.
  const [groups, members, notices] = await Promise.all([
    client().from("groups").select("id,name,owner_id").order("created_at", { ascending: false }),
    client().from("group_members").select("group_id,user_id,role"),
    client().from("group_notices").select("id,group_id,body,created_at").order("created_at", { ascending: false }),
  ]);
  for (const result of [groups, members, notices]) if (result.error) throw friendlyFriendsError(result.error);
  return (groups.data as GroupRow[]).map((group) => ({ id: group.id, name: group.name, ownerId: group.owner_id,
    members: (members.data as MemberRow[]).filter((member) => member.group_id === group.id).map((member) => member.user_id),
    notice: (notices.data as NoticeRow[]).filter((notice) => notice.group_id === group.id).map((notice) => notice.body).join("\n\n"),
  }));
}
export async function addGroupMember(groupId: string, userId: string): Promise<void> {
  await currentUser();
  const { error } = await client().from("group_members").insert({ group_id: groupId, user_id: userId, role: "member" });
  if (error) throw friendlyFriendsError(error);
}
export async function removeGroupMember(groupId: string, userId: string): Promise<void> {
  await currentUser();
  const { data, error } = await client().from("group_members").delete().eq("group_id", groupId).eq("user_id", userId).select("user_id");
  if (error) throw friendlyFriendsError(error);
  if (!data.length) throw new Error("Only the group owner can remove another member.");
}

export async function getMessages(meId: string): Promise<Message[]> {
  // RLS returns only this user's direct chats and the group chats they belong to, and nothing older than 24 hours.
  const { data, error } = await client().from("messages")
    .select("id,thread_type,group_id,from_id,to_id,body,created_at")
    .gt("created_at", new Date(Date.now() - messageLifetimeMs).toISOString())
    .order("created_at", { ascending: true });
  if (error) throw friendlyFriendsError(error);
  return (data as MessageRow[]).map((row) => ({
    id: row.id,
    // A direct thread is keyed by the other person; a group thread by the group id.
    thread: row.thread_type === "group" ? row.group_id! : (row.from_id === meId ? row.to_id! : row.from_id),
    from: row.from_id,
    text: row.body,
    createdAt: row.created_at,
  }));
}
export async function sendMessage(thread: string, text: string): Promise<void> {
  const me = await currentUser();
  const body = text.trim();
  if (!body || body.length > 1000) throw new Error("Enter a message of 1–1000 characters.");
  if (!uuidPattern.test(thread) || thread === me.id) throw new Error("Open a friend or group chat first.");
  // A thread id that names a group you're in is a group chat; otherwise it's a direct chat with that friend.
  const { data: group, error: groupError } = await client().from("groups").select("id").eq("id", thread).maybeSingle();
  if (groupError) throw friendlyFriendsError(groupError);
  const row: { thread_type: "direct" | "group"; group_id: string | null; from_id: string; to_id: string | null; body: string } = group
    ? { thread_type: "group", group_id: thread, from_id: me.id, to_id: null, body }
    : { thread_type: "direct", group_id: null, from_id: me.id, to_id: thread, body };
  const { error } = await client().from("messages").insert(row);
  if (error) throw friendlyFriendsError(error);
}

export function createSupabaseFriendsRepository(expectedPublicId: string): FriendsRepository {
  return {
    async load(): Promise<FriendsState> {
      const me = await currentUser();
      const { error } = await client().rpc("ensure_social_profile");
      if (error) throw friendlyFriendsError(error);
      const own = (await profiles([me.id]))[0];
      if (!own) throw new Error("Your profile is unavailable. Complete XOCRISK sign-in first.");
      if (own.publicId !== expectedPublicId) throw new Error("Your Supabase account doesn't match this trading account. Sign out and sign in with the same account.");
      const [friends, groups, requests, messages] = await Promise.all([
        getFriends(), getMyGroups(), client().from("friend_requests").select("id,from_id,to_id,status").order("created_at", { ascending: false }),
        getMessages(me.id),
      ]);
      if (requests.error) throw friendlyFriendsError(requests.error);
      const rows = requests.data as RequestRow[];
      const related = await profiles([...rows.flatMap((request) => [request.from_id, request.to_id]), ...groups.flatMap((g) => g.members)]);
      const users = [...new Map([...friends, ...related].filter((user) => user.id !== me.id).map((user) => [user.id, user])).values()];
      return { me: own, users, requests: rows.filter((r) => users.some((u) => u.id === (r.from_id === me.id ? r.to_id : r.from_id)))
        .map((r) => ({ id: r.id, from: r.from_id, to: r.to_id, status: r.status })),
        friendships: friends.map((friend) => ({ userA: me.id, userB: friend.id })), groups, messages };
    },
    async dispatch(action) {
      switch (action.type) {
        case "request": await sendRequest(action.userId); break;
        case "respond": await respondRequest(action.requestId, action.accept); break;
        case "remove": await removeFriend(action.userId); break;
        case "create-group": await createGroup(action.name, action.members); break;
        case "join-group": throw new Error("Only a group owner can add members. Ask the owner to invite you.");
        case "message": await sendMessage(action.thread, action.text); break;
      }
      return this.load();
    },
    searchUser: searchUserByPublicId,
    subscribe(onChange, onError) {
      let disposed = false;
      let channel: ReturnType<ReturnType<typeof client>["channel"]> | undefined;
      let auth: ReturnType<ReturnType<typeof client>["auth"]["onAuthStateChange"]> | undefined;
      try {
        const db = client();
        auth = db.auth.onAuthStateChange((event) => {
          if (event === "SIGNED_OUT" || event === "SIGNED_IN") setTimeout(() => { if (!disposed) onChange(); }, 0);
        });
        void currentUser().then((user) => {
          if (disposed) return;
          channel = db.channel(`friends-${user.id}-${crypto.randomUUID()}`)
            .on("postgres_changes", { event: "*", schema: "public", table: "friend_requests", filter: `to_id=eq.${user.id}` }, onChange)
            .on("postgres_changes", { event: "*", schema: "public", table: "friend_requests", filter: `from_id=eq.${user.id}` }, onChange)
            .on("postgres_changes", { event: "*", schema: "public", table: "friendships" }, onChange)
            .on("postgres_changes", { event: "*", schema: "public", table: "group_members" }, onChange)
            .on("postgres_changes", { event: "*", schema: "public", table: "group_notices" }, onChange)
            .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `to_id=eq.${user.id}` }, onChange)
            .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `from_id=eq.${user.id}` }, onChange)
            // Group messages carry no recipient id; Realtime still only delivers rows this member may read.
            .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `thread_type=eq.group` }, onChange)
            .subscribe((status) => {
              if (disposed) return;
              if (status === "SUBSCRIBED") onChange();
              if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") onError(new Error("Live updates disconnected. Refresh to check for new requests."));
            });
        }).catch((cause: Error) => { if (!disposed) onError(cause); });
      } catch (cause) { setTimeout(() => { if (!disposed) onError(cause as Error); }, 0); }
      return () => { disposed = true; auth?.data.subscription.unsubscribe(); if (channel) void client().removeChannel(channel); };
    },
  };
}
