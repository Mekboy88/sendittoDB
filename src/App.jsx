import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  Ban,
  Contact,
  Database,
  FileText,
  Globe,
  Grid3x3,
  Inbox,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Mail,
  Megaphone,
  RefreshCw,
  Server,
  Shield,
  ShieldCheck,
  Table2,
  Users,
  Layers,
  ScrollText,
  Settings,
  Webhook,
  Brain,
  Send,
  BarChart3,
} from "lucide-react";
import { api, emitDataChange, loadSession, openRealtime, redact, saveSession } from "./api.js";
import { roleLabel } from "./roles.js";
import { AppDialogsProvider, Banner, Pill } from "./ui.jsx";
import {
  AuditPage,
  DomainsPage,
  KeysPage,
  MatrixPage,
  MessagesPage,
  OverviewPage,
  RightsPage,
  ServerPage,
  SessionsPage,
  SettingsPage,
  SuppressionsPage,
  TablesPage,
  UsersPage,
  WorkspacesPage,
} from "./pages.jsx";
import { AIBrainPage } from "./pages-ai.jsx";
import { SendingSetupPage } from "./pages-sending.jsx";
import { ActivityPage } from "./pages-activity.jsx";
import { AnalyticsPage } from "./pages-analytics.jsx";
import { SendPage } from "./pages-send.jsx";
import {
  CampaignsPage,
  ContactsPage,
  InboxPage,
  TemplatesPage,
  WebhooksPage,
  WorkspaceMatrixPage,
} from "./pages-platform.jsx";

const THEME_KEY = "senditto_db_studio_theme";
const POLL_KEY = "senditto_db_studio_poll";
const PAGE_KEY = "senditto_db_studio_page";

/** Resolve Auto → light|dark from OS, else by local clock (day 7–19 light). */
export function resolveTheme(pref) {
  if (pref === "light" || pref === "dark") return pref;
  try {
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
    if (window.matchMedia("(prefers-color-scheme: light)").matches) return "light";
  } catch {
    /* ignore */
  }
  const h = new Date().getHours();
  return h >= 7 && h < 19 ? "light" : "dark";
}

function loadThemePref() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === "light" || t === "dark" || t === "auto") return t;
    // Migrate removed Chimney Dust / grey → Auto
    if (t === "grey") return "auto";
  } catch {
    /* ignore */
  }
  return "auto";
}

function shellColor(resolved) {
  return resolved === "dark" ? "#12151a" : "#f6f7f9";
}

const NAV = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, group: "Core" },
  { id: "tables", label: "Tables", icon: Table2, group: "Core" },
  { id: "workspaces", label: "User workspaces", icon: Layers, group: "Platform" },
  { id: "users", label: "Users", icon: Users, group: "Platform" },
  { id: "matrix", label: "Matrix", icon: Grid3x3, group: "Platform" },
  { id: "wsroles", label: "Workspace roles", icon: ShieldCheck, group: "Platform" },
  { id: "domains", label: "Domains", icon: Globe, group: "Platform" },
  { id: "keys", label: "API keys", icon: KeyRound, group: "Platform" },
  { id: "messages", label: "Messages", icon: Mail, group: "Platform" },
  { id: "send", label: "Send email", icon: Mail, group: "Platform" },
  { id: "activity", label: "Email activity", icon: Activity, group: "Platform" },
  { id: "analytics", label: "Analytics", icon: BarChart3, group: "Platform" },
  { id: "contacts", label: "Contacts", icon: Contact, group: "Product" },
  { id: "templates", label: "Templates", icon: FileText, group: "Product" },
  { id: "campaigns", label: "Campaigns", icon: Megaphone, group: "Product" },
  { id: "webhooks", label: "Webhooks", icon: Webhook, group: "Product" },
  { id: "inbox", label: "Operator inbox", icon: Inbox, group: "Product" },
  { id: "suppressions", label: "Suppressions", icon: Ban, group: "Compliance" },
  { id: "audit", label: "Audit log", icon: ScrollText, group: "Compliance" },
  { id: "rights", label: "Rights requests", icon: Shield, group: "Compliance" },
  { id: "sending", label: "Sending setup", icon: Send, group: "Ops" },
  { id: "brain", label: "AI Brain", icon: Brain, group: "Ops" },
  { id: "server", label: "Server health", icon: Server, group: "Ops" },
  { id: "sessions", label: "Sessions", icon: Activity, group: "Ops" },
  { id: "settings", label: "Settings", icon: Settings, group: "Ops" },
];

