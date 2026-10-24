"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Avatar, EmptyState, Icon, MyQr, QrScanner, SearchField, UserRow, type IconName } from "./components";
import { setScreenSecure } from "../../../lib/screen-security";
import { alphabet, createMockFriendsRepository, friendsOf, isLiveMessage, sectionOf, sortUsers, type FriendsAction, type FriendsRepository, type FriendsState, type User } from "./model";
import "./friends.css";

const subscribe = (callback: () => void) => { window.addEventListener("hashchange", callback); return () => window.removeEventListener("hashchange", callback); };
// "add-friend" is the standalone Add Friend section: it owns add/qr/scan; every other screen lives under #friends/.
export type FriendsBase = "friends" | "add-friend";
const own = new Set(["add", "qr", "scan"]);
const rootOf = (base: FriendsBase) => base === "add-friend" ? "add" : "chats";
const readRoute = (base: FriendsBase) => {
  const [head, ...rest] = window.location.hash.slice(1).split("/");
  return head === base && rest.join("/") || rootOf(base);
};
const screens = new Set(["chats", "contacts", "groups", "add", "requests", "search-groups", "select", "name", "qr", "scan", "notices", "thread"]);
const titles: Record<string, string> = { chats: "Chats", contacts: "Friends", groups: "Friends", add: "Add Friends", requests: "New Friends", "search-groups": "Search Group", select: "Select Friends", name: "Create Group", qr: "My QR Code", scan: "Scan to add", notices: "Group Notice", thread: "Chat" };
const id = () => crypto.randomUUID();
const displayId = (user: User) => user.publicId ?? user.id;

