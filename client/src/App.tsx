import { useState } from "react";
import { login, listRooms, logout } from "./api";
import type { RoomSummary } from "./bindings/RoomSummary";

// Phase 1 skeleton UI: log in to a homeserver, then list rooms. This exists to
// prove the Rust <-> TS boundary end to end. The real unified inbox, message
// view, and multi-account UI come next.
export default function App() {
  const [homeserver, setHomeserver] = useState("http://localhost:8008");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const id = await login(homeserver, username, password);
      setUserId(id);
      await refreshRooms();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function refreshRooms() {
    try {
      setRooms(await listRooms());
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleLogout() {
    await logout();
    setUserId(null);
    setRooms([]);
  }

  if (!userId) {
    return (
      <main className="center">
        <h1>beep-beep</h1>
        <p className="muted">Sign in to your homeserver</p>
        <form onSubmit={handleLogin} className="card">
          <label>
            Homeserver
            <input value={homeserver} onChange={(e) => setHomeserver(e.target.value)} />
          </label>
          <label>
            Username
            <input value={username} onChange={(e) => setUsername(e.target.value)} />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button disabled={busy} type="submit">
            {busy ? "Signing in…" : "Sign in"}
          </button>
          {error && <p className="error">{error}</p>}
        </form>
      </main>
    );
  }

  return (
    <main>
      <header className="topbar">
        <span>
          Signed in as <strong>{userId}</strong>
        </span>
        <div>
          <button onClick={refreshRooms}>Refresh</button>
          <button onClick={handleLogout}>Sign out</button>
        </div>
      </header>
      {error && <p className="error">{error}</p>}
      <ul className="rooms">
        {rooms.length === 0 && <li className="muted">No rooms yet (sync may still be running).</li>}
        {rooms.map((r) => (
          <li key={r.id} className="room">
            <span className="room-name">{r.name ?? r.id}</span>
            {r.unread > 0 && <span className="badge">{r.unread}</span>}
          </li>
        ))}
      </ul>
    </main>
  );
}