function Login({ onLogin }) {
  const [email, setEmail] = useState(import.meta.env.VITE_DEFAULT_EMAIL || "");
  const [password, setPassword] = useState(import.meta.env.VITE_DEFAULT_PASSWORD || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const data = await api("/api/auth/login", {
        method: "POST",
        body: { email, password, purpose: "studio" },
      });
      const session = { token: data.token, expiresAt: data.expiresAt, user: data.user };
      saveSession(session);
      onLogin(session);
    } catch (ex) {
      setErr(redact(ex.message || "Login failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="brand" style={{ border: 0, padding: 0, marginBottom: 14 }}>
          <div className="brand-mark">S</div>
          <div>
            <b>Senditto Database</b>
            <small>Realtime operator studio</small>
          </div>
        </div>
        <h1>Sign in</h1>
        <p>
          Authenticate against the live Senditto control database. This studio is separate from the
          email product UI — network addresses are never shown.
        </p>
        {err ? <Banner tone="bad">{err}</Banner> : null}
        <div className="form">
          <label className="full">
            <span className="lbl">Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </label>
          <label className="full">
            <span className="lbl">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </label>
        </div>
        <div style={{ marginTop: 16 }}>
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in to database studio"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(() => loadSession());
  // Come back to the page you were on, not to Overview, after a refresh.
  const [page, setPage] = useState(() => {
    try {
      const saved = localStorage.getItem(PAGE_KEY);
      return NAV.some((n) => n.id === saved) ? saved : "overview";
    } catch {
      return "overview";
    }
  });
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState("");
  const [liveAt, setLiveAt] = useState(null);
  const [events, setEvents] = useState([]);
  const [rtState, setRtState] = useState("connecting");
  // Preference: light | dark | auto (never grey)
  const [themePref, setThemePref] = useState(() => loadThemePref());
  const [resolvedTheme, setResolvedTheme] = useState(() => resolveTheme(loadThemePref()));
  const [pollMs, setPollMs] = useState(() => {
    try {
      const v = Number(localStorage.getItem(POLL_KEY));
      return [5000, 10000, 30000, 60000].includes(v) ? v : 10000;
    } catch {
      return 10000;
    }
  });

  const changePoll = useCallback((v) => {
    setPollMs(v);
    try {
      localStorage.setItem(POLL_KEY, String(v));
    } catch {
      /* ignore */
    }
  }, []);

  const token = session?.token;

  useEffect(() => {
    try {
      localStorage.setItem(PAGE_KEY, page);
    } catch {
      /* private mode */
    }
  }, [page]);

  // Apply resolved light/dark; re-check system + clock while on Auto
  useEffect(() => {
    const apply = () => {
      const resolved = resolveTheme(themePref);
      setResolvedTheme(resolved);
      document.documentElement.setAttribute("data-theme", resolved);
      const shell = shellColor(resolved);
      document.documentElement.style.background = shell;
      document.documentElement.style.backgroundImage = "none";
      if (document.body) {
        document.body.style.background = shell;
        document.body.style.backgroundImage = "none";
      }
    };
    apply();
    try {
      localStorage.setItem(THEME_KEY, themePref);
    } catch {
      /* ignore */
    }

    if (themePref !== "auto") return undefined;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply();
    mq.addEventListener?.("change", onChange);
    mq.addListener?.(onChange);
    // Re-check every minute so day/night time boundary is respected
    const tick = window.setInterval(apply, 60_000);
    return () => {
      mq.removeEventListener?.("change", onChange);
      mq.removeListener?.(onChange);
      window.clearInterval(tick);
    };
  }, [themePref]);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const data = await api("/api/stats", { token });
      setOverview(data);
      setError("");
      setLiveAt(data.checkedAt || new Date().toISOString());
    } catch (e) {
      setError(redact(e.message));
      if (/Unauthorized/i.test(e.message)) {
        saveSession(null);
        setSession(null);
      }
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    refresh();
    const stop = openRealtime(token, (ev) => {
      setRtState(ev.type === "error" ? "error" : "live");
      setLiveAt(ev.at || new Date().toISOString());
      if (ev.type === "overview" && ev.data) setOverview(ev.data);
      // Any write anywhere refreshes the pages reading that data.
      if (ev.type === "change") emitDataChange(ev.collection);
      setEvents((prev) => [{ ...ev, at: ev.at || new Date().toISOString() }, ...prev].slice(0, 100));
    });
    const poll = setInterval(refresh, pollMs);
    return () => {
      stop();
      clearInterval(poll);
    };
  }, [token, refresh, pollMs]);

  async function logout() {
    try {
      if (token) await api("/api/auth/logout", { method: "POST", token });
    } catch {
      /* ignore */
    }
    saveSession(null);
    setSession(null);
  }

  if (!session?.token) {
    return (
      <AppDialogsProvider>
        <div className="app app-login" data-theme={resolvedTheme}>
          <Login onLogin={setSession} />
          <div id="app-layer" className="app-layer" />
        </div>
      </AppDialogsProvider>
    );
  }

  const title = NAV.find((n) => n.id === page)?.label || "Database";
  const groups = [...new Set(NAV.map((n) => n.group))];

  return (
    <AppDialogsProvider>
    <div className="app" data-theme={resolvedTheme}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">S</div>
          <div>
            <b>Senditto Database</b>
            <small>Realtime studio</small>
          </div>
        </div>
        {groups.map((g) => (
          <div key={g} className="nav-group">
            <small>{g}</small>
            {NAV.filter((n) => n.group === g).map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`nav-btn ${page === item.id ? "active" : ""}`}
                  onClick={() => setPage(item.id)}
                >
                  <Icon size={16} />
                  {item.label}
                </button>
              );
            })}
          </div>
        ))}
        <div className="side-meta">
          <b>{session.user?.displayName || session.user?.email}</b>
          {roleLabel(session.user?.role || "operator")} · network hidden
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div>
            <h1>{title}</h1>
            <p>Owner &amp; admin console — data that powers the product</p>
          </div>
          <div className="top-actions">
            <Pill
              ok={rtState === "live" ? true : rtState === "error" ? false : null}
              label={rtState === "live" ? "Realtime live" : rtState === "error" ? "Realtime down" : "Connecting…"}
            />
            <Pill ok={!error && !!overview?.ok} label={error ? "API issue" : overview?.ok ? "DB healthy" : "…"} />
            <button className="btn" type="button" onClick={refresh}>
              <RefreshCw size={15} /> Refresh
            </button>
            <button className="btn" type="button" onClick={logout}>
              <LogOut size={15} /> Sign out
            </button>
          </div>
        </header>
        <main className="content">
          {error ? <Banner tone="bad">{error}</Banner> : null}

          {page === "overview" ? (
            <OverviewPage
              overview={overview}
              liveAt={liveAt}
              events={events}
              token={token}
              onRefresh={refresh}
              onNavigate={setPage}
            />
          ) : null}
          {page === "brain" ? <AIBrainPage token={token} session={session} /> : null}
          {page === "sending" ? <SendingSetupPage token={token} session={session} /> : null}
          {page === "send" ? <SendPage token={token} /> : null}
          {page === "activity" ? <ActivityPage token={token} /> : null}
          {page === "analytics" ? <AnalyticsPage token={token} /> : null}
          {page === "tables" ? <TablesPage token={token} overview={overview} /> : null}
          {page === "workspaces" ? <WorkspacesPage token={token} onChanged={refresh} /> : null}
          {page === "users" ? (
            <UsersPage token={token} session={session} onChanged={refresh} />
          ) : null}
          {page === "matrix" ? (
            <MatrixPage token={token} session={session} onNavigate={setPage} />
          ) : null}
          {page === "wsroles" ? <WorkspaceMatrixPage token={token} onChanged={refresh} /> : null}
          {page === "contacts" ? <ContactsPage token={token} onChanged={refresh} /> : null}
          {page === "templates" ? <TemplatesPage token={token} onChanged={refresh} /> : null}
          {page === "campaigns" ? <CampaignsPage token={token} onChanged={refresh} /> : null}
          {page === "webhooks" ? <WebhooksPage token={token} onChanged={refresh} /> : null}
          {page === "inbox" ? <InboxPage token={token} session={session} onChanged={refresh} /> : null}
          {page === "domains" ? <DomainsPage token={token} onChanged={refresh} /> : null}
          {page === "keys" ? (
            <KeysPage token={token} session={session} events={events} onChanged={refresh} />
          ) : null}
          {page === "messages" ? (
            <MessagesPage token={token} session={session} events={events} onChanged={refresh} />
          ) : null}
          {page === "suppressions" ? (
            <SuppressionsPage token={token} session={session} events={events} onChanged={refresh} />
          ) : null}
          {page === "audit" ? (
            <AuditPage token={token} events={events} rtState={rtState} onChanged={refresh} />
          ) : null}
          {page === "rights" ? (
            <RightsPage token={token} events={events} onChanged={refresh} />
          ) : null}
          {page === "server" ? (
            <ServerPage
              overview={overview}
              liveAt={liveAt}
              rtState={rtState}
              token={token}
              onRefresh={refresh}
            />
          ) : null}
          {page === "sessions" ? (
            <SessionsPage
              token={token}
              session={session}
              rtState={rtState}
              onLogout={logout}
              onNavigate={setPage}
            />
          ) : null}
          {page === "settings" ? (
            <SettingsPage
              themePref={themePref}
              resolvedTheme={resolvedTheme}
              onThemeChange={setThemePref}
              pollMs={pollMs}
              onPollChange={changePoll}
            />
          ) : null}
        </main>
      </div>
      <div id="app-layer" className="app-layer" />
    </div>
    </AppDialogsProvider>
  );
}