export default function FriendsView({ scope, base = "friends", createRepository = createMockFriendsRepository }: { scope: string; base?: FriendsBase; createRepository?: (scope: string) => FriendsRepository }) {
  const service = useMemo(() => createRepository(scope), [createRepository, scope]);
  const [state, setState] = useState<FriendsState | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const root = rootOf(base);
  const route = useSyncExternalStore(subscribe, () => readRoute(base), () => root);
  const [rawScreen, threadId] = route.split("/");
  const screen = screens.has(rawScreen) && (base === "friends" || own.has(rawScreen)) ? rawScreen : root;
  const [searchState, setSearchState] = useState({ route: "", value: "" });
  const query = searchState.route === route ? searchState.value : "";
  const setQuery = (value: string) => setSearchState({ route, value });
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [groupName, setGroupName] = useState("");
  const [message, setMessage] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [found, setFound] = useState<{ query: string; user: User | null; error?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  // Re-render every minute so chats vanish on screen as they pass 24 hours.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (screen !== "thread") return;
    void setScreenSecure(true);
    return () => { void setScreenSecure(false); };
  }, [screen]);
  useEffect(() => {
    let active = true;
    void service.load().then((next) => { if (active) setState(next); }).catch((cause) => { if (active) setLoadError(cause instanceof Error ? cause.message : "Friends couldn't load. Try again."); });
    return () => { active = false; };
  }, [service, loadAttempt]);
  useEffect(() => {
    let active = true;
    // Reload on live request/friendship/group changes so the New Friends badge stays current.
    const stop = service.subscribe?.(
      () => { void service.load().then((next) => { if (active) setState(next); }).catch(() => { /* Keep the last good state; the next action reports errors. */ }); },
      (cause) => { if (active) setStatus(cause.message); },
    );
    return () => { active = false; stop?.(); };
  }, [service]);
  useEffect(() => {
    const value = query.trim();
    if (screen !== "add" || !service.searchUser || !value) return;
    let active = true;
    const timer = setTimeout(() => {
      service.searchUser!(value).then((user) => { if (active) setFound({ query: value, user }); },
        (cause: Error) => { if (active) setFound({ query: value, user: null, error: cause.message }); });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [screen, query, service]);
  useEffect(() => {
    heading.current?.focus();
  }, [route]);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) setMenuOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setMenuOpen(false); menu.current?.querySelector<HTMLButtonElement>("button")?.focus(); } };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, [menuOpen]);

  function go(next: string) {
    setQuery(""); setStatus(""); setEditing(false); setMenuOpen(false);
    window.location.hash = base === "add-friend" && own.has(next) ? `add-friend${next === "add" ? "" : `/${next}`}` : `friends/${next}`;
  }
  async function act(action: FriendsAction, success: string) {
    if (busy) return false;
    setBusy(true);
    try { setState(await service.dispatch(action)); setStatus(success); return true; }
    catch (cause) { setStatus(cause instanceof Error ? cause.message : "Something went wrong. Try again."); return false; }
    finally { setBusy(false); }
  }
  async function requestByPublicId(publicId: string) {
    if (state && publicId === displayId(state.me)) { setStatus("That's your own QR code. Scan a friend's code instead."); return false; }
    if (!service.searchUser) return act({ type: "request", userId: publicId }, "QR scanned. Friend request sent.");
    try {
      const user = await service.searchUser(publicId);
      if (!user) { setStatus("No XOCRISK user has this ID."); return false; }
      return act({ type: "request", userId: user.id }, `QR scanned. Request sent to ${user.nickname}.`);
    } catch (cause) { setStatus(cause instanceof Error ? cause.message : "Couldn't look up this ID. Try again."); return false; }
  }
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setStatus("User ID copied."); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { setStatus("Couldn't copy. Press and hold the ID to copy it manually."); }
  }
  async function invite() {
    const url = `${process.env.NEXT_PUBLIC_APP_INVITE_URL || "https://xocrisk.dpdns.org/signup/"}`;
    try {
      if (navigator.share) await navigator.share({ title: "Join me on XOCRISK", text: "Practice trading and learn with friends on XOCRISK.", url });
      else { await navigator.clipboard.writeText(url); setStatus("Invite link copied. Share it with a friend."); }
    } catch (cause) { if (!(cause instanceof DOMException && cause.name === "AbortError")) setStatus("Couldn't share. Try again or copy the app link."); }
  }
  if (!state) return <section className="fg-shell"><p role="status">{loadError || "Loading friends…"}</p>{loadError && <button type="button" className="xq-btn" onClick={() => { setLoadError(""); setLoadAttempt((n) => n + 1); }}>Try again</button>}</section>;

  const friends = friendsOf(state);
  const messages = service.sample ? state.messages : state.messages.filter((m) => isLiveMessage(m, now));
  const needle = query.trim().toLowerCase();
  const filteredFriends = friends.filter((user) => `${user.nickname} ${screen === "select" ? "" : displayId(user)}`.toLowerCase().includes(needle));
  const searchQuery = query.trim();
  const searching = !!service.searchUser && !!searchQuery && found?.query !== searchQuery;
  const isFriend = (user: User) => friends.some((f) => f.id === user.id);
  const candidates = service.searchUser && searchQuery
    ? (!searching && found?.user && !isFriend(found.user) ? [found.user] : [])
    : state.users.filter((user) => !isFriend(user) && displayId(user).toLowerCase().includes(needle));
  const joined = state.groups.filter((group) => group.members.includes(state.me.id));
  const incoming = state.requests.filter((request) => request.to === state.me.id && request.status === "pending");
  const outgoing = state.requests.filter((request) => request.from === state.me.id && request.status === "pending");
  const threadUser = state.users.find((user) => user.id === threadId);
  const threadGroup = state.groups.find((group) => group.id === threadId && group.members.includes(state.me.id));
  const validThread = threadGroup || friends.find((friend) => friend.id === threadId);
  const back = () => go(screen === "name" ? "select" : ["qr", "scan"].includes(screen) ? "add" : screen === "requests" ? "contacts" : "chats");
  const actionButton = (label: string, icon: IconName, onClick: () => void) => <button key={label} type="button" onClick={onClick}><span><Icon name={icon} /></span>{label}</button>;

  return <section className="fg-shell" aria-label="Friends and groups">
    <div className="fg-kicker">YOUR TRADING CIRCLE {service.sample && <span>Sample data</span>}</div>
    <header className="fg-header">
      {screen !== root && <button type="button" className="fg-icon-btn" aria-label="Back" onClick={back}><Icon name="back" /></button>}
      <h1 tabIndex={-1} ref={heading}>{screen === "thread" ? threadGroup?.name || threadUser?.nickname || "Chat" : titles[screen]}</h1>
      {screen === "chats" && <div className="fg-menu-anchor" ref={menu}><button type="button" className="fg-icon-btn fg-add" aria-label="New chat options" aria-expanded={menuOpen} aria-controls="fg-actions" onClick={() => setMenuOpen(!menuOpen)}><Icon name="plus" /></button>
        {menuOpen && <div className="fg-menu" id="fg-actions" aria-label="New chat options">{([
          ["Add Friend", "friend", "add"], ["Search Group", "search", "search-groups"], ["Create Group", "group", "select"], ["Scan", "scan", "scan"],
        ] as const).map(([label, icon, destination]) => <button type="button" key={label} onClick={() => { if (destination === "select") { setSelected([]); setGroupName(""); } go(destination); }}><Icon name={icon} />{label}</button>)}</div>}</div>}
      {["contacts", "groups"].includes(screen) && <button className="fg-text-btn" type="button" disabled={screen === "groups" || !friends.length} onClick={() => setEditing(!editing)}>{editing ? "Done" : "Edit"}</button>}
      {screen === "select" && <button className="fg-text-btn" type="button" disabled={!selected.length} onClick={() => go("name")}>Confirm{selected.length > 0 && ` (${selected.length})`}</button>}
    </header>
    {screen === "chats" && <>
      <button type="button" className="fg-directory" onClick={() => go("contacts")}><span className="fg-tile"><Icon name="group" /></span><span><strong>Friends & Groups</strong><small>{friends.length} friends · {joined.length} groups</small></span>{incoming.length > 0 && <em>{incoming.length}</em>}<Icon name="chevron" /></button>
      <div className="fg-section-label">RECENT CHATS</div>
      <div className="fg-list">{[...new Set(messages.map((item) => item.thread))].filter((thread) => friends.some((user) => user.id === thread) || joined.some((g) => g.id === thread)).sort((a, b) => (messages.filter((m) => m.thread === b).at(-1)?.createdAt ?? "").localeCompare(messages.filter((m) => m.thread === a).at(-1)?.createdAt ?? "")).map((thread) => {
        const user = state.users.find((u) => u.id === thread);
        const group = joined.find((g) => g.id === thread);
        const latest = messages.filter((m) => m.thread === thread).at(-1)!;
        return <button type="button" className="fg-chat-row" key={thread} onClick={() => go(`thread/${thread}`)}><Avatar user={user || { id: thread, nickname: group!.name, avatar: "G" }} /><span><strong>{user?.nickname || group?.name}</strong><small>{latest.text}</small></span><Icon name="chevron" /></button>;
      })}</div>
      {!messages.some((m) => friends.some((u) => u.id === m.thread) || joined.some((g) => g.id === m.thread)) && <EmptyState title="Start a conversation" detail="Find a friend or create a group using +." />}
      <p className="fg-note">A little company for your market journey.</p>
    </>}

    {["contacts", "groups"].includes(screen) && <nav className="fg-tabs" aria-label="Contact categories"><button aria-current={screen === "contacts" ? "page" : undefined} type="button" onClick={() => go("contacts")}>Friends <small>{friends.length}</small></button><button type="button" aria-current={screen === "groups" ? "page" : undefined} onClick={() => go("groups")}>Group Chat <small>{joined.length}</small></button></nav>}

    {screen === "contacts" && <>
      <SearchField value={query} onChange={setQuery} placeholder="Search Nickname or ID" />
      <button className="fg-directory" type="button" onClick={() => go("requests")}><span className="fg-tile"><Icon name="friend" /></span><strong>New Friends</strong>{incoming.length > 0 && <em>{incoming.length}</em>}<Icon name="chevron" /></button>
      <div className="fg-section-label">{filteredFriends.length} FRIENDS</div>
      <div className="fg-list">{filteredFriends.map((user) => <UserRow key={user.id} user={user} onClick={editing ? undefined : () => go(`thread/${user.id}`)}>{editing && <button className="fg-remove" type="button" disabled={busy} onClick={() => { if (window.confirm(`Remove ${user.nickname} from friends?`)) void act({ type: "remove", userId: user.id }, "Friend removed."); }}>Remove</button>}</UserRow>)}</div>
      {!filteredFriends.length && <EmptyState title="No friends found" detail="Try another nickname or ID, or add a new friend." />}
    </>}
    {screen === "groups" && <>
      <SearchField value={query} onChange={setQuery} placeholder="Search Group name or ID" />
      <button className="fg-directory" type="button" onClick={() => go("notices")}><span className="fg-tile"><Icon name="bell" /></span><strong>Group Notice</strong><Icon name="chevron" /></button>
      {joined.filter((g) => `${g.name} ${g.id}`.toLowerCase().includes(needle)).map((group) => <UserRow key={group.id} user={{ id: group.id, nickname: group.name, avatar: "G" }} onClick={() => go(`thread/${group.id}`)}><small>{group.members.length} members</small></UserRow>)}
      {!joined.length ? <EmptyState title="You haven't joined any group chats yet" detail="Create a space for your friends to learn together."><button type="button" className="xq-btn primary" onClick={() => { setSelected([]); go("select"); }}>Create Group</button></EmptyState> : !joined.some((g) => `${g.name} ${g.id}`.toLowerCase().includes(needle)) && <EmptyState title="No groups found" detail="Try another group name or ID." />}
    </>}
    {screen === "add" && <>
      <SearchField value={query} onChange={setQuery} placeholder="Search User ID" />
      <div className="fg-ownid">My ID: <code>{displayId(state.me)}</code><button type="button" className="fg-icon-btn" aria-label={copied ? "User ID copied" : "Copy my user ID"} onClick={() => void copy(displayId(state.me))}><Icon name={copied ? "check" : "copy"} /></button></div>
      <div className="fg-quick-actions">{actionButton("My QR Code", "qr", () => go("qr"))}{actionButton("Scan to add", "scan", () => go("scan"))}{actionButton("Invite Friends", "invite", () => void invite())}</div>
      <div className="fg-section-label">{query ? "SEARCH RESULTS" : "PEOPLE YOU MAY KNOW"}</div>
      {searching && <p className="fg-subtitle" role="status">Searching…</p>}
      {sortUsers(candidates).map((user) => {
        const pending = state.requests.find((r) => r.status === "pending" && (r.from === user.id && r.to === state.me.id || r.from === state.me.id && r.to === user.id));
        return <UserRow key={user.id} user={user}>{pending?.to === state.me.id ? <button type="button" className="fg-text-btn" onClick={() => go("requests")}>Respond</button> : <button type="button" className="fg-pill" disabled={busy || !!pending} onClick={() => void act({ type: "request", userId: user.id }, `Request sent to ${user.nickname}.`)}>{pending ? "Pending" : "Add"}</button>}</UserRow>;
      })}
      {searchQuery && !searching && !candidates.length && <EmptyState title="No new users found" detail={service.sample ? "Try a sample ID such as FR000011. Existing friends are in Friends." : found?.error || "Check the ID and try again. Existing friends are in Friends."} />}
    </>}
    {screen === "requests" && <>
      <p className="fg-subtitle">A new connection starts with a hello.</p>
      {incoming.map((request) => <UserRow key={request.id} user={state.users.find((user) => user.id === request.from)!}><div className="fg-request-actions"><button type="button" className="fg-pill" disabled={busy} onClick={() => void act({ type: "respond", requestId: request.id, accept: true }, "Friend request accepted.")}>Accept</button><button type="button" className="fg-text-btn" disabled={busy} onClick={() => void act({ type: "respond", requestId: request.id, accept: false }, "Friend request rejected.")}>Reject</button></div></UserRow>)}
      {!incoming.length && <EmptyState title="You're all caught up" detail="New friend requests will appear here." />}
      {outgoing.length > 0 && <><div className="fg-section-label">SENT REQUESTS</div>{outgoing.map((r) => <UserRow key={r.id} user={state.users.find((u) => u.id === r.to)!}><small>Pending</small></UserRow>)}</>}
    </>}
    {screen === "search-groups" && <>
      <SearchField value={query} onChange={setQuery} placeholder="Search Group name or ID" />
      <div className="fg-section-label">DISCOVER GROUPS</div>
      {state.groups.filter((g) => `${g.name} ${g.id}`.toLowerCase().includes(needle)).map((group) => <UserRow key={group.id} user={{ id: group.id, nickname: group.name, avatar: "G" }}>{group.members.includes(state.me.id) ? <button type="button" className="fg-text-btn" onClick={() => go(`thread/${group.id}`)}>Open</button> : <button type="button" className="fg-pill" disabled={busy} onClick={() => void act({ type: "join-group", groupId: group.id }, `Joined ${group.name}.`)}>Join</button>}</UserRow>)}
      {!state.groups.some((g) => `${g.name} ${g.id}`.toLowerCase().includes(needle)) && <EmptyState title="No groups found" detail={service.sample ? "Try Group 1 or GR000001." : "Ask a group owner to add you."} />}
    </>}
    {screen === "select" && <>
      <SearchField value={query} onChange={setQuery} placeholder="Search Nickname" />
      <p className="fg-subtitle">Choose friends for your new group. {selected.length} selected.</p>
      <div className="fg-selection"><div>{alphabet.filter((letter) => filteredFriends.some((u) => sectionOf(u.nickname) === letter)).map((letter) => <section key={letter} id={`fg-letter-${letter}`}><h2 className="fg-section-label">{letter}</h2>{filteredFriends.filter((u) => sectionOf(u.nickname) === letter).map((user) => <label className="fg-row fg-select-row" key={user.id}><input type="checkbox" checked={selected.includes(user.id)} onChange={(e) => setSelected((current) => e.target.checked ? [...current, user.id] : current.filter((value) => value !== user.id))} /><Avatar user={user} /><span>{user.nickname}</span></label>)}</section>)}{!filteredFriends.length && <EmptyState title="No friends found" detail="Try another nickname or add friends first." />}</div>
        <nav className="fg-alphabet" aria-label="Jump to letter">{alphabet.map((letter) => <button key={letter} type="button" disabled={!filteredFriends.some((u) => sectionOf(u.nickname) === letter)} aria-label={`Jump to ${letter}`} onClick={() => document.getElementById(`fg-letter-${letter}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}>{letter}</button>)}</nav></div>
    </>}
    {screen === "name" && <form className="fg-group-form" onSubmit={(event) => { event.preventDefault(); const groupId = `GR${id().replaceAll("-", "").slice(0, 8).toUpperCase()}`; void act({ type: "create-group", name: groupName, members: selected, id: groupId }, "Group created.").then((ok) => { if (ok) { setSelected([]); setGroupName(""); go(service.sample ? `thread/${groupId}` : "groups"); } }); }}><span className="fg-group-symbol"><Icon name="group" /></span><label htmlFor="fg-group-name">Group name</label><input autoFocus id="fg-group-name" maxLength={50} placeholder="Give your group a name" value={groupName} onChange={(e) => setGroupName(e.target.value)} /><p>{selected.length} friends selected</p><div className="fg-selected-avatars">{friends.filter((u) => selected.includes(u.id)).map((user) => <Avatar key={user.id} user={user} />)}</div><button type="submit" className="xq-btn primary" disabled={busy || !groupName.trim() || !selected.length}>Create Group</button>{!selected.length && <button type="button" className="fg-text-btn" onClick={() => go("select")}>Select friends first</button>}</form>}
    {screen === "qr" && <MyQr uid={displayId(state.me)} />}
    {screen === "scan" && <QrScanner onScan={(uid) => { go("add"); void requestByPublicId(uid); }} />}
    {screen === "notices" && <>{joined.map((g) => <article className="fg-notice" key={g.id}><span className="fg-tile"><Icon name="bell" /></span><div><h2>{g.name}</h2><p>{g.notice}</p></div></article>)}{!joined.length && <EmptyState title="No group notices yet" detail="Join a group to see its updates here." />}</>}
    {screen === "thread" && (validThread ? <>
      <p className="fg-subtitle">{threadGroup ? `${threadGroup.members.length} members · ${threadGroup.id}` : threadUser && displayId(threadUser)}</p>
      <p className="fg-ephemeral">Messages disappear 24 hours after they&apos;re sent and can&apos;t be copied or saved.</p>
      <div className="fg-messages" role="log" aria-label={service.sample ? "Sample chat messages" : "Chat messages"} onCopy={(e) => e.preventDefault()} onCut={(e) => e.preventDefault()} onContextMenu={(e) => e.preventDefault()} onDragStart={(e) => e.preventDefault()}>{messages.filter((m) => m.thread === threadId).map((m) => <div key={m.id} className={`fg-message ${m.from === state.me.id ? "mine" : ""}`}><small>{m.from === state.me.id ? "You" : state.users.find((u) => u.id === m.from)?.nickname}</small><p>{m.text}</p></div>)}{!messages.some((m) => m.thread === threadId) && <EmptyState title="Say hello" detail="This is the beginning of your conversation." />}</div>
      <form className="fg-compose" onSubmit={(e) => { e.preventDefault(); void act({ type: "message", thread: threadId, text: message, id: id(), createdAt: new Date().toISOString() }, service.sample ? "Sample message saved." : "Message sent.").then((ok) => { if (ok) setMessage(""); }); }}><input aria-label="Message" maxLength={1000} placeholder="Write a message…" value={message} onChange={(e) => setMessage(e.target.value)} /><button type="submit" className="fg-pill" disabled={busy || !message.trim()}>Send</button></form>
    </> : <EmptyState title="Chat unavailable" detail="Add this friend or join the group first." />)}
    <div className="fg-feedback" role="status" aria-live="polite">{status}</div>
    {service.sample && <footer className="fg-footer">Sample conversations and requests stay on this device.</footer>}
  </section>;
}
