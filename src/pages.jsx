import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  ArrowLeft,
  Ban,
  BookOpen,
  Building2,
  Check,
  Columns3,
  Database,
  Download,
  Fingerprint,
  Globe,
  Globe2,
  Grid3x3,
  HardDrive,
  IdCard,
  KeyRound,
  Layers,
  Link2,
  Lock,
  Mail,
  MoreHorizontal,
  Pause,
  Phone,
  Play,
  Plus,
  Power,
  RefreshCw,
  Rows3,
  Search,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  Table2,
  Terminal,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { api, fmtClock, fmtDate, fmtIso, fmtNum, fmtTime, onDataChange, redact } from "./api.js";
import {
  CREATE_SAFE_ROLES,
  DEFAULT_ROLE_MATRIX,
  DEFAULT_WORKSPACE_MATRIX,
  PERMISSIONS,
  PLATFORM_ROLE_IDS,
  PLATFORM_ROLES,
  WORKSPACE_PERMISSIONS,
  WORKSPACE_ROLES,
  applyHardLocks,
  can,
  cellLockReason,
  cloneMatrix,
  cloneWorkspaceMatrix,
  copyMatrixRole,
  countRoleAllows,
  isCellLocked,
  matrixDiffCount,
  matrixDiffList,
  roleLabel,
  roleTone,
  setMatrixCell,
  setMatrixColumn,
} from "./roles.js";
import {
  ActivityChart,
  AppSelect,
  Banner,
  BarChart,
  BulkBar,
  BulkSelectCell,
  BulkSelectHeader,
  CopyButton,
  Donut,
  Field,
  Modal,
  PageHead,
  Panel,
  PagedDataTable,
  StatGrid,
  TablePager,
  TableShell,
  runBulk,
  useAppConfirm,
  useBulkSelection,
  useClientPager,
  useCopyFeedback,
  fmt,
} from "./ui.jsx";

export function useEntity(token, path) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const data = await api(path, { token });
      setRows(data.rows || []);
      setTotal(data.total ?? (data.rows || []).length);
    } catch (e) {
      setErr(redact(e.message));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [path, token]);
  useEffect(() => {
    load();
  }, [load]);

  // Refresh when the database reports a change to this collection (or to a
  // table this page is reading), so every page stays live without polling.
  useEffect(() => {
    let timer = null;
    return onDataChange((collection) => {
      const watching =
        !collection ||
        path.endsWith(`/${collection}`) ||
        path.startsWith("/api/db/tables/") ||
        path.startsWith("/api/audit");
      if (!watching) return;
      clearTimeout(timer);
      timer = setTimeout(load, 200);
    });
  }, [path, load]);

  return { rows, total, err, loading, load };
}

export function OverviewPage({ overview, liveAt, events, token, onRefresh, onNavigate }) {
  const c = overview?.counts || {};
  const r = overview?.rates || {};
  const charts = overview?.charts || {};
  const p = overview?.postgres || {};

  const colors = ["#7aa8f5", "#5fd4a2", "#e8b84a", "#f08080", "#a898f5", "#94a3b8"];
  const statusSeg = (charts.messagesByStatus || []).map((x, i) => ({
    label: x.status,
    value: Number(x.n || 0),
    color: colors[i % colors.length],
  }));

  const readiness = useMemo(() => {
    const checks = [
      { ok: (c.users || 0) > 0, label: "Operators exist" },
      { ok: (c.workspaces || 0) > 0, label: "Workspace ready" },
      { ok: (c.domains || 0) > 0, label: "Sending domain added" },
      { ok: (c.domains_verified || 0) > 0, label: "Domain verified" },
      { ok: (c.api_keys_active || 0) > 0, label: "Active API key" },
      { ok: (c.messages || 0) > 0, label: "Message pipeline used" },
      { ok: (c.suppressions || 0) >= 0, label: "Suppression store ready" },
      { ok: (c.audit_events || 0) > 0, label: "Audit trail active" },
    ];
    const score = Math.round((checks.filter((x) => x.ok).length / checks.length) * 100);
    return { checks, score };
  }, [c]);

  return (
    <>
      <PageHead
        title="Overview"
        copy="Snapshot of platform activity: messages, users, domains, and health."
        actions={
          <button className="btn" type="button" onClick={onRefresh}>
            <RefreshCw size={15} /> Refresh now
          </button>
        }
      />
      {liveAt ? (
        <Banner tone="ok">Last update {new Date(liveAt).toLocaleTimeString()}.</Banner>
      ) : null}

      <StatGrid
        items={[
          {
            label: "Platform readiness",
            value: `${readiness.score}%`,
            hint: "Setup completeness across core services",
            tone: "blue",
            bar: readiness.score,
          },
          {
            label: "Messages",
            value: fmtNum(c.messages),
            hint: `${fmtNum(c.messages_queued)} queued · ${fmtNum(c.messages_delivered)} delivered`,
            tone: "blue",
            bar: Math.min(100, (c.messages || 0) * 5),
          },
          {
            label: "Delivery rate",
            value: r.deliveryRate != null ? `${r.deliveryRate}%` : "—",
            hint: "Delivered / (delivered + bounced + failed)",
            tone: "green",
            bar: r.deliveryRate ?? 0,
          },
          {
            label: "Active sessions",
            value: fmtNum(c.active_sessions),
            hint: `${fmtNum(c.users_active)} active operators`,
            tone: "amber",
          },
          {
            label: "Domains",
            value: fmtNum(c.domains),
            hint: `${fmtNum(c.domains_verified)} verified · ${fmtNum(c.domains_pending)} pending`,
            tone: "purple",
            bar: r.domainVerifiedPct ?? 0,
          },
          {
            label: "API keys",
            value: fmtNum(c.api_keys_active ?? c.api_keys),
            hint: `${fmtNum(c.api_keys_revoked)} revoked · ${fmtNum(c.api_keys)} total`,
            tone: "amber",
            bar: r.keysActivePct ?? 0,
          },
          {
            label: "Suppressions",
            value: fmtNum(c.suppressions),
            hint: "Compliance block list size",
            tone: "red",
          },
          {
            label: "Audit + rights",
            value: fmtNum(c.audit_events),
            hint: `${fmtNum(c.rights_open)} open rights requests`,
            tone: "purple",
          },
        ]}
      />

      <Panel title="Service actions" copy="Jump into the workflows the platform actually needs day to day.">
        <div className="action-grid">
          {[
            ["users", "Manage users", "Accounts, roles, disable access"],
            ["matrix", "Role matrix", "What each platform role can do"],
            ["domains", "Sending domains", "Add and verify mail domains"],
            ["keys", "API credentials", "Create / revoke send keys"],
            ["messages", "Message pipeline", "Queue and inspect status"],
            ["suppressions", "Compliance list", "Honor unsubscribes / bounces"],
            ["rights", "Privacy rights", "Access, erasure, portability tickets"],
          ].map(([id, title, desc]) => (
            <button key={id} type="button" className="action-card" onClick={() => onNavigate?.(id)}>
              <b>{title}</b>
              <span>{desc}</span>
              <span className="btn sm">Open</span>
            </button>
          ))}
        </div>
      </Panel>

      <div className="grid-2">
        <Panel title="7-day activity" copy="Messages queued and audit events per day.">
          <ActivityChart days={charts.activity7d || []} />
          <div className="legend-inline">
            <span>
              <i className="msg" /> Messages
            </span>
            <span>
              <i className="aud" /> Audit events
            </span>
          </div>
        </Panel>
        <Panel title="Message status mix" copy="How messages are distributed by status.">
          <Donut
            segments={statusSeg.length ? statusSeg : [{ label: "none", value: 0, color: "#d1d5db" }]}
          />
        </Panel>
      </div>

      <div className="grid-3">
        <Panel title="Streams" copy="Volume by product stream (transactional, OTP, marketing…).">
          <BarChart items={(charts.messagesByStream || []).map((x) => ({ label: x.stream, n: x.n }))} />
        </Panel>
        <Panel title="Users by role" copy="Accounts by role.">
          <BarChart items={(charts.usersByRole || []).map((x) => ({ label: x.role, n: x.n }))} />
        </Panel>
        <Panel title="Readiness checklist" copy="What the platform still needs before production send.">
          <div className="kv">
            {readiness.checks.map((ch) => (
              <div key={ch.label}>
                <span>{ch.label}</span>
                <b style={{ color: ch.ok ? "var(--ok)" : "var(--warn)" }}>{ch.ok ? "Ready" : "Missing"}</b>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid-2">
        <Panel title="Infrastructure health" copy="Database engine status.">
          <div className="kv">
            <div>
              <span>Product label</span>
              <b>{overview?.server?.name || "Senditto product"}</b>
            </div>
            <div>
              <span>Database</span>
              <b className="mono">{overview?.server?.database || "senditto"}</b>
            </div>
            <div>
              <span>Size</span>
              <b>{p.databaseSize || "—"}</b>
            </div>
            <div>
              <span>Connections</span>
              <b>
                {fmtNum(p.activeConnections)} total · {fmtNum(p.activeQueries)} active
              </b>
            </div>
            <div>
              <span>Engine</span>
              <b>{p.version ? redact(String(p.version).split(",")[0]) : "PostgreSQL"}</b>
            </div>
            <div>
              <span>Workspaces / tables</span>
              <b>
                {fmtNum(c.workspaces)} · {fmtNum((overview?.tables || []).length)} relations
              </b>
            </div>
          </div>
        </Panel>
        <Panel title="Live event stream" copy="Mutations and health ticks as they happen.">
          <PagedDataTable
            rows={(events || []).slice(0, 30).map((ev, i) => ({
              id: i,
              time: ev.at ? new Date(ev.at).toLocaleTimeString() : "—",
              type: ev.type,
              detail: redact(ev.event || ev.message || ev.error || "tick"),
            }))}
            columns={[
              { key: "time", label: "Time", mono: true },
              { key: "type", label: "Type" },
              { key: "detail", label: "Detail", mono: true },
            ]}
            empty="Waiting for realtime events…"
          />
        </Panel>
      </div>

      <div className="grid-2">
        <Panel title="Recent messages" copy="Latest messages.">
          <PagedDataTable
            rows={overview?.recent?.messages || []}
            columns={[
              {
                key: "status",
                label: "Status",
                render: (r) => (
                  <span className={`tag ${r.status === "delivered" ? "ok" : r.status === "queued" ? "warn" : "bad"}`}>
                    {r.status}
                  </span>
                ),
              },
              { key: "stream", label: "Stream" },
              { key: "to_email", label: "To", mono: true, render: (r) => fmt(r.to_email) },
              { key: "subject", label: "Subject" },
              { key: "created_at", label: "When", render: (r) => fmtTime(r.created_at) },
            ]}
            empty="No messages yet — open Messages to queue a test"
          />
        </Panel>
        <Panel title="Recent audit" copy="Security and configuration trail.">
          <PagedDataTable
            rows={overview?.recent?.audit || []}
            columns={[
              {
                key: "level",
                label: "Level",
                render: (a) => (
                  <span className={`tag ${a.level === "warn" || a.level === "error" ? "bad" : "ok"}`}>{a.level}</span>
                ),
              },
              { key: "event", label: "Event", mono: true },
              { key: "message", label: "Message" },
              { key: "created_at", label: "When", render: (r) => fmtTime(r.created_at) },
            ]}
            empty="No audit events yet"
          />
        </Panel>
      </div>
    </>
  );
}

function parseSizeToBytes(size) {
  if (size == null) return 0;
  if (typeof size === "number") return size;
  const s = String(size).trim();
  const m = s.match(/^([\d.]+)\s*([kmgtp]?b)?$/i);
  if (!m) return 0;
  const n = Number(m[1]);
  const u = (m[2] || "b").toLowerCase();
  const mult =
    u === "kb" ? 1024 : u === "mb" ? 1024 ** 2 : u === "gb" ? 1024 ** 3 : u === "tb" ? 1024 ** 4 : 1;
  return n * mult;
}

function typeTone(type) {
  const t = String(type || "").toLowerCase();
  if (/(uuid|char|text|json|xml|citext)/.test(t)) return "text";
  if (/(int|numeric|decimal|double|real|money|serial)/.test(t)) return "num";
  if (/(bool)/.test(t)) return "bool";
  if (/(timestamp|date|time)/.test(t)) return "time";
  if (/(bytea|blob|binary)/.test(t)) return "bin";
  return "other";
}

export function TablesPage({ token, overview }) {
  const tables = overview?.tables || [];
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [listQ, setListQ] = useState("");
  const [sortBy, setSortBy] = useState("rows"); // name | rows | size
  const [tab, setTab] = useState("data"); // schema | data | about
  const [colQ, setColQ] = useState("");
  const [rowQ, setRowQ] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!selected && tables[0]) setSelected(tables[0].name);
  }, [tables, selected]);

  useEffect(() => {
    if (!selected) return;
    let dead = false;
    setLoading(true);
    setDetail(null);
    setColQ("");
    setRowQ("");
    api(`/api/db/tables/${encodeURIComponent(selected)}`, { token })
      .then((d) => !dead && setDetail(d))
      .catch((e) => !dead && setDetail({ error: redact(e.message) }))
      .finally(() => !dead && setLoading(false));
    return () => {
      dead = true;
    };
  }, [selected, token, reloadKey]);

  const maxRows = useMemo(
    () => Math.max(1, ...tables.map((t) => Number(t.approx_rows || 0))),
    [tables]
  );

  const filteredTables = useMemo(() => {
    const q = listQ.trim().toLowerCase();
    let list = tables.filter((t) => {
      if (!q) return true;
      const hay = `${t.name} ${t.size || ""} ${t.approx_rows ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
    list = [...list].sort((a, b) => {
      if (sortBy === "name") return String(a.name).localeCompare(String(b.name));
      if (sortBy === "size") return parseSizeToBytes(b.size) - parseSizeToBytes(a.size);
      return Number(b.approx_rows || 0) - Number(a.approx_rows || 0);
    });
    return list;
  }, [tables, listQ, sortBy]);

  const totalRows = useMemo(
    () => tables.reduce((s, t) => s + Number(t.approx_rows || 0), 0),
    [tables]
  );

  const selectedMeta = useMemo(
    () => tables.find((t) => t.name === selected) || null,
    [tables, selected]
  );

  const columns = detail?.columns || [];
  const sampleRows = detail?.rows || [];

  const filteredColumns = useMemo(() => {
    const q = colQ.trim().toLowerCase();
    if (!q) return columns;
    return columns.filter((c) => {
      const hay = `${c.column_name} ${c.data_type} ${c.is_nullable} ${c.column_default || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [columns, colQ]);

  const filteredRows = useMemo(() => {
    const q = rowQ.trim().toLowerCase();
    if (!q) return sampleRows;
    return sampleRows.filter((r) =>
      Object.values(r || {}).some((v) => {
        if (v == null) return false;
        try {
          return String(typeof v === "object" ? JSON.stringify(v) : v)
            .toLowerCase()
            .includes(q);
        } catch {
          return false;
        }
      })
    );
  }, [sampleRows, rowQ]);

  const sampleColumns = useMemo(() => {
    if (!sampleRows.length) return [];
    const keys = Object.keys(sampleRows[0]);
    return keys.map((k) => ({
      key: k,
      label: k,
      mono: true,
      render: (r) => {
        const v = r[k];
        if (v == null) return <span className="cell-null">null</span>;
        if (typeof v === "boolean") return <span className="cell-bool">{v ? "true" : "false"}</span>;
        if (typeof v === "object") return <span className="cell-json mono">{fmt(v)}</span>;
        const s = String(v);
        if (/^\d{4}-\d{2}-\d{2}/.test(s) && !Number.isNaN(Date.parse(s))) {
          return <span className="cell-time" title={s}>{fmtTime(s)}</span>;
        }
        return fmt(v);
      },
    }));
  }, [sampleRows]);



  return (
    <>
      <PageHead
        title="Tables"
        copy="Inspect table schema and sample rows. Search and sort the list, then open a relation."
        actions={
          <button
            className="btn"
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            disabled={!selected || loading}
          >
            <RefreshCw size={15} /> Refresh table
          </button>
        }
      />

      <StatGrid
        items={[
          {
            label: "Relations",
            value: fmtNum(tables.length),
            hint: listQ ? `${filteredTables.length} match search` : "Tables and views",
            tone: "blue",
            icon: <Table2 size={16} />,
          },
          {
            label: "Approx. rows",
            value: fmtNum(totalRows),
            hint: "Sum of estimated row counts",
            tone: "green",
            icon: <Rows3 size={16} />,
          },
          {
            label: "Selected",
            value: selected
              ? selected.length > 18
                ? `${selected.slice(0, 16)}…`
                : selected
              : "—",
            hint: selectedMeta
              ? `${selected} · ${fmtNum(selectedMeta.approx_rows)} rows · ${selectedMeta.size || "—"}`
              : "Pick a table from the list",
            tone: "purple",
            icon: <Database size={16} />,
          },
          {
            label: "Columns",
            value: loading ? "…" : fmtNum(columns.length),
            hint:
              detail?.rowCount != null
                ? `${fmtNum(detail.rowCount)} counted · sample ${fmtNum(sampleRows.length)}`
                : "Schema from live metadata",
            tone: "amber",
            icon: <Columns3 size={16} />,
          },
        ]}
      />

      <div className="tables-explorer">
        <aside className="tables-side">
          <div className="tables-side-head">
            <div className="tables-search-wrap">
              <Search size={14} className="tables-search-ico" />
              <input
                className="tables-search"
                placeholder="Search tables…"
                value={listQ}
                onChange={(e) => setListQ(e.target.value)}
                aria-label="Search tables"
              />
              {listQ ? (
                <button type="button" className="tables-search-clear" onClick={() => setListQ("")}>
                  Clear
                </button>
              ) : null}
            </div>
            <div className="tables-side-tools">
              <span className="tables-count">
                {fmtNum(filteredTables.length)}
                {listQ ? ` / ${fmtNum(tables.length)}` : ""}
              </span>
              <AppSelect
                className="tables-sort"
                size="sm"
                aria-label="Sort tables"
                value={sortBy}
                onChange={setSortBy}
                options={[
                  { value: "rows", label: "Most rows" },
                  { value: "name", label: "Name A–Z" },
                  { value: "size", label: "Largest size" },
                ]}
              />
            </div>
          </div>

          <div className="tables-side-list">
            {filteredTables.length === 0 ? (
              <div className="tables-side-empty">
                <b>No tables match</b>
                <span>Try another search term</span>
              </div>
            ) : (
              filteredTables.map((t) => {
                const rows = Number(t.approx_rows || 0);
                const pct = Math.round((rows / maxRows) * 100);
                const active = selected === t.name;
                return (
                  <button
                    key={t.name}
                    type="button"
                    className={`tables-item ${active ? "active" : ""}`}
                    onClick={() => setSelected(t.name)}
                  >
                    <div className="tables-item-top">
                      <b className="mono">{t.name}</b>
                      <span className="tables-item-size">{t.size || "—"}</span>
                    </div>
                    <div className="tables-item-meta">
                      <span>{fmtNum(t.approx_rows)} rows</span>
                    </div>
                    <div className="tables-item-bar" aria-hidden="true">
                      <i style={{ width: `${Math.max(3, pct)}%` }} />
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <section className="tables-main">
          {!selected ? (
            <div className="tables-empty-main">
              <HardDrive size={28} strokeWidth={1.5} />
              <b>Select a table</b>
              <span>Choose a relation on the left to inspect schema and sample data.</span>
            </div>
          ) : (
            <>
              <header className="tables-main-head">
                <div className="tables-main-title">
                  <div className="tables-main-icon">
                    <Table2 size={18} />
                  </div>
                  <div>
                    <h3 className="mono">{selected}</h3>
                    <p>
                      {loading
                        ? "Loading schema and sample…"
                        : detail?.error
                          ? "Could not load this table"
                          : `${fmtNum(detail?.rowCount ?? selectedMeta?.approx_rows)} rows · ${
                              selectedMeta?.size || "size n/a"
                            } · ${fmtNum(columns.length)} columns · sample ${fmtNum(sampleRows.length)}`}
                    </p>
                  </div>
                </div>
                <div className="tables-main-actions">
                  <CopyButton text={selected} label="Copy name" title="Copy table name" />
                </div>
              </header>

              <div className="tables-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "data"}
                  className={tab === "data" ? "active" : ""}
                  onClick={() => setTab("data")}
                >
                  Sample data
                  <em>{fmtNum(sampleRows.length)}</em>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "schema"}
                  className={tab === "schema" ? "active" : ""}
                  onClick={() => setTab("schema")}
                >
                  Schema
                  <em>{fmtNum(columns.length)}</em>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "about"}
                  className={tab === "about" ? "active" : ""}
                  onClick={() => setTab("about")}
                >
                  About
                </button>
              </div>

              {detail?.error ? <Banner tone="bad">{detail.error}</Banner> : null}

              {tab === "schema" ? (
                <div className="tables-pane">
                  <div className="tables-pane-toolbar">
                    <div className="tables-search-wrap wide">
                      <Search size={14} className="tables-search-ico" />
                      <input
                        className="tables-search"
                        placeholder="Search columns, types, defaults…"
                        value={colQ}
                        onChange={(e) => setColQ(e.target.value)}
                      />
                    </div>
                    <span className="tables-count soft">
                      {fmtNum(filteredColumns.length)} column{filteredColumns.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  {loading ? (
                    <div className="tables-loading">Loading columns…</div>
                  ) : (
                    <div className="schema-grid">
                      {filteredColumns.length === 0 ? (
                        <div className="empty">
                          <b>No columns match</b>
                          Try a different search.
                        </div>
                      ) : (
                        filteredColumns.map((c) => (
                          <article key={c.column_name} className="schema-card">
                            <div className="schema-card-top">
                              <b className="mono">{c.column_name}</b>
                              <span className={`type-chip tone-${typeTone(c.data_type)}`}>
                                {c.data_type}
                              </span>
                            </div>
                            <div className="schema-card-meta">
                              <span className={`null-chip ${c.is_nullable === "YES" ? "yes" : "no"}`}>
                                {c.is_nullable === "YES" ? "Nullable" : "Not null"}
                              </span>
                              {c.column_default != null && c.column_default !== "" ? (
                                <span className="default-chip mono" title={String(c.column_default)}>
                                  default: {fmt(c.column_default)}
                                </span>
                              ) : (
                                <span className="default-chip muted">no default</span>
                              )}
                            </div>
                          </article>
                        ))
                      )}
                    </div>
                  )}
                </div>
              ) : null}

              {tab === "data" ? (
                <div className="tables-pane">
                  <div className="tables-pane-toolbar">
                    <div className="tables-search-wrap wide">
                      <Search size={14} className="tables-search-ico" />
                      <input
                        className="tables-search"
                        placeholder="Search in sample rows…"
                        value={rowQ}
                        onChange={(e) => setRowQ(e.target.value)}
                      />
                    </div>
                    <span className="tables-count soft">
                      {fmtNum(filteredRows.length)} of {fmtNum(sampleRows.length)} shown
                    </span>
                  </div>
                  {loading ? (
                    <div className="tables-loading">Loading sample rows…</div>
                  ) : (
                    <PagedDataTable
                      rows={filteredRows}
                      resetKey={rowQ}
                      columns={sampleColumns}
                      empty={
                        rowQ
                          ? "No sample rows match your search"
                          : "No sample rows returned for this table"
                      }
                    />
                  )}
                </div>
              ) : null}

              {tab === "about" ? (
                <div className="tables-pane">
                  <div className="kv tables-about">
                    <div>
                      <span>Relation name</span>
                      <b className="mono">{selected}</b>
                    </div>
                    <div>
                      <span>Approximate rows (catalog)</span>
                      <b>{fmtNum(selectedMeta?.approx_rows)}</b>
                    </div>
                    <div>
                      <span>Counted rows (live)</span>
                      <b>{loading ? "…" : fmtNum(detail?.rowCount)}</b>
                    </div>
                    <div>
                      <span>Disk size</span>
                      <b>{selectedMeta?.size || "—"}</b>
                    </div>
                    <div>
                      <span>Columns</span>
                      <b>{loading ? "…" : fmtNum(columns.length)}</b>
                    </div>
                    <div>
                      <span>Sample window</span>
                      <b>Up to {fmtNum(sampleRows.length)} rows</b>
                    </div>
                    <div>
                      <span>Network addresses</span>
                      <b>Never shown in this studio</b>
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>
    </>
  );
}

const USER_ROLES = PLATFORM_ROLE_IDS;

function userInitial(u) {
  const s = (u?.display_name || u?.displayName || u?.email || "U").trim();
  return (s[0] || "U").toUpperCase();
}

export function UsersPage({ token, session, onChanged }) {
  const confirm = useAppConfirm();
  const { rows, total, err, loading, load } = useEntity(token, "/api/users");
  const workspaces = useEntity(token, "/api/workspaces");
  const sessions = useEntity(token, "/api/sessions");
  const me = session?.user || null;
  const isOwner = String(me?.role || "").toLowerCase() === "owner";

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ email: "", displayName: "", role: "operator", password: "" });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [drawerUserId, setDrawerUserId] = useState(null);
  const [drawerTab, setDrawerTab] = useState("account"); // account | workspaces | sessions | security
  const [edit, setEdit] = useState(null);
  const { copy: copyText, isCopied, copyIcon } = useCopyFeedback();
  const [pwd, setPwd] = useState("");
  // Controlled role grant (owner + 2FA only)
  const [grantOpen, setGrantOpen] = useState(false);
  const [grantUser, setGrantUser] = useState(null);
  const [grantStep, setGrantStep] = useState(1); // 1 select · 2 confirm · 3 2FA
  const [grantRole, setGrantRole] = useState("operator");
  const [grantCode, setGrantCode] = useState("");
  const [grantConfirmEmail, setGrantConfirmEmail] = useState("");
  const [grantErr, setGrantErr] = useState("");
  const [grantSetupSecret, setGrantSetupSecret] = useState("");

  const filtered = useMemo(() => {
    return rows.filter((u) => {
      const hay = `${u.email} ${u.display_name || ""} ${u.role} ${u.status} ${u.id} ${u.phone || ""} ${u.company || ""} ${u.country || ""}`.toLowerCase();
      if (q && !hay.includes(q.toLowerCase())) return false;
      if (roleFilter !== "all" && u.role !== roleFilter) return false;
      if (statusFilter !== "all" && u.status !== statusFilter) return false;
      return true;
    });
  }, [rows, q, roleFilter, statusFilter]);

  const usersFilterKey = `${q}|${roleFilter}|${statusFilter}`;
  const pager = useClientPager(filtered, { resetKey: usersFilterKey });
  const bulk = useBulkSelection(pager.pageRows, { resetKey: usersFilterKey });

  const drawerUser = useMemo(
    () => rows.find((u) => u.id === drawerUserId) || null,
    [rows, drawerUserId]
  );

  useEffect(() => {
    if (!drawerUser) {
      setEdit(null);
      setPwd("");
      return;
    }
    setEdit({
      displayName: drawerUser.display_name || drawerUser.displayName || "",
      role: drawerUser.role || "operator",
      status: drawerUser.status || "active",
      email: drawerUser.email || "",
      phone: drawerUser.phone || "",
      company: drawerUser.company || "",
      country: drawerUser.country || "",
      twoFactorEnabled: !!(drawerUser.two_factor_enabled ?? drawerUser.twoFactorEnabled),
    });
    setPwd("");
  }, [drawerUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const userWorkspaces = useMemo(() => {
    if (!drawerUser) return [];
    return (workspaces.rows || []).filter(
      (w) => w.owner_user_id === drawerUser.id || w.owner_email === drawerUser.email
    );
  }, [drawerUser, workspaces.rows]);

  const userSessions = useMemo(() => {
    if (!drawerUser) return [];
    return (sessions.rows || []).filter((s) => s.email === drawerUser.email || s.user_id === drawerUser.id);
  }, [drawerUser, sessions.rows]);

  function isTwoFactorOn(u) {
    return !!(u?.two_factor_enabled ?? u?.twoFactorEnabled);
  }

  function openDrawer(u, tab = "account") {
    setDrawerUserId(u.id);
    setDrawerTab(tab);
    setMsg("");
  }

  function closeDrawer() {
    setDrawerUserId(null);
    setDrawerTab("account");
    setEdit(null);
    setPwd("");
  }

  async function createUser(e) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    try {
      // Non-owners always create operators. Elevated roles (admin/owner) are never
      // assigned on create — only via owner Grant role (2FA) after the account exists.
      const initialRole =
        isOwner && CREATE_SAFE_ROLES.includes(form.role) ? form.role : "operator";
      const data = await api("/api/users", {
        method: "POST",
        token,
        body: {
          email: form.email,
          displayName: form.displayName,
          role: initialRole,
          password: form.password || undefined,
        },
      });
      let note = `User ${data.user?.email} created as ${data.user?.role}`;
      if (data.temporaryPassword) {
        note += ` · temp password: ${data.temporaryPassword}`;
        try {
          await navigator.clipboard.writeText(data.temporaryPassword);
          note += " (copied)";
        } catch {
          /* ignore */
        }
      }
      if (isOwner) {
        note += " · elevate later with Grant role (2FA)";
      }
      setMsg(note);
      setCreateOpen(false);
      setForm({ email: "", displayName: "", role: "operator", password: "" });
      await load();
      onChanged?.();
      if (data.user?.id) openDrawer(data.user);
    } catch (ex) {
      setMsg(redact(ex.message));
    } finally {
      setBusy(false);
    }
  }

  async function saveUser(e) {
    e?.preventDefault?.();
    if (!drawerUser || !edit) return;
    setBusy(true);
    setMsg("");
    try {
      // Never send role on PATCH — roles only change via owner + 2FA grant-role
      const body = {
        displayName: edit.displayName,
        status: edit.status,
        phone: edit.phone ?? "",
        company: edit.company ?? "",
        country: edit.country ?? "",
        twoFactorEnabled: !!edit.twoFactorEnabled,
      };
      if (pwd.trim()) body.password = pwd.trim();
      await api(`/api/users/${drawerUser.id}`, { method: "PATCH", token, body });
      setMsg(`Saved ${drawerUser.email}`);
      setPwd("");
      await load();
      onChanged?.();
    } catch (ex) {
      setMsg(redact(ex.message));
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(u, status) {
    const ok = await confirm({
      title: status === "disabled" ? "Disable user" : "Enable user",
      message: `${status === "disabled" ? "Disable" : "Enable"} ${u.email}?`,
      danger: status === "disabled",
      confirmLabel: status === "disabled" ? "Disable" : "Enable",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api(`/api/users/${u.id}`, { method: "PATCH", token, body: { status } });
      setMsg(`${u.email} → ${status}`);
      await load();
      onChanged?.();
    } catch (ex) {
      setMsg(redact(ex.message));
    } finally {
      setBusy(false);
    }
  }

  async function bulkSetUserStatus(status) {
    if (!bulk.count) return;
    const ids = [...bulk.selectedIds];
    const ok = await confirm({
      title: status === "disabled" ? "Bulk disable users" : "Bulk enable users",
      message: `${status === "disabled" ? "Disable" : "Enable"} ${ids.length} selected user${ids.length === 1 ? "" : "s"}?`,
      danger: status === "disabled",
      confirmLabel: status === "disabled" ? "Disable selected" : "Enable selected",
    });
    if (!ok) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await runBulk(ids, (id) =>
        api(`/api/users/${id}`, { method: "PATCH", token, body: { status } })
      );
      setMsg(res.fail ? `Updated ${res.ok}, failed ${res.fail}` : `Updated ${res.ok} user${res.ok === 1 ? "" : "s"} → ${status}`);
      bulk.clear();
      await load();
      onChanged?.();
    } catch (ex) {
      setMsg(redact(ex.message));
    } finally {
      setBusy(false);
    }
  }

  function openGrantRole(u) {
    if (!isOwner) {
      setMsg("Only the platform owner can grant roles — and only with 2FA.");
      return;
    }
    setGrantUser(u);
    // Default to a different role so Continue is enabled
    const current = String(u.role || "operator").toLowerCase();
    setGrantRole(current === "operator" ? "viewer" : "operator");
    setGrantStep(1);
    setGrantCode("");
    setGrantConfirmEmail("");
    setGrantErr("");
    setGrantSetupSecret("");
    setGrantOpen(true);
  }

  function closeGrantRole(force = false) {
    if (busy && !force) return;
    setGrantOpen(false);
    setGrantUser(null);
    setGrantStep(1);
    setGrantCode("");
    setGrantConfirmEmail("");
    setGrantErr("");
    setGrantSetupSecret("");
  }

  async function submitGrantRole(e) {
    e?.preventDefault?.();
    if (!grantUser || !isOwner) return;
    if (grantStep < 3) {
      setGrantErr("Complete all steps and enter your owner 2FA code.");
      return;
    }
    const targetEmail = String(grantUser.email || "").trim().toLowerCase();
    if (String(grantConfirmEmail).trim().toLowerCase() !== targetEmail) {
      setGrantErr("Type the user’s email exactly to confirm this grant.");
      setGrantStep(2);
      return;
    }
    if (!/^\d{6}$/.test(String(grantCode).trim())) {
      setGrantErr("Enter the 6-digit 2FA code from your authenticator.");
      return;
    }
    setBusy(true);
    setGrantErr("");
    try {
      const data = await api(`/api/users/${grantUser.id}/grant-role`, {
        method: "POST",
        token,
        body: {
          role: grantRole,
          twoFactorCode: String(grantCode).trim(),
          confirmEmail: targetEmail,
        },
      });
      setMsg(
        `Role granted (2FA verified): ${data.user?.email || grantUser.email} → ${data.user?.role || grantRole}`
      );
      closeGrantRole(true);
      await load();
      onChanged?.();
    } catch (ex) {
      const raw = ex.message || "";
      setGrantErr(redact(raw));
      // Owner must finish authenticator setup before grants work
      if (/Enable two-step|2FA secret|set up your authenticator|setup/i.test(raw)) {
        try {
          const setup = await api("/api/auth/2fa/setup", { method: "POST", token });
          if (setup.twoFactorSecret) setGrantSetupSecret(setup.twoFactorSecret);
        } catch {
          /* ignore */
        }
      }
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(u) {
    const ok = await confirm({
      title: "Reset password",
      message: `Generate a new temporary password for ${u.email}?`,
      confirmLabel: "Reset password",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const temp = `Tmp-${Math.random().toString(36).slice(2, 10)}!`;
      await api(`/api/users/${u.id}`, { method: "PATCH", token, body: { password: temp } });
      try {
        await navigator.clipboard.writeText(temp);
        setMsg(`Password reset for ${u.email} · temp copied: ${temp}`);
      } catch {
        setMsg(`Password reset for ${u.email} · temp: ${temp}`);
      }
      onChanged?.();
    } catch (ex) {
      setMsg(redact(ex.message));
    } finally {
      setBusy(false);
    }
  }

  function refreshAll() {
    load();
    workspaces.load();
    sessions.load();
  }

  function menuFor(u) {
    const st = String(u.status || "").toLowerCase();
    const tfa = isTwoFactorOn(u);
    const items = [
      {
        id: "open",
        label: "Open details",
        icon: <IdCard size={15} />,
        title: "Open the side panel with full user info",
        onClick: () => openDrawer(u),
      },
      {
        id: "copy-email",
        label: isCopied(`e-${u.id}`) ? "Copied" : "Copy email",
        icon: copyIcon(`e-${u.id}`),
        title: "Copy email to clipboard",
        onClick: () => copyText(u.email, `e-${u.id}`),
      },
      {
        id: "copy-id",
        label: isCopied(`id-${u.id}`) ? "Copied" : "Copy user ID",
        icon: copyIcon(`id-${u.id}`),
        title: "Copy user ID",
        onClick: () => copyText(u.id, `id-${u.id}`),
      },
      {
        id: "tfa",
        label: tfa ? "Turn off 2FA" : "Turn on 2FA",
        icon: <Fingerprint size={15} />,
        title: tfa ? "Disable two-step authentication" : "Enable two-step authentication",
        onClick: async () => {
          setBusy(true);
          try {
            const data = await api(`/api/users/${u.id}`, {
              method: "PATCH",
              token,
              body: { twoFactorEnabled: !tfa },
            });
            setMsg(`2FA ${!tfa ? "enabled" : "disabled"} for ${u.email}`);
            await load();
            onChanged?.();
          } catch (ex) {
            setMsg(redact(ex.message));
          } finally {
            setBusy(false);
          }
        },
      },
      {
        id: "toggle",
        label: st === "active" ? "Disable user" : "Enable user",
        icon: st === "active" ? <Power size={15} /> : <Play size={15} />,
        title: st === "active" ? "Disable this account" : "Enable this account",
        onClick: () => setStatus(u, st === "active" ? "disabled" : "active"),
      },
      {
        id: "reset",
        label: "Reset password",
        icon: <Lock size={15} />,
        title: "Generate a temporary password",
        onClick: () => resetPassword(u),
      },
    ];
    // Role grant: platform owner only — controlled multi-step 2FA flow (never one-click)
    if (isOwner) {
      items.splice(1, 0, {
        id: "grant-role",
        label: "Grant role (2FA)…",
        icon: <ShieldCheck size={15} />,
        title: "Only the platform owner can grant roles — requires 2FA verification",
        onClick: () => openGrantRole(u),
      });
    }
    return items;
  }

  const activeN = rows.filter((u) => u.status === "active").length;
  const disabledN = rows.filter((u) => u.status === "disabled").length;
  const staffN = rows.filter((u) => ["owner", "admin"].includes(String(u.role || "").toLowerCase())).length;

  return (
    <>
      <PageHead
        title="Users"
        copy="Sign-in accounts for the product. Open a row or ⋮ for full details and edit in the side panel."
        actions={
          <>
            <button className="btn" type="button" onClick={refreshAll} disabled={loading}>
              <RefreshCw size={15} /> Refresh
            </button>
            <button className="btn primary" type="button" onClick={() => setCreateOpen(true)}>
              <UserPlus size={15} /> Add user
            </button>
          </>
        }
      />
      {msg ? <Banner tone={/fail|error|cannot/i.test(msg) ? "bad" : "ok"}>{msg}</Banner> : null}
      {err ? <Banner tone="bad">{err}</Banner> : null}

      <StatGrid
        items={[
          {
            label: "Total users",
            value: fmtNum(total),
            hint: `${fmtNum(filtered.length)} shown`,
            tone: "blue",
            icon: <Users size={16} />,
          },
          {
            label: "Active",
            value: fmtNum(activeN),
            hint: `${fmtNum(disabledN)} disabled`,
            tone: "green",
          },
          {
            label: "Owners / admins",
            value: fmtNum(staffN),
            hint: `${PLATFORM_ROLE_IDS.length} platform roles`,
            tone: "purple",
          },
          {
            label: "Workspaces owned",
            value: fmtNum(workspaces.rows?.length),
            hint: "User workspaces on the platform",
            tone: "amber",
            icon: <Layers size={16} />,
          },
        ]}
      />

      <Panel title="Directory" copy={`${fmtNum(filtered.length)} of ${fmtNum(total)} accounts`}>
        <div className="ws-table-toolbar">
          <div className="tables-search-wrap wide">
            <Search size={14} className="tables-search-ico" />
            <input
              className="tables-search"
              placeholder="Search name, email, role…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="ws-chip-row">
            {["all", ...PLATFORM_ROLE_IDS].map((r) => (
              <button
                key={r}
                type="button"
                className={`ws-chip ${roleFilter === r ? "active" : ""}`}
                onClick={() => setRoleFilter(r)}
              >
                {r === "all" ? "all" : roleLabel(r)}
              </button>
            ))}
          </div>
          <div className="ws-chip-row">
            {["all", "active", "disabled"].map((s) => (
              <button
                key={s}
                type="button"
                className={`ws-chip ${statusFilter === s ? "active" : ""}`}
                onClick={() => setStatusFilter(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {!loading && filtered.length === 0 ? (
          <div className="empty">
            <b>No users match</b>
            {rows.length ? "Try another filter." : "Add the first user account."}
          </div>
        ) : (
          <div className="paged-table-stack">
          <BulkBar
            count={bulk.count}
            noun={bulk.count === 1 ? "user selected" : "users selected"}
            pageCount={pager.pageRows.length}
            filteredCount={filtered.length}
            onClear={bulk.clear}
            onSelectPage={bulk.togglePage}
            onSelectAll={() => bulk.selectAll(filtered)}
            allPageSelected={bulk.allPageSelected}
            emptyHint="Select users with the checkboxes, then enable or disable in bulk."
          >
            <button type="button" className="btn sm" disabled={busy || !bulk.count} onClick={() => bulkSetUserStatus("active")}>
              Enable
            </button>
            <button type="button" className="btn sm danger" disabled={busy || !bulk.count} onClick={() => bulkSetUserStatus("disabled")}>
              Disable
            </button>
          </BulkBar>
          <TableShell rowCount={pager.pageRows.length} className="users-table-wrap">
            <table className="data users-table">
              <thead>
                <tr>
                  <BulkSelectHeader
                    checked={bulk.allPageSelected}
                    indeterminate={bulk.somePageSelected && !bulk.allPageSelected}
                    onChange={bulk.togglePage}
                  />
                  <th className="users-col-user" title="Name and email">User</th>
                  <th className="users-col-phone" title="Phone number">Phone</th>
                  <th className="users-col-role" title="Account role">Role</th>
                  <th className="users-col-status" title="Account status">Status</th>
                  <th className="users-col-2fa" title="Two-step authentication">2FA</th>
                  <th className="users-col-ws" title="Owned workspaces">Workspaces</th>
                  <th className="users-col-login" title="Last successful login">Last login</th>
                  <th className="users-col-created" title="Account created">Created</th>
                  <th className="users-col-actions" aria-label="Actions" title="Actions" />
                </tr>
              </thead>
              <tbody>
                {pager.pageRows.map((u) => {
                  const wsN = (workspaces.rows || []).filter(
                    (w) => w.owner_user_id === u.id || w.owner_email === u.email
                  ).length;
                  const tfaOn = isTwoFactorOn(u);
                  const phone = u.phone || "";
                  return (
                    <tr
                      key={u.id}
                      className={`clickable users-table-row ${drawerUserId === u.id ? "selected" : ""} ${bulk.isSelected(u.id) ? "bulk-selected" : ""}`}
                      onClick={() => openDrawer(u)}
                      title={`Open ${u.email}`}
                    >
                      <BulkSelectCell
                        checked={bulk.isSelected(u.id)}
                        onChange={() => bulk.toggle(u.id)}
                        label={`Select ${u.email}`}
                      />
                      <td className="users-col-user">
                        <div className="users-user-cell">
                          <span className="users-avatar" data-role={u.role} title={`Role: ${u.role}`}>
                            {userInitial(u)}
                          </span>
                          <div>
                            <b title={u.display_name || u.displayName || u.email}>
                              {u.display_name || u.displayName || u.email}
                            </b>
                            <small className="mono" title={u.email}>
                              {u.email}
                            </small>
                            {(u.company || u.country) && (
                              <small className="users-extra-meta" title={[u.company, u.country].filter(Boolean).join(" · ")}>
                                {[u.company, u.country].filter(Boolean).join(" · ")}
                              </small>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="users-col-phone">
                        {phone ? (
                          <Tip text={`Phone: ${phone}`}>
                            <span className="users-phone">
                              <Phone size={13} />
                              {phone}
                            </span>
                          </Tip>
                        ) : (
                          <span className="muted-sm" title="No phone on file">
                            —
                          </span>
                        )}
                      </td>
                      <td className="users-col-role">
                        <span className={`users-role-pill tone-${roleTone(u.role)}`} title={`Role: ${roleLabel(u.role)}`}>
                          {roleLabel(u.role)}
                        </span>
                      </td>
                      <td className="users-col-status">
                        <span
                          className={`tag ${u.status === "active" ? "ok" : "bad"}`}
                          title={u.status === "active" ? "Account is active" : "Account is disabled"}
                        >
                          {u.status}
                        </span>
                      </td>
                      <td className="users-col-2fa">
                        <TwoFactorBadge on={tfaOn} />
                      </td>
                      <td className="users-col-ws" title={`${wsN} owned workspace(s)`}>
                        {fmtNum(wsN)}
                      </td>
                      <td className="users-col-login" title={fmtTime(u.last_login_at || u.lastLoginAt)}>
                        {fmtTime(u.last_login_at || u.lastLoginAt)}
                      </td>
                      <td className="users-col-created" title={fmtTime(u.created_at)}>
                        {fmtTime(u.created_at)}
                      </td>
                      <td className="users-col-actions">
                        <RowMenu items={menuFor(u)} label={`Actions for ${u.email}`} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableShell>
          <TablePager
            page={pager.page}
            pageCount={pager.pageCount}
            total={pager.total}
            from={pager.from}
            to={pager.to}
            pageNumbers={pager.pageNumbers}
            middlePage={pager.middlePage}
            onPageChange={pager.setPage}
            onFirst={pager.goFirst}
            onMiddle={pager.goMiddle}
            onLast={pager.goLast}
            onPrev={pager.goPrev}
            onNext={pager.goNext}
          />
          </div>
        )}
      </Panel>

      {/* Right slide-over drawer */}
      <div className={`user-drawer-root ${drawerUser ? "open" : ""}`} aria-hidden={!drawerUser}>
        <button type="button" className="user-drawer-backdrop" aria-label="Close" onClick={closeDrawer} />
        <aside className="user-drawer" role="dialog" aria-modal="true" aria-label="User details">
          {drawerUser && edit ? (
            <>
              <header className="user-drawer-head">
                <div className="user-drawer-identity">
                  <span className="users-avatar lg" data-role={drawerUser.role}>
                    {userInitial(drawerUser)}
                  </span>
                  <div>
                    <h3>{edit.displayName || drawerUser.email}</h3>
                    <p className="mono">{drawerUser.email}</p>
                  </div>
                </div>
                <button type="button" className="btn ghost sm" onClick={closeDrawer} aria-label="Close panel">
                  ✕
                </button>
              </header>

              <div className="user-drawer-meta">
                <span className={`users-role-pill tone-${roleTone(edit.role)}`}>{roleLabel(edit.role)}</span>
                <span className={`tag ${edit.status === "active" ? "ok" : "bad"}`}>{edit.status}</span>
              </div>

              <nav className="user-drawer-nav" aria-label="User sections">
                {[
                  { id: "account", label: "Account", icon: <IdCard size={14} /> },
                  { id: "workspaces", label: "Workspaces", icon: <Layers size={14} />, n: userWorkspaces.length },
                  { id: "sessions", label: "Active sessions", icon: <Activity size={14} />, n: userSessions.length },
                  { id: "security", label: "Security", icon: <ShieldCheck size={14} /> },
                ].map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={drawerTab === t.id ? "active" : ""}
                    title={t.label}
                    onClick={() => setDrawerTab(t.id)}
                  >
                    {t.icon}
                    {t.label}
                    {t.n != null ? <em>{fmtNum(t.n)}</em> : null}
                  </button>
                ))}
              </nav>

              <div className="user-drawer-body">
                {drawerTab === "account" ? (
                  <section className="user-drawer-section">
                    <h4>
                      <IdCard size={14} /> Account
                    </h4>
                    <form className="form" onSubmit={saveUser}>
                      <Field label="Display name" full>
                        <div className="field-with-ico">
                          <Users size={15} className="field-ico" />
                          <input
                            value={edit.displayName}
                            onChange={(e) => setEdit((p) => ({ ...p, displayName: e.target.value }))}
                            title="Display name"
                          />
                        </div>
                      </Field>
                      <Field label="Email" full>
                        <div className="field-with-ico">
                          <Mail size={15} className="field-ico" />
                          <input className="mono" readOnly value={edit.email} title="Email (read-only)" />
                        </div>
                      </Field>
                      <Field label="Phone" full>
                        <div className="field-with-ico">
                          <Phone size={15} className="field-ico" />
                          <input
                            value={edit.phone}
                            onChange={(e) => setEdit((p) => ({ ...p, phone: e.target.value }))}
                            placeholder="+1 …"
                            title="Phone number"
                          />
                        </div>
                      </Field>
                      <Field label="Company" full>
                        <div className="field-with-ico">
                          <Building2 size={15} className="field-ico" />
                          <input
                            value={edit.company}
                            onChange={(e) => setEdit((p) => ({ ...p, company: e.target.value }))}
                            placeholder="Company"
                            title="Company"
                          />
                        </div>
                      </Field>
                      <Field label="Country" full>
                        <div className="field-with-ico">
                          <Globe2 size={15} className="field-ico" />
                          <input
                            value={edit.country}
                            onChange={(e) => setEdit((p) => ({ ...p, country: e.target.value }))}
                            placeholder="Country"
                            title="Country"
                          />
                        </div>
                      </Field>
                      <Field label="Role" full>
                        <div className="role-grant-block">
                          <div className="field-with-ico">
                            <Shield size={15} className="field-ico" />
                            <input
                              readOnly
                              value={roleLabel(edit.role)}
                              title="Role cannot be changed with a simple click — use Grant role (2FA)"
                            />
                          </div>
                          <p className="role-grant-hint">
                            Roles are not changed with a simple click. Only the{" "}
                            <b>platform owner</b> can grant roles, and only after{" "}
                            <b>2FA</b> verification.
                          </p>
                          {isOwner ? (
                            <button
                              type="button"
                              className="btn sm primary"
                              title="Open controlled role grant with 2FA"
                              onClick={() => openGrantRole(drawerUser)}
                            >
                              <ShieldCheck size={14} /> Grant role (requires 2FA)
                            </button>
                          ) : (
                            <p className="muted-sm">You are not the platform owner — role grant is locked.</p>
                          )}
                        </div>
                      </Field>
                      <Field label="Status" full>
                        <div className="field-with-ico select">
                          <Power size={15} className="field-ico" />
                          <AppSelect
                            value={edit.status}
                            onChange={(status) => setEdit((p) => ({ ...p, status }))}
                            options={["active", "disabled"]}
                          />
                        </div>
                      </Field>
                      <Field label="Two-step authentication" full>
                        <button
                          type="button"
                          className={`tfa-toggle ${edit.twoFactorEnabled ? "on" : "off"}`}
                          title={
                            edit.twoFactorEnabled
                              ? "Two-step authentication is on — click to turn off"
                              : "Two-step authentication is off — click to turn on"
                          }
                          onClick={() =>
                            setEdit((p) => ({ ...p, twoFactorEnabled: !p.twoFactorEnabled }))
                          }
                        >
                          <Fingerprint size={18} />
                          <span>{edit.twoFactorEnabled ? "2FA is on" : "2FA is off"}</span>
                        </button>
                      </Field>
                      <Field label="New password (optional)" full>
                        <div className="field-with-ico">
                          <Lock size={15} className="field-ico" />
                          <input
                            type="password"
                            value={pwd}
                            onChange={(e) => setPwd(e.target.value)}
                            placeholder="Leave blank to keep current"
                            autoComplete="new-password"
                            title="Optional new password"
                          />
                        </div>
                      </Field>
                      <div className="full user-drawer-save">
                        <button className="btn primary" type="submit" disabled={busy} title="Save account changes">
                          {busy ? "Saving…" : "Save changes"}
                        </button>
                      </div>
                    </form>
                    <div className="kv compact" style={{ marginTop: 14 }}>
                      <div>
                        <span>
                          <IdCard size={12} /> User ID
                        </span>
                        <b className="mono">{drawerUser.id}</b>
                      </div>
                      <div>
                        <span>
                          <Activity size={12} /> Last login
                        </span>
                        <b>{fmtTime(drawerUser.last_login_at || drawerUser.lastLoginAt)}</b>
                      </div>
                      <div>
                        <span>
                          <Plus size={12} /> Created
                        </span>
                        <b>{fmtTime(drawerUser.created_at)}</b>
                      </div>
                      <div>
                        <span>
                          <RefreshCw size={12} /> Updated
                        </span>
                        <b>{fmtTime(drawerUser.updated_at)}</b>
                      </div>
                      <div>
                        <span>
                          <Fingerprint size={12} /> 2FA
                        </span>
                        <b>
                          <TwoFactorBadge on={!!edit.twoFactorEnabled} size={16} />{" "}
                          {edit.twoFactorEnabled ? "On" : "Off"}
                        </b>
                      </div>
                    </div>
                  </section>
                ) : null}

                {drawerTab === "workspaces" ? (
                  <section className="user-drawer-section">
                    <h4>
                      <Layers size={14} /> Owned workspaces
                    </h4>
                    {userWorkspaces.length === 0 ? (
                      <p className="muted-sm">No workspaces owned by this user.</p>
                    ) : (
                      <ul className="user-drawer-list">
                        {userWorkspaces.map((w) => (
                          <li key={w.id}>
                            <b>{w.name}</b>
                            <span>
                              {w.status} · {(w.type || "").replace(" workspace", "")}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                ) : null}

                {drawerTab === "sessions" ? (
                  <section className="user-drawer-section">
                    <h4>
                      <Activity size={14} /> Active sessions
                    </h4>
                    <p className="muted-sm" style={{ marginBottom: 10 }}>
                      Only this page — live sign-ins for this user.
                    </p>
                    {userSessions.length === 0 ? (
                      <p className="muted-sm">No active sessions listed.</p>
                    ) : (
                      <ul className="user-drawer-list">
                        {userSessions.map((s) => (
                          <li key={s.id}>
                            <b>{s.purpose || "session"}</b>
                            <span>
                              Last seen {fmtTime(s.last_seen_at)} · expires {fmtTime(s.expires_at)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                ) : null}

                {drawerTab === "security" ? (
                  <section className="user-drawer-section">
                    <h4>
                      <ShieldCheck size={14} /> Security
                    </h4>
                    <div className="user-drawer-security-card">
                      <TwoFactorBadge on={!!edit.twoFactorEnabled} size={22} />
                      <div>
                        <b>Two-step authentication</b>
                        <span>{edit.twoFactorEnabled ? "Enabled (green fingerprint)" : "Disabled (red fingerprint)"}</span>
                      </div>
                      <button
                        type="button"
                        className={`btn sm ${edit.twoFactorEnabled ? "danger" : "primary"}`}
                        title={edit.twoFactorEnabled ? "Turn off 2FA" : "Turn on 2FA"}
                        disabled={busy}
                        onClick={async () => {
                          const next = !edit.twoFactorEnabled;
                          setEdit((p) => ({ ...p, twoFactorEnabled: next }));
                          setBusy(true);
                          try {
                            await api(`/api/users/${drawerUser.id}`, {
                              method: "PATCH",
                              token,
                              body: { twoFactorEnabled: next },
                            });
                            setMsg(`2FA ${next ? "on" : "off"} for ${drawerUser.email}`);
                            await load();
                            onChanged?.();
                          } catch (ex) {
                            setMsg(redact(ex.message));
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        {edit.twoFactorEnabled ? "Turn off" : "Turn on"}
                      </button>
                    </div>
                    <div className="user-drawer-quick">
                      <CopyButton text={drawerUser.email} label="Copy email" title="Copy email" />
                      <CopyButton text={drawerUser.id} label="Copy ID" title="Copy user ID" />
                      <button
                        className="btn sm"
                        type="button"
                        title="Generate temporary password"
                        disabled={busy}
                        onClick={() => resetPassword(drawerUser)}
                      >
                        <Lock size={14} /> Reset password
                      </button>
                      {edit.status === "active" ? (
                        <button
                          className="btn sm danger"
                          type="button"
                          title="Disable this account"
                          disabled={busy}
                          onClick={() => setStatus(drawerUser, "disabled")}
                        >
                          <Power size={14} /> Disable user
                        </button>
                      ) : (
                        <button
                          className="btn sm"
                          type="button"
                          title="Enable this account"
                          disabled={busy}
                          onClick={() => setStatus(drawerUser, "active")}
                        >
                          <Play size={14} /> Enable user
                        </button>
                      )}
                    </div>
                  </section>
                ) : null}
              </div>
            </>
          ) : null}
        </aside>
      </div>

      {createOpen ? (
        <Modal title="Add user" onClose={() => !busy && setCreateOpen(false)}>
          <form className="form" onSubmit={createUser}>
            <Field label="Email" full>
              <input
                required
                type="email"
                value={form.email}
                onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                autoFocus
              />
            </Field>
            <Field label="Display name" full>
              <input
                value={form.displayName}
                onChange={(e) => setForm((p) => ({ ...p, displayName: e.target.value }))}
              />
            </Field>
            <Field label="Initial role" full>
              {isOwner ? (
                <>
                  <AppSelect
                    value={CREATE_SAFE_ROLES.includes(form.role) ? form.role : "operator"}
                    onChange={(role) => setForm((p) => ({ ...p, role }))}
                    options={CREATE_SAFE_ROLES.map((id) => ({ value: id, label: roleLabel(id) }))}
                    aria-label="Initial role"
                  />
                  <p className="role-grant-hint" style={{ marginTop: 8 }}>
                    New accounts start as a safe role only ({CREATE_SAFE_ROLES.map(roleLabel).join(", ")}).
                    Elevated roles (<b>admin</b> / <b>owner</b>) require the controlled{" "}
                    <b>Grant role (2FA)</b> flow — never a simple click. See <b>Matrix</b> for capabilities.
                  </p>
                </>
              ) : (
                <>
                  <input
                    readOnly
                    value="operator"
                    title="Non-owners can only create operator accounts"
                    onChange={() => {}}
                  />
                  <p className="role-grant-hint" style={{ marginTop: 8 }}>
                    Only the <b>platform owner</b> can grant roles (with 2FA). New users start as{" "}
                    <b>operator</b>.
                  </p>
                </>
              )}
            </Field>
            <Field label="Password (optional — auto if empty)" full>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
                autoComplete="new-password"
              />
            </Field>
            <div className="full" style={{ display: "flex", gap: 8, marginTop: 8, justifyContent: "flex-end" }}>
              <button className="btn" type="button" onClick={() => setCreateOpen(false)} disabled={busy}>
                Cancel
              </button>
              <button className="btn primary" type="submit" disabled={busy}>
                {busy ? "Creating…" : "Create user"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {grantOpen && grantUser ? (
        <Modal
          title="Grant role — owner + 2FA only"
          onClose={() => closeGrantRole(false)}
          wide
        >
          <div className="grant-flow">
            <div className="grant-lock-banner" role="note">
              <ShieldCheck size={16} />
              <span>
                Controlled security flow: only the <b>platform owner</b> can grant roles, and only after{" "}
                <b>two-step authentication (2FA)</b>. No simple one-click role changes.
              </span>
            </div>

            <div className="grant-steps" aria-label="Grant steps">
              {[
                { n: 1, label: "Select role" },
                { n: 2, label: "Confirm email" },
                { n: 3, label: "2FA verify" },
              ].map((s) => (
                <div
                  key={s.n}
                  className={`grant-step ${grantStep === s.n ? "active" : ""} ${grantStep > s.n ? "done" : ""}`}
                >
                  <em>{s.n}</em>
                  <span>{s.label}</span>
                </div>
              ))}
            </div>

            <div className="grant-target">
              <span className="users-avatar" data-role={grantUser.role}>
                {userInitial(grantUser)}
              </span>
              <div>
                <b>{grantUser.display_name || grantUser.email}</b>
                <small className="mono">{grantUser.email}</small>
                <small>
                  Current role: <strong>{grantUser.role}</strong>
                  {grantStep > 1 ? (
                    <>
                      {" "}
                      → proposed: <strong>{grantRole}</strong>
                    </>
                  ) : null}
                </small>
              </div>
            </div>

            {grantErr && grantStep !== 3 ? <Banner tone="bad">{grantErr}</Banner> : null}

            {grantStep === 1 ? (
              <div className="grant-pane">
                <p className="page-copy" style={{ marginTop: 0 }}>
                  Choose the role to grant. This alone does nothing — you still must confirm the user’s
                  email and pass <b>owner 2FA</b>.
                </p>
                <Field label="New role to grant" full>
                  <AppSelect
                    value={grantRole}
                    onChange={setGrantRole}
                    options={USER_ROLES.map((id) => ({ value: id, label: roleLabel(id) }))}
                  />
                </Field>
                {grantRole === "owner" ? (
                  <div className="grant-warning">
                    <ShieldCheck size={18} />
                    <div>
                      <b>Granting owner is highly privileged</b>
                      <p>
                        The target will be able to grant roles (with their own 2FA) and manage the whole
                        platform. Prefer <b>admin</b> unless you truly need another owner.
                      </p>
                    </div>
                  </div>
                ) : null}
                <div className="grant-actions">
                  <button className="btn" type="button" onClick={() => closeGrantRole(false)}>
                    Cancel
                  </button>
                  <button
                    className="btn primary"
                    type="button"
                    disabled={grantRole === grantUser.role}
                    onClick={() => {
                      setGrantErr("");
                      setGrantConfirmEmail("");
                      setGrantStep(2);
                    }}
                  >
                    Continue to confirm
                  </button>
                </div>
              </div>
            ) : null}

            {grantStep === 2 ? (
              <div className="grant-pane">
                <div className="grant-warning">
                  <ShieldCheck size={18} />
                  <div>
                    <b>Confirm role grant</b>
                    <p>
                      You are about to set <span className="mono">{grantUser.email}</span> to role{" "}
                      <b>{grantRole}</b>. Type their email below to prove this is intentional, then
                      continue to owner <b>2FA</b>.
                    </p>
                  </div>
                </div>
                <Field label={`Type email to confirm: ${grantUser.email}`} full>
                  <input
                    type="email"
                    autoComplete="off"
                    spellCheck={false}
                    value={grantConfirmEmail}
                    onChange={(e) => setGrantConfirmEmail(e.target.value)}
                    placeholder={grantUser.email}
                    title="Type the target user email exactly"
                    autoFocus
                  />
                </Field>
                <div className="grant-actions">
                  <button className="btn" type="button" onClick={() => setGrantStep(1)}>
                    Back
                  </button>
                  <button
                    className="btn primary"
                    type="button"
                    disabled={
                      String(grantConfirmEmail).trim().toLowerCase() !==
                      String(grantUser.email || "").trim().toLowerCase()
                    }
                    onClick={() => {
                      setGrantErr("");
                      setGrantCode("");
                      setGrantStep(3);
                    }}
                  >
                    Email matches — continue to 2FA
                  </button>
                </div>
              </div>
            ) : null}

            {grantStep === 3 ? (
              <form className="grant-pane" onSubmit={submitGrantRole}>
                <p className="page-copy" style={{ marginTop: 0 }}>
                  Final step: enter the <b>6-digit 2FA code</b> from the authenticator on the{" "}
                  <b>platform owner</b> account. Grants are rejected without a valid code.
                </p>
                {grantSetupSecret ? (
                  <div className="grant-setup">
                    <b>Finish owner 2FA setup first</b>
                    <p>Add this secret to your authenticator, enable 2FA, then enter a fresh code:</p>
                    <code className="mono">{grantSetupSecret}</code>
                  </div>
                ) : null}
                <Field label="Owner 2FA code" full>
                  <div className="field-with-ico">
                    <Fingerprint size={15} className="field-ico" />
                    <input
                      required
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      value={grantCode}
                      onChange={(e) => setGrantCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder="000000"
                      title="6-digit 2FA code from owner authenticator"
                      autoFocus
                    />
                  </div>
                </Field>
                {grantErr ? <Banner tone="bad">{grantErr}</Banner> : null}
                <div className="grant-actions">
                  <button className="btn" type="button" disabled={busy} onClick={() => setGrantStep(2)}>
                    Back
                  </button>
                  <button
                    className="btn primary"
                    type="submit"
                    disabled={busy || grantCode.length !== 6}
                    title="Verify 2FA and apply the role grant"
                  >
                    {busy ? "Verifying 2FA…" : `Verify 2FA & grant ${grantRole}`}
                  </button>
                </div>
              </form>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </>
  );
}

const WS_TYPES = [
  "Developer workspace",
  "Marketing workspace",
  "Business workspace",
  "Enterprise workspace",
];
const WS_REGIONS = [
  { value: "", label: "Not set" },
  { value: "Europe (London)", label: "Europe (London)" },
  { value: "North America (Virginia)", label: "North America (Virginia)" },
  { value: "Asia Pacific (Singapore)", label: "Asia Pacific (Singapore)" },
];
const WS_STATUSES = ["Active", "Paused", "Archived"];

const emptyWsForm = () => ({
  name: "",
  type: "Developer workspace",
  region: "",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
  status: "Active",
  ownerUserId: "",
});

function statusTone(status) {
  const s = String(status || "").toLowerCase();
  if (s === "active") return "ok";
  if (s === "paused") return "warn";
  if (s === "archived") return "bad";
  return "";
}

function workspaceInitial(w) {
  const s = (w?.name || w?.owner_email || "W").trim();
  return (s[0] || "W").toUpperCase();
}

function workspaceHealth(counts, extra = {}) {
  const items = [
    { id: "domain", ok: counts.domains > 0, label: "Domain added", weight: 1 },
    { id: "verified", ok: !!extra.domainVerified, label: "Domain verified", weight: 1 },
    { id: "key", ok: counts.keys > 0, label: "API key created", weight: 1 },
    { id: "activeKey", ok: !!extra.activeKey, label: "Active API key", weight: 1 },
    { id: "msg", ok: counts.messages > 0, label: "Messages sent", weight: 1 },
    { id: "owner", ok: !!extra.hasOwner, label: "Owner linked", weight: 1 },
  ];
  const total = items.reduce((s, x) => s + x.weight, 0);
  const got = items.reduce((s, x) => s + (x.ok ? x.weight : 0), 0);
  const score = Math.round((got / total) * 100);
  return { score, items, done: got, total };
}

function SetupRing({ score = 0, size = 120, stroke = 10 }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, Number(score) || 0));
  const offset = c - (pct / 100) * c;
  const tone = pct >= 80 ? "good" : pct >= 40 ? "mid" : "low";
  return (
    <div className={`setup-ring setup-ring--${tone}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle className="setup-ring-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
        <circle
          className="setup-ring-value"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="setup-ring-label">
        <b>{pct}%</b>
        <span>Setup</span>
      </div>
    </div>
  );
}

/** Three-dot menu — portaled to #app-layer so it is never clipped inside tables */
export function RowMenu({ items = [], label = "Actions" }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const panelRef = useRef(null);

  const place = useCallback(() => {
    if (!btnRef.current) return;
    const host =
      document.getElementById("app-layer") ||
      document.querySelector(".app") ||
      document.getElementById("root") ||
      document.body;
    const hostRect = host.getBoundingClientRect();
    const btn = btnRef.current.getBoundingClientRect();
    const panelW = 188;
    const panelH = Math.min(320, (items.length || 1) * 36 + 12);
    let left = btn.right - hostRect.left - panelW;
    if (left < 8) left = 8;
    if (left + panelW > hostRect.width - 8) left = Math.max(8, hostRect.width - panelW - 8);
    const spaceBelow = hostRect.bottom - btn.bottom;
    const openUp = spaceBelow < panelH + 8;
    const top = openUp
      ? Math.max(8, btn.top - hostRect.top - panelH - 4)
      : btn.bottom - hostRect.top + 4;
    setPos({
      position: "absolute",
      top,
      left,
      width: panelW,
      maxHeight: panelH,
    });
  }, [items.length]);

  useLayoutEffect(() => {
    if (open) place();
    else setPos(null);
  }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (btnRef.current?.contains(e.target)) return;
      if (panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onScroll = () => place();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onScroll);
    document.querySelector(".content")?.addEventListener("scroll", onScroll, true);
    document.querySelector(".table-wrap")?.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onScroll);
      document.querySelector(".content")?.removeEventListener("scroll", onScroll, true);
      document.querySelector(".table-wrap")?.removeEventListener("scroll", onScroll, true);
    };
  }, [open, place]);

  const host =
    typeof document !== "undefined"
      ? document.getElementById("app-layer") ||
        document.querySelector(".app") ||
        document.getElementById("root")
      : null;

  const menu =
    open && host && pos
      ? createPortal(
          <div className="row-menu-panel row-menu-panel-portal" role="menu" ref={panelRef} style={pos}>
            {items.map((it) => (
              <button
                key={it.id}
                type="button"
                role="menuitem"
                className={it.danger ? "danger" : ""}
                disabled={it.disabled}
                title={it.title || it.label}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  it.onClick?.();
                }}
              >
                {it.icon ? <span className="row-menu-ico">{it.icon}</span> : null}
                <span>{it.label}</span>
              </button>
            ))}
          </div>,
          host
        )
      : null;

  return (
    <div className={`row-menu ${open ? "open" : ""}`} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="row-menu-btn"
        ref={btnRef}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <MoreHorizontal size={18} />
      </button>
      {menu}
    </div>
  );
}

function Tip({ text, children, className = "" }) {
  return (
    <span className={`ui-tip ${className}`.trim()} data-tip={text} title={text}>
      {children}
    </span>
  );
}

function TwoFactorBadge({ on, size = 18 }) {
  return (
    <Tip text={on ? "Two-step authentication is on" : "Two-step authentication is off"}>
      <span className={`tfa-badge ${on ? "on" : "off"}`} aria-label={on ? "2FA on" : "2FA off"}>
        <Fingerprint size={size} strokeWidth={2.2} />
      </span>
    </Tip>
  );
}

export function WorkspacesPage({ token, onChanged }) {
  const confirm = useAppConfirm();
  const { rows, err, loading, load } = useEntity(token, "/api/workspaces");
  const users = useEntity(token, "/api/users");
  const domains = useEntity(token, "/api/domains");
  const keys = useEntity(token, "/api/keys");
  const messages = useEntity(token, "/api/messages");
  const suppressions = useEntity(token, "/api/suppressions");

  const [view, setView] = useState("list"); // list | detail
  const [selected, setSelected] = useState("");
  const [listQ, setListQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [tab, setTab] = useState("overview");
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(emptyWsForm);
  const [messageOpen, setMessageOpen] = useState(false);
  const [messageForm, setMessageForm] = useState({
    subject: "",
    body: "",
    channel: "both", // email | internal | both
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const { copy: copyText, isCopied, copyIcon } = useCopyFeedback();

  const current = useMemo(() => rows.find((w) => w.id === selected) || null, [rows, selected]);

  useEffect(() => {
    if (view === "detail" && selected && rows.length && !rows.find((w) => w.id === selected)) {
      setView("list");
      setSelected("");
    }
  }, [rows, selected, view]);

  useEffect(() => {
    if (view === "detail" && current) setTab("overview");
  }, [current?.id, view]); // eslint-disable-line react-hooks/exhaustive-deps

  function countsFor(wsId) {
    return {
      domains: (domains.rows || []).filter((d) => d.workspace_id === wsId).length,
      keys: (keys.rows || []).filter((k) => k.workspace_id === wsId).length,
      messages: (messages.rows || []).filter((m) => m.workspace_id === wsId).length,
      suppressions: (suppressions.rows || []).filter((s) => s.workspace_id === wsId).length,
    };
  }

  const filtered = useMemo(() => {
    const q = listQ.trim().toLowerCase();
    return rows.filter((w) => {
      if (statusFilter !== "all" && String(w.status) !== statusFilter) return false;
      if (typeFilter !== "all" && String(w.type) !== typeFilter) return false;
      if (!q) return true;
      const hay = `${w.name} ${w.type} ${w.region} ${w.timezone} ${w.status} ${w.id} ${w.owner_email || ""} ${w.owner_display_name || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [rows, listQ, statusFilter, typeFilter]);

  const wsFilterKey = `${listQ}|${statusFilter}|${typeFilter}`;
  const listPager = useClientPager(filtered, { resetKey: wsFilterKey });
  const listBulk = useBulkSelection(listPager.pageRows, { resetKey: wsFilterKey });

  const activeN = rows.filter((w) => String(w.status).toLowerCase() === "active").length;
  const pausedN = rows.filter((w) => String(w.status).toLowerCase() === "paused").length;
  const archivedN = rows.filter((w) => String(w.status).toLowerCase() === "archived").length;
  const ownersN = new Set(rows.map((w) => w.owner_user_id || w.owner_email).filter(Boolean)).size;
  const curCounts = current ? countsFor(current.id) : { domains: 0, keys: 0, messages: 0, suppressions: 0 };

  const relatedDomains = current ? (domains.rows || []).filter((d) => d.workspace_id === current.id) : [];
  const relatedKeys = current ? (keys.rows || []).filter((k) => k.workspace_id === current.id) : [];
  const relatedMessages = current
    ? (messages.rows || []).filter((m) => m.workspace_id === current.id).slice(0, 40)
    : [];
  const relatedSuppressions = current
    ? (suppressions.rows || []).filter((s) => s.workspace_id === current.id)
    : [];

  const health = current
    ? workspaceHealth(curCounts, {
        domainVerified: relatedDomains.some((d) => d.status === "verified"),
        activeKey: relatedKeys.some((k) => String(k.status).toLowerCase() === "active"),
        hasOwner: !!(current.owner_email || current.owner_user_id),
      })
    : null;

  const ownerOptions = useMemo(() => {
    const opts = [{ value: "", label: "Signed-in user (default)" }];
    for (const u of users.rows || []) {
      opts.push({
        value: u.id,
        label: `${u.email}${u.display_name ? ` · ${u.display_name}` : ""}`,
      });
    }
    return opts;
  }, [users.rows]);

  function openWorkspace(id) {
    setSelected(id);
    setView("detail");
    setMsg("");
  }

  function backToList() {
    setView("list");
    setSelected("");
    setMsg("");
  }

  async function createWorkspace(e) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    try {
      const body = {
        name: createForm.name.trim(),
        type: createForm.type,
        region: createForm.region || "",
        timezone: createForm.timezone || "",
        status: createForm.status || "Active",
      };
      if (createForm.ownerUserId) body.ownerUserId = createForm.ownerUserId;
      const data = await api("/api/workspaces", { method: "POST", token, body });
      setMsg(`User workspace “${data.workspace?.name || createForm.name}” created.`);
      setCreateOpen(false);
      setCreateForm(emptyWsForm());
      await load();
      if (data.workspace?.id) openWorkspace(data.workspace.id);
      onChanged?.();
    } catch (ex) {
      setMsg(redact(ex.message));
    } finally {
      setBusy(false);
    }
  }

  async function sendMessageToUser(e) {
    e?.preventDefault?.();
    if (!current?.owner_email && !current?.owner_user_id) {
      setMsg("This workspace has no owner to message.");
      return;
    }
    const channel = ["email", "internal", "both"].includes(messageForm.channel)
      ? messageForm.channel
      : "both";
    if ((channel === "email" || channel === "both") && !current.owner_email) {
      setMsg("Owner email is required to send email.");
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      const subject = messageForm.subject.trim() || `Message about ${current.name}`;
      const bodyText = messageForm.body.trim();
      const data = await api("/api/internal-messages", {
        method: "POST",
        token,
        body: {
          channel,
          workspaceId: current.id,
          to: current.owner_email || undefined,
          toUserId: current.owner_user_id || undefined,
          subject,
          body: bodyText,
          from: "noreply@senditto.local",
        },
      });
      if (channel === "both" && data.emailMessage && data.internalMessage) {
        setMsg(
          `Sent both ways: email to ${current.owner_email} and internal inbox for “${current.name}”.`
        );
      } else if (channel === "email" && data.emailMessage) {
        setMsg(`Email queued to ${current.owner_email}.`);
      } else if (channel === "internal" && data.internalMessage) {
        setMsg(`Internal message posted for workspace “${current.name}”.`);
      } else if (data.emailMessage || data.internalMessage) {
        setMsg("Message sent.");
      } else {
        setMsg("Message request completed.");
      }
      setMessageOpen(false);
      setMessageForm({ subject: "", body: "", channel: "both" });
      await messages.load();
      onChanged?.();
    } catch (ex) {
      setMsg(redact(ex.message));
    } finally {
      setBusy(false);
    }
  }

  function openMessageComposer(w = current) {
    if (!w) return;
    setMessageForm({
      subject: `About your workspace “${w.name}”`,
      body: "",
      channel: "both",
    });
    setMessageOpen(true);
  }

  async function setStatus(ws, status) {
    const target = ws || current;
    if (!target) return;
    const ok = await confirm({
      title: `${status} workspace`,
      message: `Set “${target.name}” to ${status}?`,
      danger: status === "Archived",
      confirmLabel: status,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api(`/api/workspaces/${target.id}`, { method: "PATCH", token, body: { status } });
      setMsg(`“${target.name}” → ${status}`);
      await load();
      onChanged?.();
    } catch (ex) {
      setMsg(redact(ex.message));
    } finally {
      setBusy(false);
    }
  }

  async function bulkSetWorkspaceStatus(status) {
    if (!listBulk.count) return;
    const ids = [...listBulk.selectedIds];
    const ok = await confirm({
      title: `Bulk: ${status}`,
      message: `Set ${ids.length} selected workspace${ids.length === 1 ? "" : "s"} to ${status}?`,
      danger: status === "Archived",
      confirmLabel: status,
    });
    if (!ok) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await runBulk(ids, (id) =>
        api(`/api/workspaces/${id}`, { method: "PATCH", token, body: { status } })
      );
      setMsg(res.fail ? `Updated ${res.ok}, failed ${res.fail}` : `Updated ${res.ok} workspace${res.ok === 1 ? "" : "s"} → ${status}`);
      listBulk.clear();
      await load();
      onChanged?.();
    } catch (ex) {
      setMsg(redact(ex.message));
    } finally {
      setBusy(false);
    }
  }

  async function removeWorkspace(ws) {
    const target = ws || current;
    if (!target) return;
    const c = countsFor(target.id);
    const linked = c.domains + c.keys + c.messages + c.suppressions;
    if (linked > 0) {
      const ok = await confirm({
        title: "Cannot delete yet",
        message: `“${target.name}” still has user data (domains ${c.domains}, keys ${c.keys}, messages ${c.messages}, suppressions ${c.suppressions}). Archive instead?`,
        confirmLabel: "Archive",
        danger: true,
      });
      if (!ok) return;
      setBusy(true);
      try {
        await api(`/api/workspaces/${target.id}`, { method: "PATCH", token, body: { status: "Archived" } });
        setMsg("Archived — user data kept");
        await load();
        onChanged?.();
      } catch (ex) {
        setMsg(redact(ex.message));
      } finally {
        setBusy(false);
      }
      return;
    }
    const ok = await confirm({
      title: "Delete user workspace",
      message: `Permanently delete “${target.name}”?`,
      danger: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api(`/api/workspaces/${target.id}`, { method: "DELETE", token });
      setMsg("Workspace deleted");
      if (selected === target.id) backToList();
      await load();
      onChanged?.();
    } catch (ex) {
      setMsg(redact(ex.message));
    } finally {
      setBusy(false);
    }
  }

  function refreshAll() {
    load();
    users.load();
    domains.load();
    keys.load();
    messages.load();
    suppressions.load();
  }

  function menuFor(w, { detail = false } = {}) {
    const st = String(w.status || "").toLowerCase();
    const items = [];
    if (!detail) {
      items.push({ id: "open", label: "Open workspace", onClick: () => openWorkspace(w.id) });
    }
    items.push(
      {
        id: "message",
        label: "Message user",
        disabled: !w.owner_email && !w.owner_user_id,
        onClick: () => {
          if (detail || selected === w.id) openMessageComposer(w);
          else {
            openWorkspace(w.id);
            setTimeout(() => openMessageComposer(w), 0);
          }
        },
      },
      {
        id: "copy-email",
        label: isCopied(`email-${w.id}`) ? "Copied" : "Copy owner email",
        icon: copyIcon(`email-${w.id}`),
        disabled: !w.owner_email,
        onClick: () => copyText(w.owner_email, `email-${w.id}`),
      },
      {
        id: "copy-id",
        label: isCopied(`id-${w.id}`) ? "Copied" : "Copy workspace ID",
        icon: copyIcon(`id-${w.id}`),
        onClick: () => copyText(w.id, `id-${w.id}`),
      }
    );
    if (detail) {
      items.push(
        { id: "data", label: "View user data", onClick: () => setTab("related") },
        { id: "profile", label: "View profile", onClick: () => setTab("profile") }
      );
    }
    items.push(
      {
        id: "toggle",
        label: st === "active" ? "Pause workspace" : "Activate workspace",
        onClick: () => setStatus(w, st === "active" ? "Paused" : "Active"),
      },
      {
        id: "archive",
        label: "Archive workspace",
        onClick: () => setStatus(w, "Archived"),
      },
      {
        id: "delete",
        label: "Delete workspace",
        danger: true,
        onClick: () => removeWorkspace(w),
      }
    );
    return items;
  }

  /* —— LIST VIEW: table with workspace in the middle, ⋮ actions on the right —— */
  if (view === "list") {
    return (
      <>
        <PageHead
          title="User workspaces"
          copy="Homes for product users. Open a row for the full workspace, or use ⋮ for actions."
          actions={
            <>
              <button className="btn" type="button" onClick={refreshAll} disabled={loading}>
                <RefreshCw size={15} /> Refresh
              </button>
              <button className="btn primary" type="button" onClick={() => setCreateOpen(true)}>
                <Plus size={15} /> New workspace
              </button>
            </>
          }
        />
        {msg ? <Banner tone={/fail|error|cannot|required/i.test(msg) ? "bad" : "ok"}>{msg}</Banner> : null}
        {err ? <Banner tone="bad">{err}</Banner> : null}

        <StatGrid
          items={[
            {
              label: "Workspaces",
              value: fmtNum(rows.length),
              hint: `${fmtNum(filtered.length)} shown`,
              tone: "blue",
              icon: <Layers size={16} />,
            },
            {
              label: "Active",
              value: fmtNum(activeN),
              hint: `${fmtNum(pausedN)} paused · ${fmtNum(archivedN)} archived`,
              tone: "green",
            },
            {
              label: "Owners",
              value: fmtNum(ownersN),
              hint: "Users with a workspace",
              tone: "purple",
              icon: <Users size={16} />,
            },
            {
              label: "In list",
              value: fmtNum(filtered.length),
              hint: listQ || statusFilter !== "all" || typeFilter !== "all" ? "Filtered" : "All rows",
              tone: "amber",
            },
          ]}
        />

        <Panel
          title="All user workspaces"
          copy={loading ? "Loading…" : `${fmtNum(filtered.length)} of ${fmtNum(rows.length)}`}
          actions={null}
        >
          <div className="ws-table-toolbar">
            <div className="tables-search-wrap wide">
              <Search size={14} className="tables-search-ico" />
              <input
                className="tables-search"
                placeholder="Search workspace, owner, type…"
                value={listQ}
                onChange={(e) => setListQ(e.target.value)}
              />
            </div>
            <div className="ws-chip-row">
              {[
                { id: "all", label: "All" },
                { id: "Active", label: "Active" },
                { id: "Paused", label: "Paused" },
                { id: "Archived", label: "Archived" },
              ].map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`ws-chip ${statusFilter === c.id ? "active" : ""}`}
                  onClick={() => setStatusFilter(c.id)}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <AppSelect
              size="sm"
              className="ws-filter-select"
              value={typeFilter}
              onChange={setTypeFilter}
              options={[
                { value: "all", label: "All types" },
                ...WS_TYPES.map((t) => ({ value: t, label: t.replace(" workspace", "") })),
              ]}
              aria-label="Type"
            />
          </div>

          {!loading && filtered.length === 0 ? (
            <div className="empty">
              <b>No user workspaces</b>
              {rows.length ? "Nothing matches this filter." : "Create the first user workspace."}
            </div>
          ) : (
            <div className="paged-table-stack">
            <BulkBar
              count={listBulk.count}
              noun={listBulk.count === 1 ? "workspace selected" : "workspaces selected"}
              pageCount={listPager.pageRows.length}
              filteredCount={filtered.length}
              onClear={listBulk.clear}
              onSelectPage={listBulk.togglePage}
              onSelectAll={() => listBulk.selectAll(filtered)}
              allPageSelected={listBulk.allPageSelected}
              emptyHint="Select workspaces with the checkboxes, then activate, pause, or archive in bulk."
            >
              <button type="button" className="btn sm" disabled={busy || !listBulk.count} onClick={() => bulkSetWorkspaceStatus("Active")}>
                Activate
              </button>
              <button type="button" className="btn sm" disabled={busy || !listBulk.count} onClick={() => bulkSetWorkspaceStatus("Paused")}>
                Pause
              </button>
              <button type="button" className="btn sm danger" disabled={busy || !listBulk.count} onClick={() => bulkSetWorkspaceStatus("Archived")}>
                Archive
              </button>
            </BulkBar>
            <TableShell rowCount={listPager.pageRows.length} className="ws-table-wrap">
              <table className="data ws-table">
                <thead>
                  <tr>
                    <BulkSelectHeader
                      checked={listBulk.allPageSelected}
                      indeterminate={listBulk.somePageSelected && !listBulk.allPageSelected}
                      onChange={listBulk.togglePage}
                    />
                    <th className="ws-col-owner">Owner</th>
                    <th className="ws-col-workspace">Workspace</th>
                    <th className="ws-col-type">Type</th>
                    <th className="ws-col-status">Status</th>
                    <th className="ws-col-activity">Activity</th>
                    <th className="ws-col-updated">Updated</th>
                    <th className="ws-col-actions" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {listPager.pageRows.map((w) => {
                    const c = countsFor(w.id);
                    return (
                      <tr
                        key={w.id}
                        className={`clickable ws-table-row ${listBulk.isSelected(w.id) ? "bulk-selected" : ""}`}
                        onClick={() => openWorkspace(w.id)}
                      >
                        <BulkSelectCell
                          checked={listBulk.isSelected(w.id)}
                          onChange={() => listBulk.toggle(w.id)}
                          label={`Select ${w.name}`}
                        />
                        <td className="ws-col-owner">
                          <div className="ws-owner-cell">
                            <span className="ws-table-avatar sm">{(w.owner_email || "U")[0]?.toUpperCase()}</span>
                            <div>
                              <b>{w.owner_display_name || w.owner_email || "No owner"}</b>
                              {w.owner_email && w.owner_display_name ? (
                                <small className="mono">{w.owner_email}</small>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td className="ws-col-workspace">
                          <div className="ws-name-cell">
                            <span className="ws-table-avatar" data-status={String(w.status || "").toLowerCase()}>
                              {workspaceInitial(w)}
                            </span>
                            <div>
                              <b className="ws-name-main">{w.name}</b>
                              <small className="mono">{String(w.id).slice(0, 8)}…</small>
                            </div>
                          </div>
                        </td>
                        <td className="ws-col-type">
                          <span className="ws-type-pill">{(w.type || "—").replace(" workspace", "")}</span>
                        </td>
                        <td className="ws-col-status">
                          <span className={`tag ${statusTone(w.status)}`}>{w.status || "—"}</span>
                        </td>
                        <td className="ws-col-activity">
                          <div className="ws-activity-cell">
                            <span>{fmtNum(c.domains)} domains</span>
                            <span>{fmtNum(c.keys)} keys</span>
                            <span>{fmtNum(c.messages)} msgs</span>
                          </div>
                        </td>
                        <td className="ws-col-updated">{fmtTime(w.updated_at || w.created_at)}</td>
                        <td className="ws-col-actions" onClick={(e) => e.stopPropagation()}>
                          <RowMenu items={menuFor(w)} label={`Actions for ${w.name}`} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableShell>
            <TablePager
              page={listPager.page}
              pageCount={listPager.pageCount}
              total={listPager.total}
              from={listPager.from}
              to={listPager.to}
              pageNumbers={listPager.pageNumbers}
              middlePage={listPager.middlePage}
              onPageChange={listPager.setPage}
              onFirst={listPager.goFirst}
              onMiddle={listPager.goMiddle}
              onLast={listPager.goLast}
              onPrev={listPager.goPrev}
              onNext={listPager.goNext}
            />
            </div>
          )}
        </Panel>

        {createOpen ? (
          <Modal title="New user workspace" onClose={() => !busy && setCreateOpen(false)} wide>
            <p className="page-copy" style={{ marginTop: 0 }}>
              Create a home for a product user and optionally assign the owner account.
            </p>
            <form className="form" onSubmit={createWorkspace}>
              <Field label="Workspace name" full>
                <input
                  required
                  autoFocus
                  value={createForm.name}
                  onChange={(e) => setCreateForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Acme production"
                />
              </Field>
              <Field label="Owner (user)" full>
                <AppSelect
                  value={createForm.ownerUserId || ""}
                  onChange={(ownerUserId) => setCreateForm((p) => ({ ...p, ownerUserId }))}
                  options={ownerOptions}
                />
              </Field>
              <Field label="Type">
                <AppSelect
                  value={createForm.type}
                  onChange={(type) => setCreateForm((p) => ({ ...p, type }))}
                  options={WS_TYPES}
                />
              </Field>
              <Field label="Primary region">
                <AppSelect
                  value={createForm.region || ""}
                  onChange={(region) => setCreateForm((p) => ({ ...p, region }))}
                  options={WS_REGIONS}
                />
              </Field>
              <Field label="Timezone" full>
                <input
                  value={createForm.timezone}
                  onChange={(e) => setCreateForm((p) => ({ ...p, timezone: e.target.value }))}
                />
              </Field>
              <div className="full" style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button className="btn" type="button" disabled={busy} onClick={() => setCreateOpen(false)}>
                  Cancel
                </button>
                <button className="btn primary" type="submit" disabled={busy || !createForm.name.trim()}>
                  {busy ? "Creating…" : "Create workspace"}
                </button>
              </div>
            </form>
          </Modal>
        ) : null}
      </>
    );
  }

  /* —— FULL PAGE DETAIL for one user workspace —— */
  if (!current) {
    return (
      <>
        <PageHead title="User workspace" copy="Workspace not found." />
        <button className="btn" type="button" onClick={backToList}>
          <ArrowLeft size={15} /> Back to list
        </button>
      </>
    );
  }

  return (
    <>
      <div className="ws-full-top">
        <button className="btn ghost sm ws-back" type="button" onClick={backToList}>
          <ArrowLeft size={15} /> All workspaces
        </button>
      </div>

      <PageHead
        title={current.name}
        copy={`User workspace · owner ${current.owner_email || current.owner_display_name || "not set"}`}
        actions={
          <>
            <button className="btn" type="button" onClick={refreshAll} disabled={busy}>
              <RefreshCw size={15} /> Refresh
            </button>
            <button
              className="btn primary"
              type="button"
              disabled={busy || (!current.owner_email && !current.owner_user_id)}
              onClick={() => openMessageComposer(current)}
            >
              <Mail size={15} /> Message user
            </button>
            <RowMenu items={menuFor(current, { detail: true })} label="Workspace actions" />
          </>
        }
      />
      {msg ? <Banner tone={/fail|error|cannot|required/i.test(msg) ? "bad" : "ok"}>{msg}</Banner> : null}

      <header className="ws-full-hero">
        <div className="ws-stage-avatar lg" data-status={String(current.status || "").toLowerCase()}>
          {workspaceInitial(current)}
        </div>
        <div className="ws-full-hero-main">
          <div className="ws-stage-title-row">
            <h2>{current.name}</h2>
            <span className={`tag ${statusTone(current.status)}`}>{current.status}</span>
          </div>
          <p className="ws-stage-sub">
            <span className="ws-owner-pill">
              <Users size={13} />
              {current.owner_email || current.owner_display_name || "No owner"}
            </span>
            <span>{current.type || "—"}</span>
            {current.region ? <span>{current.region}</span> : null}
            {current.timezone ? <span>{current.timezone}</span> : null}
          </p>
          <div className="ws-full-hero-actions">
            <button
              className="btn sm primary"
              type="button"
              disabled={(!current.owner_email && !current.owner_user_id) || busy}
              onClick={() => openMessageComposer(current)}
            >
              <Mail size={14} /> Message user
            </button>
            <CopyButton
              text={current.owner_email}
              label="Copy email"
              copiedLabel="Email copied"
              disabled={!current.owner_email}
            />
            <CopyButton text={current.id} label="Copy ID" copiedLabel="ID copied" />
            <button className="btn sm" type="button" onClick={() => setTab("related")}>
              View user data
            </button>
            {String(current.status).toLowerCase() === "active" ? (
              <button className="btn sm" type="button" disabled={busy} onClick={() => setStatus(current, "Paused")}>
                Pause
              </button>
            ) : (
              <button className="btn sm" type="button" disabled={busy} onClick={() => setStatus(current, "Active")}>
                Activate
              </button>
            )}
            <button className="btn sm" type="button" disabled={busy} onClick={() => setStatus(current, "Archived")}>
              Archive
            </button>
            <button className="btn sm danger" type="button" disabled={busy} onClick={() => removeWorkspace(current)}>
              Delete
            </button>
          </div>
        </div>
        <SetupRing score={health?.score || 0} size={128} stroke={11} />
      </header>

      <div className="ws-tabs ws-full-tabs" role="tablist">
        {[
          ["overview", "Overview"],
          ["profile", "Profile"],
          [
            "related",
            "User data",
            curCounts.domains + curCounts.keys + curCounts.messages + curCounts.suppressions,
          ],
          ["actions", "Actions"],
        ].map(([id, label, badge]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            {label}
            {badge != null ? <em>{fmtNum(badge)}</em> : null}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <div className="ws-full-body">
          <div className="ws-setup-panel">
            <SetupRing score={health?.score || 0} size={148} stroke={12} />
            <div className="ws-setup-panel-main">
              <b>Setup progress</b>
              <p>
                Filled in automatically from what this user has done — domains, keys, and messages. Staff cannot
                mark setup complete by hand.
              </p>
              <ul className="ws-setup-checks">
                {(health?.items || []).map((it) => (
                  <li key={it.id} className={it.ok ? "ok" : "miss"}>
                    <span className="ws-setup-dot" aria-hidden>
                      {it.ok ? "✓" : ""}
                    </span>
                    {it.label}
                  </li>
                ))}
              </ul>
              <div className="ws-hero-bar tall">
                <i style={{ width: `${health?.score || 0}%` }} />
              </div>
              <small className="ws-setup-meta">
                {health?.done || 0} of {health?.total || 0} steps complete
              </small>
            </div>
          </div>

          <div className="ws-metric-grid">
            {[
              { label: "Domains", n: curCounts.domains, hint: "Sending identity", tone: "blue" },
              { label: "API keys", n: curCounts.keys, hint: "Credentials", tone: "purple" },
              { label: "Messages", n: curCounts.messages, hint: "Mail activity", tone: "green" },
              { label: "Suppressions", n: curCounts.suppressions, hint: "Block list", tone: "amber" },
            ].map((m) => (
              <article key={m.label} className={`ws-metric tone-${m.tone}`}>
                <small>{m.label}</small>
                <b>{fmtNum(m.n)}</b>
                <span>{m.hint}</span>
              </article>
            ))}
          </div>
          <div className="ws-detail-grid">
            <div className="ws-detail-card">
              <h4>Owner</h4>
              <div className="ws-detail-owner">
                <div className="ws-stage-avatar sm">{(current.owner_email || "U")[0]?.toUpperCase()}</div>
                <div>
                  <b>{current.owner_display_name || current.owner_email || "Not assigned"}</b>
                  <span className="mono">{current.owner_email || "—"}</span>
                </div>
              </div>
              <div className="ws-full-hero-actions" style={{ marginTop: 0 }}>
                <button
                  className="btn sm primary"
                  type="button"
                  disabled={(!current.owner_email && !current.owner_user_id) || busy}
                  onClick={() => openMessageComposer(current)}
                >
                  <Mail size={14} /> Message user
                </button>
              </div>
            </div>
            <div className="ws-detail-card">
              <h4>As the user set it</h4>
              <div className="kv compact">
                <div>
                  <span>Type</span>
                  <b>{current.type || "—"}</b>
                </div>
                <div>
                  <span>Region</span>
                  <b>{current.region || "Not set"}</b>
                </div>
                <div>
                  <span>Timezone</span>
                  <b>{current.timezone || "Not set"}</b>
                </div>
                <div>
                  <span>Status</span>
                  <b>{current.status || "—"}</b>
                </div>
                <div>
                  <span>Created</span>
                  <b>{fmtTime(current.created_at)}</b>
                </div>
                <div>
                  <span>Updated</span>
                  <b>{fmtTime(current.updated_at)}</b>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {tab === "profile" ? (
        <div className="ws-full-body">
          <Panel
            title="User profile"
            copy="Read-only. Values come from what the user set in the product — studio cannot rewrite their profile by hand."
          >
            <div className="ws-profile-readonly">
              <div className="ws-profile-banner">
                Automatic from the user’s workspace settings. To change how the account is run, use Actions
                (pause, archive, message) — not profile editing.
              </div>
              <div className="kv">
                <div>
                  <span>Workspace name</span>
                  <b>{current.name || "—"}</b>
                </div>
                <div>
                  <span>Owner name</span>
                  <b>{current.owner_display_name || "—"}</b>
                </div>
                <div>
                  <span>Owner email</span>
                  <b className="mono">{current.owner_email || "—"}</b>
                </div>
                <div>
                  <span>Type</span>
                  <b>{current.type || "—"}</b>
                </div>
                <div>
                  <span>Region</span>
                  <b>{current.region || "Not set by user"}</b>
                </div>
                <div>
                  <span>Timezone</span>
                  <b>{current.timezone || "Not set by user"}</b>
                </div>
                <div>
                  <span>Status</span>
                  <b>
                    <span className={`tag ${statusTone(current.status)}`}>{current.status || "—"}</span>
                  </b>
                </div>
                <div>
                  <span>Workspace ID</span>
                  <b className="mono">{current.id}</b>
                </div>
                <div>
                  <span>Created</span>
                  <b>{fmtTime(current.created_at)}</b>
                </div>
                <div>
                  <span>Last updated</span>
                  <b>{fmtTime(current.updated_at)}</b>
                </div>
              </div>
            </div>
          </Panel>
        </div>
      ) : null}

      {tab === "actions" ? (
        <div className="ws-full-body">
          <div className="ws-action-grid">
            <button
              type="button"
              className="ws-action-card"
              disabled={(!current.owner_email && !current.owner_user_id) || busy}
              onClick={() => openMessageComposer(current)}
            >
              <Mail size={20} />
              <b>Message user</b>
              <span>Email, internal inbox, or both</span>
            </button>
            <CopyButton
              className="ws-action-card"
              text={current.owner_email}
              label="Copy owner email"
              copiedLabel="Email copied"
              description={current.owner_email || "No owner email on this workspace"}
              iconSize={20}
              labelAs="b"
              disabled={!current.owner_email}
            />
            <CopyButton
              className="ws-action-card"
              text={current.id}
              label="Copy workspace ID"
              copiedLabel="ID copied"
              description="For support and logs"
              iconSize={20}
              labelAs="b"
            />
            <button type="button" className="ws-action-card" onClick={() => setTab("related")}>
              <Layers size={20} />
              <b>Open user data</b>
              <span>Domains, keys, messages, suppressions</span>
            </button>
            <button type="button" className="ws-action-card" onClick={() => setTab("profile")}>
              <Users size={20} />
              <b>View profile</b>
              <span>Read-only settings the user configured</span>
            </button>
            {String(current.status).toLowerCase() === "active" ? (
              <button
                type="button"
                className="ws-action-card"
                disabled={busy}
                onClick={() => setStatus(current, "Paused")}
              >
                <Ban size={20} />
                <b>Pause workspace</b>
                <span>Stop normal use without deleting data</span>
              </button>
            ) : (
              <button
                type="button"
                className="ws-action-card"
                disabled={busy}
                onClick={() => setStatus(current, "Active")}
              >
                <Activity size={20} />
                <b>Activate workspace</b>
                <span>Restore an inactive user workspace</span>
              </button>
            )}
            <button
              type="button"
              className="ws-action-card"
              disabled={busy}
              onClick={() => setStatus(current, "Archived")}
            >
              <HardDrive size={20} />
              <b>Archive workspace</b>
              <span>Keep history, mark as archived</span>
            </button>
            <button
              type="button"
              className="ws-action-card danger"
              disabled={busy}
              onClick={() => removeWorkspace(current)}
            >
              <Ban size={20} />
              <b>Delete workspace</b>
              <span>Only if no linked user data remains</span>
            </button>
          </div>
        </div>
      ) : null}

      {tab === "related" ? (
        <div className="ws-full-body">
          <div className="ws-related-head">
            <b>Data in this user workspace</b>
            <span>
              {fmtNum(relatedDomains.length)} domains · {fmtNum(relatedKeys.length)} keys ·{" "}
              {fmtNum(relatedMessages.length)} messages · {fmtNum(relatedSuppressions.length)} suppressions
            </span>
          </div>
          <h4 className="subh">Domains</h4>
          <PagedDataTable
            rows={relatedDomains}
            empty="No domains yet for this user."
            columns={[
              { key: "domain", label: "Domain", mono: true },
              {
                key: "status",
                label: "Status",
                render: (d) => (
                  <span className={`tag ${d.status === "verified" ? "ok" : "warn"}`}>{d.status}</span>
                ),
              },
              {
                key: "auth",
                label: "Auth",
                render: (d) =>
                  `SPF ${d.spf ? "✓" : "—"} · DKIM ${d.dkim ? "✓" : "—"} · DMARC ${d.dmarc ? "✓" : "—"}`,
              },
              { key: "created_at", label: "Created", render: (d) => fmtTime(d.created_at) },
            ]}
          />
          <h4 className="subh">API keys</h4>
          <PagedDataTable
            rows={relatedKeys}
            empty="No API keys yet for this user."
            columns={[
              { key: "name", label: "Name" },
              { key: "key_prefix", label: "Prefix", mono: true },
              {
                key: "status",
                label: "Status",
                render: (k) => (
                  <span className={`tag ${k.status === "active" ? "ok" : "bad"}`}>{k.status}</span>
                ),
              },
              { key: "created_at", label: "Created", render: (k) => fmtTime(k.created_at) },
            ]}
          />
          <h4 className="subh">Messages</h4>
          <PagedDataTable
            rows={relatedMessages}
            empty="No messages yet for this user."
            columns={[
              { key: "to_email", label: "To", mono: true },
              { key: "subject", label: "Subject" },
              { key: "stream", label: "Stream" },
              {
                key: "status",
                label: "Status",
                render: (m) => <span className="tag">{m.status}</span>,
              },
              { key: "created_at", label: "When", render: (m) => fmtTime(m.created_at) },
            ]}
          />
          <h4 className="subh">Suppressions</h4>
          <PagedDataTable
            rows={relatedSuppressions}
            empty="No suppressions for this user workspace."
            columns={[
              { key: "email", label: "Email", mono: true },
              { key: "reason", label: "Reason" },
              { key: "created_at", label: "When", render: (s) => fmtTime(s.created_at) },
            ]}
          />
        </div>
      ) : null}

      {messageOpen ? (
        <Modal
          title={
            messageForm.channel === "email"
              ? "Send email"
              : messageForm.channel === "internal"
                ? "Send internal message"
                : "Send email + internal message"
          }
          onClose={() => !busy && setMessageOpen(false)}
          wide
        >
          <p className="page-copy" style={{ marginTop: 0 }}>
            {messageForm.channel === "email"
              ? "This goes out by email only — not to the internal inbox."
              : messageForm.channel === "internal"
                ? "This stays inside the product inbox — no email is sent."
                : "One message is delivered two ways: email and internal inbox."}
          </p>
          <form className="form" onSubmit={sendMessageToUser}>
            <Field label="How to send" full>
              <div className="msg-channel-grid" role="radiogroup" aria-label="Delivery channel">
                {[
                  {
                    id: "email",
                    title: "Email only",
                    desc: "Outbound email to the owner address",
                  },
                  {
                    id: "internal",
                    title: "Internal only",
                    desc: "In-app inbox for this workspace user",
                  },
                  {
                    id: "both",
                    title: "Email + internal",
                    desc: "Same content on both channels",
                  },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    role="radio"
                    aria-checked={messageForm.channel === opt.id}
                    className={`msg-channel-card ${messageForm.channel === opt.id ? "active" : ""}`}
                    onClick={() => setMessageForm((p) => ({ ...p, channel: opt.id }))}
                  >
                    <b>{opt.title}</b>
                    <span>{opt.desc}</span>
                  </button>
                ))}
              </div>
            </Field>

            <Field
              label={
                messageForm.channel === "email"
                  ? "Email destination"
                  : messageForm.channel === "internal"
                    ? "Internal destination"
                    : "Destinations"
              }
              full
            >
              <div className="msg-dest-grid">
                {(messageForm.channel === "email" || messageForm.channel === "both") && (
                  <div className="msg-dest-card email">
                    <small>Email</small>
                    <b className="mono">{current.owner_email || "No owner email"}</b>
                    <span>Queued as transactional email for the workspace owner</span>
                  </div>
                )}
                {(messageForm.channel === "internal" || messageForm.channel === "both") && (
                  <div className="msg-dest-card internal">
                    <small>Internal inbox</small>
                    <b>{current.name || "Workspace"}</b>
                    <span className="mono msg-dest-id">ID: {current.id}</span>
                    <span>
                      Owner: {current.owner_display_name || current.owner_email || "—"}
                      {current.owner_email ? ` · ${current.owner_email}` : ""}
                    </span>
                  </div>
                )}
              </div>
            </Field>

            <Field
              label={messageForm.channel === "internal" ? "Subject (inbox)" : "Subject"}
              full
            >
              <input
                required
                value={messageForm.subject}
                onChange={(e) => setMessageForm((p) => ({ ...p, subject: e.target.value }))}
                placeholder={
                  messageForm.channel === "internal"
                    ? "Subject shown in the user’s inbox"
                    : messageForm.channel === "email"
                      ? "Email subject line"
                      : "Subject for email and inbox"
                }
              />
            </Field>
            <Field
              label={
                messageForm.channel === "internal"
                  ? "Message (inbox)"
                  : messageForm.channel === "email"
                    ? "Message (email)"
                    : "Message (same for email + inbox)"
              }
              full
            >
              <textarea
                rows={5}
                value={messageForm.body}
                onChange={(e) => setMessageForm((p) => ({ ...p, body: e.target.value }))}
                placeholder={
                  messageForm.channel === "internal"
                    ? "Written for the internal product inbox"
                    : messageForm.channel === "email"
                      ? "Body / note for the email"
                      : "Same text is used for email and internal delivery"
                }
              />
            </Field>

            {messageForm.channel === "both" ? (
              <div className="msg-both-note full">
                <b>Both channels</b>
                <span>
                  Email → <span className="mono">{current.owner_email || "—"}</span>
                  {" · "}
                  Internal → workspace <b>{current.name}</b>{" "}
                  <span className="mono">({String(current.id).slice(0, 8)}…)</span>
                </span>
              </div>
            ) : null}

            <div className="full" style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn" type="button" disabled={busy} onClick={() => setMessageOpen(false)}>
                Cancel
              </button>
              <button
                className="btn primary"
                type="submit"
                disabled={
                  busy ||
                  (!current.owner_email && !current.owner_user_id) ||
                  ((messageForm.channel === "email" || messageForm.channel === "both") &&
                    !current.owner_email)
                }
              >
                {busy
                  ? "Sending…"
                  : messageForm.channel === "both"
                    ? "Send both ways"
                    : messageForm.channel === "internal"
                      ? "Send internal message"
                      : "Send email"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

/** Senditto DNS records shown for a sending domain (matches product platform). */
function domainDnsRecords(domain) {
  const d = String(domain || "yourdomain.com").toLowerCase();
  return [
    {
      type: "TXT",
      host: "@",
      value: "v=spf1 include:_spf.senditto.com ~all",
      check: "spf",
      label: "SPF",
    },
    {
      type: "CNAME",
      host: `s1._domainkey.${d}`,
      value: "s1.dkim.senditto.com",
      check: "dkim",
      label: "DKIM (s1)",
    },
    {
      type: "CNAME",
      host: `s2._domainkey.${d}`,
      value: "s2.dkim.senditto.com",
      check: "dkim",
      label: "DKIM (s2)",
    },
    {
      type: "TXT",
      host: `_dmarc.${d}`,
      value: `v=DMARC1; p=none; rua=mailto:dmarc@${d}`,
      check: "dmarc",
      label: "DMARC",
    },
  ];
}

function domainStatusTone(status) {
  const s = String(status || "").toLowerCase();
  if (s === "verified") return "ok";
  if (s === "failed") return "bad";
  return "warn";
}

function domainStatusLabel(status) {
  const s = String(status || "").toLowerCase();
  if (s === "verified") return "Verified";
  if (s === "failed") return "Action needed";
  if (s === "pending") return "Pending";
  return status || "—";
}

function AuthBadge({ on, label }) {
  return (
    <span className={`dom-auth-badge ${on ? "on" : "off"}`} title={`${label}: ${on ? "set" : "not set"}`}>
      {on ? <Check size={12} strokeWidth={2.5} /> : <X size={12} strokeWidth={2.5} />}
      {label}
    </span>
  );
}

export function DomainsPage({ token, onChanged }) {
  const confirm = useAppConfirm();
  const { rows, total, err, loading, load } = useEntity(token, "/api/domains");
  const workspaces = useEntity(token, "/api/workspaces");

  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ domain: "", workspaceId: "" });

  const [detailId, setDetailId] = useState(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((d) => {
      const hay = `${d.domain || ""} ${d.workspace_name || ""} ${d.owner_email || ""} ${d.status || ""}`.toLowerCase();
      if (needle && !hay.includes(needle)) return false;
      if (statusFilter !== "all" && String(d.status || "").toLowerCase() !== statusFilter) return false;
      return true;
    });
  }, [rows, q, statusFilter]);

  const domainFilterKey = `${q}|${statusFilter}`;
  const pager = useClientPager(filtered, { resetKey: domainFilterKey });
  const bulk = useBulkSelection(pager.pageRows, { resetKey: domainFilterKey });

  const detail = useMemo(
    () => rows.find((d) => d.id === detailId) || null,
    [rows, detailId]
  );

  const workspaceOptions = useMemo(() => {
    const list = (workspaces.rows || []).map((w) => ({
      value: w.id,
      label: w.name || w.id,
    }));
    return [{ value: "", label: "Default workspace" }, ...list];
  }, [workspaces.rows]);

  const stats = useMemo(() => {
    const verified = rows.filter((d) => d.status === "verified").length;
    const pending = rows.filter((d) => d.status === "pending").length;
    const failed = rows.filter((d) => d.status === "failed").length;
    const authComplete = rows.filter((d) => d.spf && d.dkim && d.dmarc).length;
    return { verified, pending, failed, authComplete };
  }, [rows]);

  async function bulkDomainStatus(status, bodyExtra = {}) {
    if (!bulk.count) return;
    const ids = [...bulk.selectedIds];
    const ok = await confirm({
      title: `Bulk: ${domainStatusLabel(status)}`,
      message: `Apply “${domainStatusLabel(status)}” to ${ids.length} selected domain${ids.length === 1 ? "" : "s"}?`,
      confirmLabel: "Apply",
      danger: status === "failed",
    });
    if (!ok) return;
    setBusy(true);
    setMsg("");
    try {
      const payload =
        status === "verified"
          ? { verify: true }
          : { status, ...bodyExtra };
      const res = await runBulk(ids, (id) =>
        api(`/api/domains/${id}`, { method: "PATCH", token, body: payload })
      );
      setMsg(res.fail ? `Updated ${res.ok}, failed ${res.fail}` : `Updated ${res.ok} domain${res.ok === 1 ? "" : "s"}`);
      bulk.clear();
      await load();
      onChanged?.();
    } catch (ex) {
      setMsg(redact(ex.message));
    } finally {
      setBusy(false);
    }
  }

  async function bulkDeleteDomains() {
    if (!bulk.count) return;
    const ids = [...bulk.selectedIds];
    const ok = await confirm({
      title: "Bulk delete domains",
      message: `Delete ${ids.length} selected domain${ids.length === 1 ? "" : "s"}? This cannot be undone from the studio.`,
      danger: true,
      confirmLabel: "Delete selected",
    });
    if (!ok) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await runBulk(ids, (id) => api(`/api/domains/${id}`, { method: "DELETE", token }));
      setMsg(res.fail ? `Deleted ${res.ok}, failed ${res.fail}` : `Deleted ${res.ok} domain${res.ok === 1 ? "" : "s"}`);
      if (detailId && ids.some((id) => String(id) === String(detailId))) setDetailId(null);
      bulk.clear();
      await load();
      onChanged?.();
    } catch (ex) {
      setMsg(redact(ex.message));
    } finally {
      setBusy(false);
    }
  }

  async function createDomain(e) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    try {
      const body = { domain: form.domain.trim() };
      if (form.workspaceId) body.workspaceId = form.workspaceId;
      const data = await api("/api/domains", { method: "POST", token, body });
      setMsg(`Domain ${data.domain?.domain || form.domain} added as pending`);
      setCreateOpen(false);
      setForm({ domain: "", workspaceId: form.workspaceId || "" });
      await load();
      onChanged?.();
      if (data.domain?.id) setDetailId(data.domain.id);
    } catch (ex) {
      setMsg(redact(ex.message));
    } finally {
      setBusy(false);
    }
  }

  async function patchDomain(d, body, okNote) {
    setBusy(true);
    setMsg("");
    try {
      await api(`/api/domains/${d.id}`, { method: "PATCH", token, body });
      if (okNote) setMsg(okNote);
      await load();
      onChanged?.();
    } catch (ex) {
      setMsg(redact(ex.message));
    } finally {
      setBusy(false);
    }
  }

  async function markVerified(d) {
    const ok = await confirm({
      title: "Mark domain verified",
      message: `Mark ${d.domain} as verified? This records SPF, DKIM, and DMARC as complete for this domain.`,
      confirmLabel: "Mark verified",
    });
    if (!ok) return;
    await patchDomain(d, { verify: true }, `${d.domain} marked verified`);
  }

  async function setStatus(d, status) {
    const body = { status };
    if (status === "pending") body.clearAuth = false;
    await patchDomain(
      d,
      body,
      `${d.domain} → ${domainStatusLabel(status)}`
    );
  }

  async function toggleAuth(d, key) {
    const next = !d[key];
    const body = { [key]: next };
    // If turning any auth off while verified, drop to pending
    if (!next && d.status === "verified") body.status = "pending";
    // If all three become true, keep status unless still pending
    await patchDomain(
      d,
      body,
      `${d.domain}: ${key.toUpperCase()} ${next ? "on" : "off"}`
    );
  }

  async function reassignWorkspace(d, workspaceId) {
    if (!workspaceId || workspaceId === d.workspace_id) return;
    await patchDomain(d, { workspaceId }, `${d.domain} moved to selected workspace`);
  }

  async function remove(d) {
    const ok = await confirm({
      title: "Delete domain",
      message: `Delete ${d.domain}? Sending that used this domain may fail. This cannot be undone from the studio.`,
      danger: true,
      confirmLabel: "Delete domain",
    });
    if (!ok) return;
    setBusy(true);
    setMsg("");
    try {
      await api(`/api/domains/${d.id}`, { method: "DELETE", token });
      setMsg(`Deleted ${d.domain}`);
      if (detailId === d.id) setDetailId(null);
      await load();
      onChanged?.();
    } catch (ex) {
      setMsg(redact(ex.message));
    } finally {
      setBusy(false);
    }
  }

  function menuFor(d) {
    return [
      {
        id: "open",
        label: "Open DNS setup",
        icon: <Globe size={15} />,
        onClick: () => setDetailId(d.id),
      },
      d.status !== "verified"
        ? {
            id: "verify",
            label: "Mark verified",
            icon: <ShieldCheck size={15} />,
            onClick: () => markVerified(d),
          }
        : {
            id: "pending",
            label: "Set pending",
            icon: <Pause size={15} />,
            onClick: () => setStatus(d, "pending"),
          },
      d.status !== "failed"
        ? {
            id: "failed",
            label: "Mark action needed",
            icon: <Ban size={15} />,
            onClick: () => setStatus(d, "failed"),
          }
        : null,
      {
        id: "delete",
        label: "Delete domain",
        icon: <X size={15} />,
        danger: true,
        onClick: () => remove(d),
      },
    ].filter(Boolean);
  }

  const health =
    rows.length === 0
      ? "—"
      : stats.verified === rows.length
        ? "Good"
        : stats.failed > 0
          ? "Action needed"
          : "In progress";

  return (
    <>
      <PageHead
        title="Domains"
        copy="Sending domains for user workspaces. Add a domain, publish SPF / DKIM / DMARC DNS, then mark auth complete."
        actions={
          <>
            <button className="btn" type="button" onClick={load} disabled={loading || busy}>
              <RefreshCw size={15} /> Refresh
            </button>
            <button className="btn primary" type="button" onClick={() => setCreateOpen(true)}>
              <Plus size={15} /> Add domain
            </button>
          </>
        }
      />
      {msg ? (
        <Banner tone={/fail|error|invalid|cannot|already|not found/i.test(msg) ? "bad" : "ok"}>
          {msg}
        </Banner>
      ) : null}
      {err ? <Banner tone="bad">{err}</Banner> : null}

      <StatGrid
        items={[
          {
            label: "Sending domains",
            value: fmtNum(total ?? rows.length),
            hint: `${fmtNum(filtered.length)} shown`,
            tone: "blue",
            icon: <Globe size={16} />,
          },
          {
            label: "Verified",
            value: fmtNum(stats.verified),
            hint: `${fmtNum(stats.authComplete)} full SPF+DKIM+DMARC`,
            tone: "green",
          },
          {
            label: "Pending",
            value: fmtNum(stats.pending),
            hint: `${fmtNum(stats.failed)} action needed`,
            tone: "amber",
          },
          {
            label: "Health",
            value: health,
            hint: rows.length ? `${stats.verified}/${rows.length} verified` : "No domains yet",
            tone: health === "Good" ? "green" : health === "Action needed" ? "red" : "purple",
          },
        ]}
      />

      <Panel
        title="Domain inventory"
        copy={
          loading
            ? "Loading…"
            : `${fmtNum(filtered.length)} of ${fmtNum(total ?? rows.length)} domains · up to 20 per page`
        }
      >
        <div className="ws-table-toolbar">
          <div className="tables-search-wrap wide">
            <Search size={14} className="tables-search-ico" />
            <input
              className="tables-search"
              placeholder="Search domain, workspace, owner…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="ws-chip-row">
            {[
              { id: "all", label: "all" },
              { id: "pending", label: "pending" },
              { id: "verified", label: "verified" },
              { id: "failed", label: "action needed" },
            ].map((s) => (
              <button
                key={s.id}
                type="button"
                className={`ws-chip ${statusFilter === s.id ? "active" : ""}`}
                onClick={() => setStatusFilter(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {!loading && filtered.length === 0 ? (
          <div className="empty">
            <b>{rows.length ? "No domains match" : "No sending domains yet"}</b>
            {rows.length
              ? "Try another search or status filter."
              : "Add a domain for a user workspace, then open DNS setup to publish records."}
            {!rows.length ? (
              <div style={{ marginTop: 12 }}>
                <button type="button" className="btn primary" onClick={() => setCreateOpen(true)}>
                  <Plus size={15} /> Add domain
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="paged-table-stack">
            <BulkBar
              count={bulk.count}
              noun={bulk.count === 1 ? "domain selected" : "domains selected"}
              pageCount={pager.pageRows.length}
              filteredCount={filtered.length}
              onClear={bulk.clear}
              onSelectPage={bulk.togglePage}
              onSelectAll={() => bulk.selectAll(filtered)}
              allPageSelected={bulk.allPageSelected}
              emptyHint="Select domains with the checkboxes, then verify, set status, or delete in bulk."
            >
              <button type="button" className="btn sm" disabled={busy || !bulk.count} onClick={() => bulkDomainStatus("verified")}>
                Verify
              </button>
              <button type="button" className="btn sm" disabled={busy || !bulk.count} onClick={() => bulkDomainStatus("pending")}>
                Pending
              </button>
              <button type="button" className="btn sm" disabled={busy || !bulk.count} onClick={() => bulkDomainStatus("failed")}>
                Action needed
              </button>
              <button type="button" className="btn sm danger" disabled={busy || !bulk.count} onClick={bulkDeleteDomains}>
                Delete
              </button>
            </BulkBar>
            <TableShell rowCount={pager.pageRows.length}>
              <table className="data ws-table">
                <thead>
                  <tr>
                    <BulkSelectHeader
                      checked={bulk.allPageSelected}
                      indeterminate={bulk.somePageSelected && !bulk.allPageSelected}
                      onChange={bulk.togglePage}
                    />
                    <th>Domain</th>
                    <th>Workspace</th>
                    <th>Status</th>
                    <th>Auth</th>
                    <th>Added</th>
                    <th className="col-actions" />
                  </tr>
                </thead>
                <tbody>
                  {pager.pageRows.map((d) => (
                    <tr
                      key={d.id}
                      className={`clickable ws-table-row ${detailId === d.id ? "active" : ""} ${bulk.isSelected(d.id) ? "bulk-selected" : ""}`}
                      onClick={() => setDetailId(d.id)}
                    >
                      <BulkSelectCell
                        checked={bulk.isSelected(d.id)}
                        onChange={() => bulk.toggle(d.id)}
                        label={`Select ${d.domain}`}
                      />
                      <td>
                        <div className="dom-name-cell">
                          <span
                            className="ws-table-avatar sm"
                            data-status={String(d.status || "").toLowerCase()}
                          >
                            <Globe size={14} />
                          </span>
                          <div>
                            <b className="mono">{d.domain}</b>
                            {d.owner_email ? <small>{d.owner_email}</small> : null}
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="dom-ws-name">{d.workspace_name || "—"}</span>
                      </td>
                      <td>
                        <span className={`tag ${domainStatusTone(d.status)}`}>
                          {domainStatusLabel(d.status)}
                        </span>
                      </td>
                      <td>
                        <div className="dom-auth-row">
                          <AuthBadge on={!!d.spf} label="SPF" />
                          <AuthBadge on={!!d.dkim} label="DKIM" />
                          <AuthBadge on={!!d.dmarc} label="DMARC" />
                        </div>
                      </td>
                      <td className="muted-sm">{fmtTime(d.created_at)}</td>
                      <td className="col-actions" onClick={(e) => e.stopPropagation()}>
                        <RowMenu items={menuFor(d)} label={`Actions for ${d.domain}`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
            <TablePager
              page={pager.page}
              pageCount={pager.pageCount}
              total={pager.total}
              from={pager.from}
              to={pager.to}
              pageNumbers={pager.pageNumbers}
              middlePage={pager.middlePage}
              onPageChange={pager.setPage}
              onFirst={pager.goFirst}
              onMiddle={pager.goMiddle}
              onLast={pager.goLast}
              onPrev={pager.goPrev}
              onNext={pager.goNext}
            />
          </div>
        )}
      </Panel>

      {detail ? (
        <Modal
          title={`DNS setup · ${detail.domain}`}
          wide
          onClose={() => !busy && setDetailId(null)}
        >
          <div className="dom-dns-modal">
            <div className="dom-detail-grid">
              <div className="kv compact">
                <div>
                  <span>Status</span>
                  <b>
                    <span className={`tag ${domainStatusTone(detail.status)}`}>
                      {domainStatusLabel(detail.status)}
                    </span>
                  </b>
                </div>
                <div>
                  <span>Workspace</span>
                  <b>{detail.workspace_name || "—"}</b>
                </div>
                <div>
                  <span>Workspace owner</span>
                  <b>{detail.owner_email || "—"}</b>
                </div>
                <div>
                  <span>Added</span>
                  <b>{fmtTime(detail.created_at)}</b>
                </div>
                <div>
                  <span>Domain ID</span>
                  <b className="mono">{detail.id}</b>
                </div>
              </div>

              <div className="dom-auth-controls">
                <b>Authentication checks</b>
                <p className="role-grant-hint">
                  Mark each check when the DNS record is published at your provider. Use{" "}
                  <b>Mark verified</b> when the domain is ready to send.
                </p>
                <div className="dom-auth-toggles">
                  {[
                    { key: "spf", label: "SPF" },
                    { key: "dkim", label: "DKIM" },
                    { key: "dmarc", label: "DMARC" },
                  ].map((a) => (
                    <button
                      key={a.key}
                      type="button"
                      className={`dom-auth-toggle ${detail[a.key] ? "on" : "off"}`}
                      disabled={busy}
                      onClick={() => toggleAuth(detail, a.key)}
                      title={detail[a.key] ? `Turn ${a.label} off` : `Mark ${a.label} complete`}
                    >
                      {detail[a.key] ? <Check size={15} /> : <X size={15} />}
                      {a.label}
                    </button>
                  ))}
                </div>
                <div className="dom-detail-actions">
                  {detail.status !== "verified" ? (
                    <button
                      type="button"
                      className="btn primary sm"
                      disabled={busy}
                      onClick={() => markVerified(detail)}
                    >
                      <ShieldCheck size={14} /> Mark verified
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn sm"
                      disabled={busy}
                      onClick={() => setStatus(detail, "pending")}
                    >
                      Set pending
                    </button>
                  )}
                  {detail.status !== "failed" ? (
                    <button
                      type="button"
                      className="btn sm"
                      disabled={busy}
                      onClick={() => setStatus(detail, "failed")}
                    >
                      Action needed
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn danger sm"
                    disabled={busy}
                    onClick={() => remove(detail)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>

            {(workspaces.rows || []).length > 0 ? (
              <div className="dom-reassign" style={{ marginTop: 14 }}>
                <Field label="User workspace" full>
                  <AppSelect
                    value={detail.workspace_id || ""}
                    onChange={(workspaceId) => reassignWorkspace(detail, workspaceId)}
                    options={(workspaces.rows || []).map((w) => ({
                      value: w.id,
                      label: w.name || w.id,
                    }))}
                    aria-label="Workspace for domain"
                  />
                </Field>
              </div>
            ) : null}

            <div className="dom-dns-block">
              <div className="dom-dns-head">
                <b>DNS records</b>
                <span>Add these at your DNS provider for {detail.domain}</span>
              </div>
              <div className="dom-dns-table">
                <div className="dom-dns-row head">
                  <span>Type</span>
                  <span>Host</span>
                  <span>Value</span>
                  <span />
                </div>
                {domainDnsRecords(detail.domain).map((rec, i) => {
                  const key = `${detail.id}-${i}`;
                  const ok =
                    rec.check === "spf"
                      ? !!detail.spf
                      : rec.check === "dkim"
                        ? !!detail.dkim
                        : !!detail.dmarc;
                  return (
                    <div key={key} className={`dom-dns-row ${ok ? "ok" : ""}`}>
                      <span>
                        <em className="dom-dns-type">{rec.type}</em>
                        <small>{rec.label}</small>
                      </span>
                      <span className="mono">{rec.host}</span>
                      <span className="mono dom-dns-value">{rec.value}</span>
                      <span>
                        <CopyButton text={rec.value} label="Copy" title="Copy value" />
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="grant-actions" style={{ marginTop: 14 }}>
              <button type="button" className="btn" disabled={busy} onClick={() => setDetailId(null)}>
                Close
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {createOpen ? (
        <Modal title="Add sending domain" onClose={() => !busy && setCreateOpen(false)}>
          <form className="form" onSubmit={createDomain}>
            <Field label="Sending domain" full>
              <input
                required
                autoFocus
                value={form.domain}
                onChange={(e) => setForm((p) => ({ ...p, domain: e.target.value }))}
                placeholder="mail.example.com"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            <Field label="User workspace" full>
              <AppSelect
                value={form.workspaceId}
                onChange={(workspaceId) => setForm((p) => ({ ...p, workspaceId }))}
                options={workspaceOptions}
                aria-label="Workspace"
              />
            </Field>
            <p className="role-grant-hint">
              Domain is created as <b>pending</b>. After add, the DNS setup window opens so you can
              copy SPF, DKIM, and DMARC records.
            </p>
            <div className="full" style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn" type="button" disabled={busy} onClick={() => setCreateOpen(false)}>
                Cancel
              </button>
              <button className="btn primary" type="submit" disabled={busy || !form.domain.trim()}>
                {busy ? "Adding…" : "Add domain"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

const KEY_SCOPE_OPTIONS = [
  { id: "email:send", label: "Send email", hint: "Queue and send messages" },
  { id: "email:read", label: "Read messages", hint: "Inspect message status" },
  { id: "domains:read", label: "Read domains", hint: "List sending domains" },
  { id: "domains:write", label: "Manage domains", hint: "Add / verify domains" },
  { id: "suppressions:read", label: "Read suppressions", hint: "List blocklist" },
  { id: "suppressions:write", label: "Manage suppressions", hint: "Add / remove suppressions" },
  { id: "analytics:read", label: "Read analytics", hint: "Usage and delivery metrics" },
];

function keyEnvironment(k) {
  const p = String(k?.key_prefix || k?.environment || "");
  if (p.startsWith("sk_test_") || k?.environment === "test") return "test";
  return "live";
}

function keyScopesList(k) {
  if (Array.isArray(k?.scopes)) return k.scopes;
  return [];
}

export function KeysPage({ token, session, events = [], onChanged }) {
  const confirm = useAppConfirm();
  const { rows, total, err, loading, load } = useEntity(token, "/api/keys");
  const workspaces = useEntity(token, "/api/workspaces");

  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [envFilter, setEnvFilter] = useState("all");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    workspaceId: "",
    environment: "live",
    scopes: ["email:send"],
  });

  const [secretReveal, setSecretReveal] = useState(null); // { secret, name, prefix, note }
  const [secretAck, setSecretAck] = useState(false);
  const { copy: copyText, isCopied, copyIcon } = useCopyFeedback(1800);

  const [detailId, setDetailId] = useState(null);
  const [detailTab, setDetailTab] = useState("overview"); // overview | settings | integrate
  const [editName, setEditName] = useState("");
  const [editScopes, setEditScopes] = useState([]);
  const [editWorkspaceId, setEditWorkspaceId] = useState("");
  const [securityOpen, setSecurityOpen] = useState(false);
  const [wsFilter, setWsFilter] = useState("all");

  // Realtime: refresh when api_key events arrive
  const lastRt = useRef("");
  useEffect(() => {
    if (!events?.length) return;
    const ev = events[0];
    if (ev?.type !== "api_key") return;
    const sig = `${ev.event}:${ev.id || ""}:${ev.at || ""}:${ev.prefix || ""}`;
    if (sig === lastRt.current) return;
    lastRt.current = sig;
    load();
    onChanged?.();
  }, [events, load, onChanged]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((k) => {
      const env = keyEnvironment(k);
      const scopes = keyScopesList(k).join(" ");
      const hay = `${k.name || ""} ${k.key_prefix || ""} ${k.workspace_name || ""} ${k.owner_email || ""} ${scopes} ${k.status || ""} ${env}`.toLowerCase();
      if (needle && !hay.includes(needle)) return false;
      if (statusFilter !== "all" && String(k.status || "").toLowerCase() !== statusFilter) return false;
      if (envFilter !== "all" && env !== envFilter) return false;
      if (wsFilter !== "all" && String(k.workspace_id || "") !== wsFilter) return false;
      return true;
    });
  }, [rows, q, statusFilter, envFilter, wsFilter]);

  const keysFilterKey = `${q}|${statusFilter}|${envFilter}|${wsFilter}`;
  const pager = useClientPager(filtered, { resetKey: keysFilterKey });
  const bulk = useBulkSelection(pager.pageRows, { resetKey: keysFilterKey });

  const detail = useMemo(
    () => rows.find((k) => k.id === detailId) || null,
    [rows, detailId]
  );

  const detailDirty = useMemo(() => {
    if (!detail || detail.status !== "active") return false;
    const nameChanged = editName.trim() !== String(detail.name || "").trim();
    const wsChanged = (editWorkspaceId || "") !== (detail.workspace_id || "");
    const a = [...editScopes].sort().join("|");
    const b = [...keyScopesList(detail)].sort().join("|");
    return nameChanged || wsChanged || a !== b;
  }, [detail, editName, editScopes, editWorkspaceId]);

  useEffect(() => {
    if (!detail) return;
    setEditName(detail.name || "");
    setEditScopes(keyScopesList(detail));
    setEditWorkspaceId(detail.workspace_id || "");
    setDetailTab("overview");
  }, [detail?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function bulkRevokeKeys() {
    if (!bulk.count) return;
    const ids = [...bulk.selectedIds];
    const ok = await confirm({
      title: "Bulk revoke API keys",
      message: `Revoke ${ids.length} selected key${ids.length === 1 ? "" : "s"} immediately? Apps using those secrets will stop authenticating.`,
      danger: true,
      confirmLabel: "Revoke selected",
    });
    if (!ok) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await runBulk(ids, (id) =>
        api(`/api/keys/${id}`, { method: "PATCH", token, body: { revoke: true } })
      );
      setMsg(res.fail ? `Revoked ${res.ok}, failed ${res.fail}` : `Revoked ${res.ok} key${res.ok === 1 ? "" : "s"}`);
      if (detailId && ids.some((id) => String(id) === String(detailId))) setDetailId(null);
      bulk.clear();
      await load();
      onChanged?.();
    } catch (ex) {
      setMsg(redact(ex.message));
    } finally {
      setBusy(false);
    }
  }

  async function bulkRemoveRevokedKeys() {
    const ids = bulk.selectedIds.filter((id) => {
      const k = rows.find((r) => String(r.id) === String(id));
      return k && k.status === "revoked";
    });
    if (!ids.length) {
      setMsg("Select revoked keys to remove from the list");
      return;
    }
    const ok = await confirm({
      title: "Remove revoked keys",
      message: `Permanently remove ${ids.length} revoked key record${ids.length === 1 ? "" : "s"} from the inventory?`,
      danger: true,
      confirmLabel: "Remove",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await runBulk(ids, (id) => api(`/api/keys/${id}`, { method: "DELETE", token }));
      setMsg(res.fail ? `Removed ${res.ok}, failed ${res.fail}` : `Removed ${res.ok} revoked key${res.ok === 1 ? "" : "s"}`);
      if (detailId && ids.some((id) => String(id) === String(detailId))) setDetailId(null);
      bulk.clear();
      await load();
      onChanged?.();
    } catch (ex) {
      setMsg(redact(ex.message));
    } finally {
      setBusy(false);
    }
  }

  function exportSelectedKeysCsv() {
    const set = new Set(bulk.selectedIds.map(String));
    const list = filtered.filter((k) => set.has(String(k.id)));
    if (!list.length) return;
    const cols = ["id", "name", "key_prefix", "environment", "status", "scopes", "workspace_name", "created_at"];
    const lines = [cols.join(",")];
    for (const k of list) {
      lines.push(
        [
          k.id,
          k.name,
          k.key_prefix,
          keyEnvironment(k),
          k.status,
          keyScopesList(k).join(";"),
          k.workspace_name || "",
          k.created_at || "",
        ]
          .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
          .join(",")
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `senditto-api-keys-selected-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    setMsg(`Exported ${list.length} selected key${list.length === 1 ? "" : "s"} (metadata only)`);
  }

  const workspaceOptions = useMemo(() => {
    const list = (workspaces.rows || []).map((w) => ({
      value: w.id,
      label: w.name || w.id,
    }));
    return [{ value: "", label: "Default workspace" }, ...list];
  }, [workspaces.rows]);

  const stats = useMemo(() => {
    const active = rows.filter((k) => k.status === "active").length;
    const revoked = rows.filter((k) => k.status === "revoked").length;
    const neverUsed = rows.filter((k) => k.status === "active" && !k.last_used_at).length;
    const live = rows.filter((k) => keyEnvironment(k) === "live" && k.status === "active").length;
    return { active, revoked, neverUsed, live };
  }, [rows]);

  async function copyKeyText(text, key) {
    try {
      const ok = await copyText(text, key);
      if (!ok) setMsg("Could not copy — select the value manually");
      return ok;
    } catch {
      setMsg("Could not copy — select the value manually");
      return false;
    }
  }

  function toggleScopeValue(current, id) {
    const has = current.includes(id);
    if (has) {
      const next = current.filter((s) => s !== id);
      return next.length ? next : current; // keep at least one scope
    }
    return [...current, id];
  }

  async function createKey(e) {
    e.preventDefault();
    if (!form.name.trim()) {
      setMsg("Key name is required");
      return;
    }
    if (form.environment === "live") {
      const ok = await confirm({
        title: "Create live API key",
        message:
          "This creates a production (sk_live_) key that can send mail for the selected workspace. Store the secret securely — it is shown only once.",
        confirmLabel: "Create live key",
        danger: true,
      });
      if (!ok) return;
    }
    setBusy(true);
    setMsg("");
    try {
      const body = {
        name: form.name.trim(),
        environment: form.environment,
        scopes: form.scopes,
      };
      if (form.workspaceId) body.workspaceId = form.workspaceId;
      const data = await api("/api/keys", { method: "POST", token, body });
      setCreateOpen(false);
      setForm({ name: "", workspaceId: form.workspaceId || "", environment: "live", scopes: ["email:send"] });
      setSecretAck(false);
      setSecretReveal({
        secret: data.secret,
        name: data.key?.name || body.name,
        prefix: data.key?.key_prefix || "",
        note: data.note,
      });
      if (data.secret) await copyKeyText(data.secret, "secret");
      await load();
      onChanged?.();
    } catch (ex) {
      setMsg(redact(ex.message));
    } finally {
      setBusy(false);
    }
  }

  async function revokeKey(k) {
    const ok = await confirm({
      title: "Revoke API key",
      message: `Revoke “${k.name}” (${k.key_prefix}…)? Any app using this secret will stop authenticating immediately. This cannot be undone.`,
      danger: true,
      confirmLabel: "Revoke key",
    });
    if (!ok) return;
    setBusy(true);
    setMsg("");
    try {
      await api(`/api/keys/${k.id}`, { method: "PATCH", token, body: { revoke: true } });
      setMsg(`Revoked ${k.name}`);
      if (detailId === k.id) setDetailId(null);
      await load();
      onChanged?.();
    } catch (ex) {
      setMsg(redact(ex.message));
    } finally {
      setBusy(false);
    }
  }

  async function deleteRevoked(k) {
    if (k.status !== "revoked") return;
    const ok = await confirm({
      title: "Remove revoked key",
      message: `Permanently remove the revoked key “${k.name}” from the inventory? The secret was never stored in full.`,
      danger: true,
      confirmLabel: "Remove",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api(`/api/keys/${k.id}`, { method: "DELETE", token });
      setMsg(`Removed ${k.name}`);
      if (detailId === k.id) setDetailId(null);
      await load();
      onChanged?.();
    } catch (ex) {
      setMsg(redact(ex.message));
    } finally {
      setBusy(false);
    }
  }

  async function rotateKey(k) {
    const ok = await confirm({
      title: "Rotate API key",
      message: `Rotate “${k.name}”? The current secret is revoked immediately and a new secret is shown once. Update your apps right away.`,
      danger: true,
      confirmLabel: "Rotate key",
    });
    if (!ok) return;
    setBusy(true);
    setMsg("");
    try {
      const data = await api(`/api/keys/${k.id}/rotate`, { method: "POST", token, body: {} });
      setDetailId(null);
      setSecretAck(false);
      setSecretReveal({
        secret: data.secret,
        name: data.key?.name || k.name,
        prefix: data.key?.key_prefix || "",
        note: data.note || "Previous key revoked. Copy the new secret now.",
      });
      if (data.secret) await copyKeyText(data.secret, "secret");
      await load();
      onChanged?.();
    } catch (ex) {
      setMsg(redact(ex.message));
    } finally {
      setBusy(false);
    }
  }

  async function saveDetail(e) {
    e?.preventDefault?.();
    if (!detail || detail.status !== "active") return;
    setBusy(true);
    setMsg("");
    try {
      const body = {
        name: editName.trim(),
        scopes: editScopes,
      };
      if (editWorkspaceId) body.workspaceId = editWorkspaceId;
      await api(`/api/keys/${detail.id}`, { method: "PATCH", token, body });
      setMsg(`Saved ${editName.trim() || detail.name}`);
      await load();
      onChanged?.();
    } catch (ex) {
      setMsg(redact(ex.message));
    } finally {
      setBusy(false);
    }
  }

  function menuFor(k) {
    const active = k.status === "active";
    return [
      {
        id: "open",
        label: "Open details",
        icon: <KeyRound size={15} />,
        onClick: () => setDetailId(k.id),
      },
      {
        id: "copy-prefix",
        label: isCopied(`prefix-${k.id}`) ? "Copied" : "Copy prefix",
        icon: copyIcon(`prefix-${k.id}`),
        onClick: () => copyKeyText(k.key_prefix || "", `prefix-${k.id}`),
      },
      {
        id: "copy-id",
        label: isCopied(`id-${k.id}`) ? "Copied" : "Copy key ID",
        icon: copyIcon(`id-${k.id}`),
        onClick: () => copyKeyText(k.id || "", `id-${k.id}`),
      },
      active
        ? {
            id: "rotate",
            label: "Rotate key…",
            icon: <RefreshCw size={15} />,
            onClick: () => rotateKey(k),
          }
        : null,
      active
        ? {
            id: "revoke",
            label: "Revoke key…",
            icon: <Ban size={15} />,
            danger: true,
            onClick: () => revokeKey(k),
          }
        : {
            id: "remove",
            label: "Remove from list…",
            icon: <X size={15} />,
            danger: true,
            onClick: () => deleteRevoked(k),
          },
    ].filter(Boolean);
  }

  function exportKeysCsv() {
    const cols = [
      "id",
      "name",
      "key_prefix",
      "environment",
      "status",
      "scopes",
      "workspace_id",
      "workspace_name",
      "last_used_at",
      "created_at",
    ];
    const lines = [cols.join(",")];
    for (const k of filtered) {
      const env = keyEnvironment(k);
      const row = [
        k.id,
        k.name,
        k.key_prefix,
        env,
        k.status,
        keyScopesList(k).join(";"),
        k.workspace_id || "",
        k.workspace_name || "",
        k.last_used_at || "",
        k.created_at || "",
      ].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`);
      lines.push(row.join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `senditto-api-keys-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    setMsg(`Exported ${filtered.length} key record${filtered.length === 1 ? "" : "s"} (metadata only — no secrets)`);
  }

  function authSnippet(k) {
    const env = keyEnvironment(k);
    return [
      `# ${k.name} (${env}) — replace with your full secret (shown once at create/rotate)`,
      `curl -X POST "https://api.senditto.example/v1/messages" \\`,
      `  -H "Authorization: Bearer ${k.key_prefix}…" \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -d '{"to":"user@example.com","from":"hello@yourdomain.com","subject":"Hello"}'`,
    ].join("\n");
  }

  async function closeDetail() {
    if (detailDirty) {
      const ok = await confirm({
        title: "Discard unsaved changes?",
        message: "You have unsaved edits on this API key.",
        danger: true,
        confirmLabel: "Discard",
      });
      if (!ok) return;
    }
    setDetailId(null);
  }

  return (
    <>
      <PageHead
        title="API keys"
        copy="Create and manage sending credentials for user workspaces. Secrets appear once. Inventory stays live as keys change."
        actions={
          <>
            <button
              className="btn"
              type="button"
              onClick={() => setSecurityOpen(true)}
              title="Open the security handbook"
            >
              <BookOpen size={15} /> Security
            </button>
            <button className="btn" type="button" onClick={exportKeysCsv} disabled={!filtered.length}>
              <Download size={15} /> Export CSV
            </button>
            <button className="btn" type="button" onClick={load} disabled={loading || busy}>
              <RefreshCw size={15} /> Refresh
            </button>
            <button className="btn primary" type="button" onClick={() => setCreateOpen(true)}>
              <KeyRound size={15} /> Create API key
            </button>
          </>
        }
      />

      {/* Compact book entry — opens the Security handbook as a popup */}
      <button
        type="button"
        className="keys-security-book-entry"
        onClick={() => setSecurityOpen(true)}
        title="Open security handbook"
      >
        <span className="keys-security-book-icon" aria-hidden>
          <BookOpen size={20} />
        </span>
        <span className="keys-security-book-titles">
          <b>Security handbook</b>
          <span>How API keys work on Senditto — open the full guide</span>
        </span>
        <span className="keys-security-book-open-hint">Open</span>
      </button>

      {msg ? (
        <Banner tone={/fail|error|cannot|invalid|not found|required|discard/i.test(msg) ? "bad" : "ok"}>
          {msg}
        </Banner>
      ) : null}
      {err ? <Banner tone="bad">{err}</Banner> : null}

      <StatGrid
        items={[
          {
            label: "Total keys",
            value: fmtNum(total ?? rows.length),
            hint: `${fmtNum(filtered.length)} shown`,
            tone: "blue",
            icon: <KeyRound size={16} />,
          },
          {
            label: "Active",
            value: fmtNum(stats.active),
            hint: `${fmtNum(stats.live)} live production`,
            tone: "green",
          },
          {
            label: "Revoked",
            value: fmtNum(stats.revoked),
            hint: "Cannot be re-enabled",
            tone: "red",
          },
          {
            label: "Never used",
            value: fmtNum(stats.neverUsed),
            hint: "Active with no last-used yet",
            tone: "amber",
          },
        ]}
      />

      <Panel
        title="Key inventory"
        copy={
          loading
            ? "Loading…"
            : `${fmtNum(filtered.length)} of ${fmtNum(total ?? rows.length)} keys · updates in realtime`
        }
      >
        <div className="ws-table-toolbar">
          <div className="tables-search-wrap wide">
            <Search size={14} className="tables-search-ico" />
            <input
              className="tables-search"
              placeholder="Search name, prefix, workspace, scope…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="ws-chip-row">
            {[
              { id: "all", label: "all" },
              { id: "active", label: "active" },
              { id: "revoked", label: "revoked" },
            ].map((s) => (
              <button
                key={s.id}
                type="button"
                className={`ws-chip ${statusFilter === s.id ? "active" : ""}`}
                onClick={() => setStatusFilter(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="ws-chip-row">
            {[
              { id: "all", label: "all env" },
              { id: "live", label: "live" },
              { id: "test", label: "test" },
            ].map((s) => (
              <button
                key={s.id}
                type="button"
                className={`ws-chip ${envFilter === s.id ? "active" : ""}`}
                onClick={() => setEnvFilter(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
          {(workspaces.rows || []).length > 0 ? (
            <AppSelect
              size="sm"
              className="ws-filter-select"
              value={wsFilter}
              onChange={setWsFilter}
              options={[
                { value: "all", label: "All workspaces" },
                ...(workspaces.rows || []).map((w) => ({
                  value: w.id,
                  label: w.name || w.id,
                })),
              ]}
              aria-label="Filter by workspace"
            />
          ) : null}
        </div>

        {!loading && filtered.length === 0 ? (
          <div className="empty">
            <b>{rows.length ? "No keys match" : "No API keys yet"}</b>
            {rows.length
              ? "Try another search or filter."
              : "Create a key for a user workspace. Copy the secret once — it cannot be shown again."}
            {!rows.length ? (
              <div style={{ marginTop: 12 }}>
                <button type="button" className="btn primary" onClick={() => setCreateOpen(true)}>
                  <KeyRound size={15} /> Create API key
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="paged-table-stack">
            <BulkBar
              count={bulk.count}
              noun={bulk.count === 1 ? "key selected" : "keys selected"}
              pageCount={pager.pageRows.length}
              filteredCount={filtered.length}
              onClear={bulk.clear}
              onSelectPage={bulk.togglePage}
              onSelectAll={() => bulk.selectAll(filtered)}
              allPageSelected={bulk.allPageSelected}
              emptyHint="Select API keys with the checkboxes, then export, revoke, or remove revoked in bulk."
            >
              <button type="button" className="btn sm" disabled={busy || !bulk.count} onClick={exportSelectedKeysCsv}>
                <Download size={14} /> Export
              </button>
              <button type="button" className="btn sm danger" disabled={busy || !bulk.count} onClick={bulkRevokeKeys}>
                Revoke
              </button>
              <button type="button" className="btn sm danger" disabled={busy || !bulk.count} onClick={bulkRemoveRevokedKeys}>
                Remove revoked
              </button>
            </BulkBar>
            <TableShell rowCount={pager.pageRows.length}>
              <table className="data ws-table keys-table">
                <thead>
                  <tr>
                    <BulkSelectHeader
                      checked={bulk.allPageSelected}
                      indeterminate={bulk.somePageSelected && !bulk.allPageSelected}
                      onChange={bulk.togglePage}
                    />
                    <th>Name</th>
                    <th>Prefix</th>
                    <th>Env</th>
                    <th>Workspace</th>
                    <th>Scopes</th>
                    <th>Status</th>
                    <th>Last used</th>
                    <th>Created</th>
                    <th className="col-actions" />
                  </tr>
                </thead>
                <tbody>
                  {pager.pageRows.map((k) => {
                    const env = keyEnvironment(k);
                    const scopes = keyScopesList(k);
                    return (
                      <tr
                        key={k.id}
                        className={`clickable ws-table-row ${detailId === k.id ? "active" : ""} ${bulk.isSelected(k.id) ? "bulk-selected" : ""}`}
                        onClick={() => setDetailId(k.id)}
                      >
                        <BulkSelectCell
                          checked={bulk.isSelected(k.id)}
                          onChange={() => bulk.toggle(k.id)}
                          label={`Select ${k.name}`}
                        />
                        <td>
                          <div className="keys-name-cell">
                            <span className={`keys-env-dot ${env}`} title={env} />
                            <div>
                              <b>{k.name}</b>
                              {k.owner_email ? <small>{k.owner_email}</small> : null}
                            </div>
                          </div>
                        </td>
                        <td>
                          <code className="mono keys-prefix">{k.key_prefix}…</code>
                        </td>
                        <td>
                          <span className={`tag ${env === "live" ? "warn" : "ok"}`}>{env}</span>
                        </td>
                        <td>
                          <span className="dom-ws-name">{k.workspace_name || "—"}</span>
                        </td>
                        <td>
                          <div className="keys-scopes-cell" title={scopes.join(", ")}>
                            {scopes.length ? scopes.slice(0, 2).map((s) => (
                              <span key={s} className="keys-scope-pill">{s}</span>
                            )) : "—"}
                            {scopes.length > 2 ? <span className="muted-sm">+{scopes.length - 2}</span> : null}
                          </div>
                        </td>
                        <td>
                          <span className={`tag ${k.status === "active" ? "ok" : "bad"}`}>
                            {k.status}
                          </span>
                        </td>
                        <td className="muted-sm">{fmtTime(k.last_used_at)}</td>
                        <td className="muted-sm">{fmtTime(k.created_at)}</td>
                        <td className="col-actions" onClick={(e) => e.stopPropagation()}>
                          <RowMenu items={menuFor(k)} label={`Actions for ${k.name}`} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableShell>
            <TablePager
              page={pager.page}
              pageCount={pager.pageCount}
              total={pager.total}
              from={pager.from}
              to={pager.to}
              pageNumbers={pager.pageNumbers}
              middlePage={pager.middlePage}
              onPageChange={pager.setPage}
              onFirst={pager.goFirst}
              onMiddle={pager.goMiddle}
              onLast={pager.goLast}
              onPrev={pager.goPrev}
              onNext={pager.goNext}
            />
          </div>
        )}
      </Panel>

      {/* Security handbook — popup modal */}
      {securityOpen ? (
        <Modal title="Security handbook" wide onClose={() => setSecurityOpen(false)}>
          <div className="keys-security-popup">
            <p className="keys-security-lead">
              API keys are how your applications authenticate to Senditto. A live key can send mail
              for a user workspace, so treat every full secret like a password for that workspace’s
              mail stream. This handbook explains how keys work, what the studio shows, and what you
              must do to stay safe.
            </p>

            <section className="keys-security-section">
              <h4>What an API key is</h4>
              <p>
                Each key belongs to one user workspace and carries a name, an environment (live or
                test), and a set of scopes. Scopes define what the key is allowed to do, such as
                send email, read message status, or manage domains. Live keys start with sk_live_ and
                are for production sending. Test keys start with sk_test_ and are for non-production
                use. Prefer test keys while you build and only create live keys when your app is
                ready.
              </p>
            </section>

            <section className="keys-security-section">
              <h4>The secret is shown only once</h4>
              <p>
                When you create a key, or when you rotate an existing key, the studio shows the full
                secret a single time in a secure window. You must copy it and store it in a secrets
                manager, vault, or secure server configuration. After you close that window, the full
                secret cannot be retrieved again from Senditto. There is no “show secret” action on
                the inventory or in key details. If you lose a secret, rotate or create a new key and
                update your application.
              </p>
            </section>

            <section className="keys-security-section">
              <h4>What we store on the server</h4>
              <p>
                Senditto does not keep the full secret in plain text. The server stores a one-way
                SHA-256 hash used only to verify the secret when your app authenticates. The inventory
                and detail views show a safe prefix only (for example the first characters of the key
                followed by an ellipsis). Export CSV also exports metadata only—never full secrets.
                That design limits damage if a database backup or admin screen is exposed.
              </p>
            </section>

            <section className="keys-security-section">
              <h4>How your app should send the key</h4>
              <p>
                Authenticate from your backend with an Authorization Bearer header, using the full
                secret you saved at create or rotate time. Do not put live secrets in mobile apps,
                browser JavaScript, public repositories, screenshots, or support tickets. Do not log
                the full secret. If a secret may have leaked, revoke or rotate the key immediately.
              </p>
            </section>

            <section className="keys-security-section">
              <h4>Revoke and rotate</h4>
              <p>
                Revoke stops a key from authenticating at once. A revoked key cannot be turned back
                on; create a new key if you still need access. Rotate creates a new secret for the
                same workspace and scopes, revokes the old key in the same step, and shows the new
                secret once—update your apps immediately after rotating. You can permanently remove a
                revoked key from the inventory later; that only cleans the list and does not recover
                the secret.
              </p>
            </section>

            <section className="keys-security-section">
              <h4>What you can manage in this page</h4>
              <p>
                Create keys for a workspace with the scopes you need. Search and filter by status,
                environment, and workspace. Open a key for overview, settings (name, workspace,
                scopes), and integrate examples. Export a CSV of metadata for audits. The inventory
                refreshes in realtime when keys are created, updated, revoked, or rotated elsewhere
                on the control plane.
              </p>
            </section>

            <section className="keys-security-section">
              <h4>Good practice checklist</h4>
              <p>
                Use the least scopes that still do the job. Use test keys until production is ready.
                Store secrets only on the server. Rotate after staff leave or if a secret may have
                been shared. Revoke unused or unknown keys. Review “never used” active keys and
                remove what you do not need. Keep export files and support notes free of full
                secrets.
              </p>
            </section>

            <div className="grant-actions">
              <button type="button" className="btn primary" onClick={() => setSecurityOpen(false)}>
                Close handbook
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* Create modal */}
      {createOpen ? (
        <Modal title="Create API key" onClose={() => !busy && setCreateOpen(false)} wide>
          <form className="form" onSubmit={createKey}>
            <p className="keys-create-intro">
              Choose a clear name, the user workspace this key belongs to, live or test environment,
              and the scopes your application needs. After create, the full secret appears once—copy
              it before you close that window.
            </p>
            <Field label="Key name" full>
              <input
                required
                autoFocus
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Production send · backend"
                maxLength={80}
              />
            </Field>
            <Field label="User workspace" full>
              <AppSelect
                value={form.workspaceId}
                onChange={(workspaceId) => setForm((p) => ({ ...p, workspaceId }))}
                options={workspaceOptions}
                aria-label="Workspace"
              />
            </Field>
            <Field label="Environment" full>
              <div className="keys-env-toggle">
                {[
                  { id: "live", label: "Live (production)", desc: "sk_live_ — real sending" },
                  { id: "test", label: "Test", desc: "sk_test_ — non-production" },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`keys-env-option ${form.environment === opt.id ? "active" : ""}`}
                    onClick={() => setForm((p) => ({ ...p, environment: opt.id }))}
                  >
                    <b>{opt.label}</b>
                    <span>{opt.desc}</span>
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Scopes" full>
              <div className="keys-scope-grid">
                {KEY_SCOPE_OPTIONS.map((s) => {
                  const on = form.scopes.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      className={`keys-scope-option ${on ? "on" : ""}`}
                      onClick={() =>
                        setForm((p) => ({ ...p, scopes: toggleScopeValue(p.scopes, s.id) }))
                      }
                    >
                      <span className="keys-scope-check">{on ? <Check size={14} /> : null}</span>
                      <span>
                        <b>{s.label}</b>
                        <small>{s.hint}</small>
                      </span>
                    </button>
                  );
                })}
              </div>
            </Field>
            <p className="role-grant-hint">
              The full secret is shown <b>once</b> after create. Store it in your secrets manager.
              Authorization header: <code className="mono">Bearer sk_…</code>
            </p>
            <div className="full" style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="btn" disabled={busy} onClick={() => setCreateOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="btn primary" disabled={busy || !form.name.trim()}>
                {busy ? "Creating…" : form.environment === "live" ? "Create live key" : "Create test key"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {/* Secret reveal — once only */}
      {secretReveal?.secret ? (
        <Modal
          title="Copy your API secret now"
          onClose={() => {
            if (!secretAck) {
              setMsg("Confirm you have saved the secret before closing");
              return;
            }
            setSecretReveal(null);
            setSecretAck(false);
          }}
          wide
        >
          <div className="keys-secret-modal">
            <Banner tone="warn">
              This is the <b>only</b> time the full secret for <b>{secretReveal.name}</b> is shown.
              It cannot be retrieved from the server again.
            </Banner>
            <div className="keys-secret-box">
              <code className="mono">{secretReveal.secret}</code>
              <CopyButton
                className="btn primary"
                text={secretReveal.secret}
                label="Copy secret"
                iconSize={15}
              />
            </div>
            <div className="kv compact" style={{ marginTop: 12 }}>
              <div>
                <span>Prefix (safe to display)</span>
                <b className="mono">{secretReveal.prefix}…</b>
              </div>
              <div>
                <span>Usage</span>
                <b className="mono">Authorization: Bearer &lt;secret&gt;</b>
              </div>
            </div>
            <label className="keys-ack">
              <input
                type="checkbox"
                checked={secretAck}
                onChange={(e) => setSecretAck(e.target.checked)}
              />
              <span>I have stored this secret securely and understand it will not be shown again.</span>
            </label>
            <div className="grant-actions">
              <button
                type="button"
                className="btn primary"
                disabled={!secretAck}
                onClick={() => {
                  setSecretReveal(null);
                  setSecretAck(false);
                  setMsg("Key ready — secret was only shown once");
                }}
              >
                Done
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* Detail modal — full key card */}
      {detail ? (
        <Modal
          title="API key"
          wide
          onClose={() => !busy && closeDetail()}
        >
          <div className="keys-detail-modal">
            <header className="keys-detail-hero">
              <div className="keys-detail-hero-main">
                <span className={`keys-detail-badge ${keyEnvironment(detail)}`}>
                  <KeyRound size={22} />
                </span>
                <div>
                  <h3 className="keys-detail-title">{detail.name}</h3>
                  <p className="keys-detail-sub mono">
                    {detail.key_prefix}… · {detail.workspace_name || "No workspace name"}
                  </p>
                  <div className="keys-detail-tags">
                    <span className={`tag ${detail.status === "active" ? "ok" : "bad"}`}>
                      {detail.status}
                    </span>
                    <span className={`tag ${keyEnvironment(detail) === "live" ? "warn" : "ok"}`}>
                      {keyEnvironment(detail)}
                    </span>
                    {!detail.last_used_at && detail.status === "active" ? (
                      <span className="tag warn">never used</span>
                    ) : null}
                    {detailDirty ? <span className="tag warn">unsaved edits</span> : null}
                  </div>
                </div>
              </div>
              <div className="keys-detail-hero-actions">
                {detail.status === "active" ? (
                  <>
                    <button type="button" className="btn sm" disabled={busy} onClick={() => rotateKey(detail)}>
                      <RefreshCw size={14} /> Rotate
                    </button>
                    <button
                      type="button"
                      className="btn danger sm"
                      disabled={busy}
                      onClick={() => revokeKey(detail)}
                    >
                      <Ban size={14} /> Revoke
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn danger sm"
                    disabled={busy}
                    onClick={() => deleteRevoked(detail)}
                  >
                    Remove from list
                  </button>
                )}
              </div>
            </header>

            <nav className="keys-detail-tabs" aria-label="Key sections">
              {[
                { id: "overview", label: "Overview", icon: <IdCard size={14} /> },
                { id: "settings", label: "Settings", icon: <Settings size={14} /> },
                { id: "integrate", label: "Integrate", icon: <Terminal size={14} /> },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`keys-detail-tab ${detailTab === t.id ? "active" : ""}`}
                  onClick={() => setDetailTab(t.id)}
                  disabled={t.id === "settings" && detail.status !== "active"}
                  title={
                    t.id === "settings" && detail.status !== "active"
                      ? "Revoked keys cannot be edited"
                      : t.label
                  }
                >
                  {t.icon}
                  {t.label}
                </button>
              ))}
            </nav>

            {detailTab === "overview" ? (
              <div className="keys-detail-pane">
                <div className="keys-detail-grid">
                  <article className="keys-detail-card">
                    <h4>Identity</h4>
                    <div className="kv compact">
                      <div>
                        <span>Key ID</span>
                        <b className="mono keys-copy-row">
                          <span className="keys-ellipsis">{detail.id}</span>
                          <CopyButton text={detail.id} label="Copy" iconSize={13} />
                        </b>
                      </div>
                      <div>
                        <span>Prefix (safe)</span>
                        <b className="mono keys-copy-row">
                          {detail.key_prefix}…
                          <CopyButton text={detail.key_prefix || ""} label="Copy" iconSize={13} />
                        </b>
                      </div>
                      <div>
                        <span>Full secret</span>
                        <b className="keys-secret-locked">
                          <Lock size={14} /> Not stored — create or rotate to get a new secret
                        </b>
                      </div>
                    </div>
                  </article>

                  <article className="keys-detail-card">
                    <h4>Placement</h4>
                    <div className="kv compact">
                      <div>
                        <span>Workspace</span>
                        <b>{detail.workspace_name || "—"}</b>
                      </div>
                      <div>
                        <span>Workspace owner</span>
                        <b>{detail.owner_email || "—"}</b>
                      </div>
                      <div>
                        <span>Environment</span>
                        <b className="capitalize">{keyEnvironment(detail)}</b>
                      </div>
                    </div>
                  </article>

                  <article className="keys-detail-card">
                    <h4>Activity</h4>
                    <div className="kv compact">
                      <div>
                        <span>Status</span>
                        <b className="capitalize">{detail.status}</b>
                      </div>
                      <div>
                        <span>Last used</span>
                        <b>{detail.last_used_at ? fmtTime(detail.last_used_at) : "Never"}</b>
                      </div>
                      <div>
                        <span>Created</span>
                        <b>{fmtTime(detail.created_at)}</b>
                      </div>
                    </div>
                  </article>

                  <article className="keys-detail-card keys-detail-card-wide">
                    <h4>Scopes ({keyScopesList(detail).length})</h4>
                    <div className="keys-scopes-cell keys-scopes-detail">
                      {keyScopesList(detail).length ? (
                        keyScopesList(detail).map((s) => {
                          const meta = KEY_SCOPE_OPTIONS.find((o) => o.id === s);
                          return (
                            <span key={s} className="keys-scope-pill on" title={meta?.hint || s}>
                              {meta?.label || s}
                            </span>
                          );
                        })
                      ) : (
                        <span className="muted-sm">No scopes recorded</span>
                      )}
                    </div>
                  </article>
                </div>
              </div>
            ) : null}

            {detailTab === "settings" && detail.status === "active" ? (
              <form className="keys-detail-pane form" onSubmit={saveDetail}>
                <Field label="Display name" full>
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    maxLength={80}
                    required
                    autoFocus
                  />
                </Field>
                {(workspaces.rows || []).length > 0 ? (
                  <Field label="User workspace" full>
                    <AppSelect
                      value={editWorkspaceId}
                      onChange={setEditWorkspaceId}
                      options={(workspaces.rows || []).map((w) => ({
                        value: w.id,
                        label: w.name || w.id,
                      }))}
                    />
                  </Field>
                ) : null}
                <Field label="Scopes" full>
                  <div className="keys-scope-grid">
                    {KEY_SCOPE_OPTIONS.map((s) => {
                      const on = editScopes.includes(s.id);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          className={`keys-scope-option ${on ? "on" : ""}`}
                          onClick={() => setEditScopes((prev) => toggleScopeValue(prev, s.id))}
                        >
                          <span className="keys-scope-check">{on ? <Check size={14} /> : null}</span>
                          <span>
                            <b>{s.label}</b>
                            <small>{s.hint}</small>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </Field>
                <p className="role-grant-hint">
                  Changing scopes updates what this key may do on the next request. Rotating is safer
                  if the secret may have leaked.
                </p>
                <div className="grant-actions">
                  <button type="button" className="btn" disabled={busy} onClick={closeDetail}>
                    {detailDirty ? "Discard & close" : "Close"}
                  </button>
                  <button type="submit" className="btn primary" disabled={busy || !detailDirty}>
                    {busy ? "Saving…" : detailDirty ? "Save changes" : "No changes"}
                  </button>
                </div>
              </form>
            ) : null}

            {detailTab === "integrate" ? (
              <div className="keys-detail-pane">
                <article className="keys-detail-card keys-detail-card-wide">
                  <h4>
                    <Terminal size={15} /> Bearer authentication
                  </h4>
                  <p className="role-grant-hint" style={{ marginTop: 0 }}>
                    Use the <b>full secret</b> (from create/rotate) — not the prefix alone. Never ship live
                    secrets in frontend code.
                  </p>
                  <pre className="keys-code-block mono">{authSnippet(detail)}</pre>
                  <CopyButton
                    getText={() => authSnippet(detail)}
                    label="Copy example"
                    iconSize={14}
                  />
                </article>
                <article className="keys-detail-card keys-detail-card-wide" style={{ marginTop: 12 }}>
                  <h4>Header</h4>
                  <pre className="keys-code-block mono">{`Authorization: Bearer ${detail.key_prefix}…<your-full-secret>`}</pre>
                </article>
                <div className="grant-actions" style={{ marginTop: 14 }}>
                  <button type="button" className="btn" onClick={closeDetail}>
                    Close
                  </button>
                </div>
              </div>
            ) : null}

            {detailTab === "overview" ? (
              <div className="grant-actions" style={{ marginTop: 14 }}>
                <button type="button" className="btn" disabled={busy} onClick={closeDetail}>
                  Close
                </button>
                {detail.status === "active" ? (
                  <button type="button" className="btn primary" onClick={() => setDetailTab("settings")}>
                    <Settings size={14} /> Edit settings
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </>
  );
}

const MESSAGE_STREAMS = ["Transactional", "OTP", "Marketing", "Automations"];
const MESSAGE_STATUSES = ["queued", "sent", "delivered", "bounced", "failed", "cancelled"];

function messageStatusTone(status) {
  const s = String(status || "").toLowerCase();
  if (s === "delivered" || s === "sent") return "ok";
  if (s === "queued") return "warn";
  if (s === "cancelled") return "slate";
  return "bad";
}

function messageStatusLabel(status) {
  const s = String(status || "");
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "—";
}

function parseMessageMeta(m) {
  let meta = m?.meta;
  if (meta == null) return {};
  if (typeof meta === "string") {
    try {
      meta = JSON.parse(meta);
    } catch {
      return {};
    }
  }
  return typeof meta === "object" && !Array.isArray(meta) ? meta : {};
}

export function MessagesPage({ token, session, events = [], onChanged }) {
  const confirm = useAppConfirm();
  const { rows, total, err, loading, load } = useEntity(token, "/api/messages");
  const workspaces = useEntity(token, "/api/workspaces");
  const { copy: copyText, isCopied, copyIcon } = useCopyFeedback();

  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [streamFilter, setStreamFilter] = useState("all");
  const [wsFilter, setWsFilter] = useState("all");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const [queueOpen, setQueueOpen] = useState(false);
  const [form, setForm] = useState({
    to: "",
    from: "hello@senditto.local",
    subject: "",
    stream: "Transactional",
    workspaceId: "",
    body: "",
    respectSuppressions: true,
  });

  const [detailId, setDetailId] = useState(null);
  const [detailTab, setDetailTab] = useState("overview"); // overview | status | meta
  const [statusNote, setStatusNote] = useState("");

  const lastRt = useRef("");
  useEffect(() => {
    if (!events?.length) return;
    const ev = events[0];
    if (ev?.type !== "message") return;
    const sig = `${ev.event}:${ev.id || ""}:${ev.status || ""}:${ev.at || ""}`;
    if (sig === lastRt.current) return;
    lastRt.current = sig;
    load();
    onChanged?.();
  }, [events, load, onChanged]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((m) => {
      const hay = `${m.to_email || ""} ${m.from_email || ""} ${m.subject || ""} ${m.stream || ""} ${m.status || ""} ${m.workspace_name || ""} ${m.id || ""}`.toLowerCase();
      if (needle && !hay.includes(needle)) return false;
      if (statusFilter !== "all" && String(m.status || "").toLowerCase() !== statusFilter) return false;
      if (streamFilter !== "all" && m.stream !== streamFilter) return false;
      if (wsFilter !== "all" && String(m.workspace_id || "") !== wsFilter) return false;
      return true;
    });
  }, [rows, q, statusFilter, streamFilter, wsFilter]);

  const filterKey = `${q}|${statusFilter}|${streamFilter}|${wsFilter}`;
  const pager = useClientPager(filtered, { resetKey: filterKey });
  const bulk = useBulkSelection(pager.pageRows, { resetKey: filterKey });

  const detail = useMemo(() => rows.find((m) => m.id === detailId) || null, [rows, detailId]);
  const detailMeta = useMemo(() => parseMessageMeta(detail), [detail]);

  useEffect(() => {
    if (!detail) return;
    setDetailTab("overview");
    setStatusNote("");
  }, [detail?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const workspaceOptions = useMemo(() => {
    const list = (workspaces.rows || []).map((w) => ({
      value: w.id,
      label: w.name || w.id,
    }));
    return [{ value: "", label: "Default workspace" }, ...list];
  }, [workspaces.rows]);

  const stats = useMemo(() => {
    const queued = rows.filter((m) => m.status === "queued").length;
    const delivered = rows.filter((m) => m.status === "delivered" || m.status === "sent").length;
    const failed = rows.filter((m) => m.status === "failed" || m.status === "bounced").length;
    const cancelled = rows.filter((m) => m.status === "cancelled").length;
    return { queued, delivered, failed, cancelled };
  }, [rows]);

  async function bulkSetStatus(status) {
    if (!bulk.count) return;
    const ok = await confirm({
      title: `Bulk: mark ${messageStatusLabel(status)}`,
      message: `Set status to “${messageStatusLabel(status)}” for ${bulk.count} selected message${bulk.count === 1 ? "" : "s"}?`,
      confirmLabel: `Mark ${messageStatusLabel(status)}`,
      danger: status === "failed" || status === "bounced",
    });
    if (!ok) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await runBulk(bulk.selectedIds, (id) =>
        api(`/api/messages/${id}`, { method: "PATCH", token, body: { status } })
      );
      setMsg(
        res.fail
          ? `Updated ${res.ok}, failed ${res.fail}`
          : `Updated ${res.ok} message${res.ok === 1 ? "" : "s"} → ${messageStatusLabel(status)}`
      );
      bulk.clear();
      await load();
      onChanged?.();
    } catch (ex) {
      setMsg(redact(ex.message));
    } finally {
      setBusy(false);
    }
  }

  async function bulkDeleteMessages() {
    if (!bulk.count) return;
    const ids = [...bulk.selectedIds];
    const ok = await confirm({
      title: "Bulk delete messages",
      message: `Permanently delete ${ids.length} selected message${ids.length === 1 ? "" : "s"} from the send log?`,
      danger: true,
      confirmLabel: "Delete selected",
    });
    if (!ok) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await runBulk(ids, (id) => api(`/api/messages/${id}`, { method: "DELETE", token }));
      setMsg(res.fail ? `Deleted ${res.ok}, failed ${res.fail}` : `Deleted ${res.ok} message${res.ok === 1 ? "" : "s"}`);
      if (detailId && ids.some((id) => String(id) === String(detailId))) setDetailId(null);
      bulk.clear();
      await load();
      onChanged?.();
    } catch (ex) {
      setMsg(redact(ex.message));
    } finally {
      setBusy(false);
    }
  }

  function exportSelectedCsv() {
    const set = new Set(bulk.selectedIds.map(String));
    const list = filtered.filter((m) => set.has(String(m.id)));
    if (!list.length) return;
    const cols = ["id", "status", "stream", "from_email", "to_email", "subject", "workspace_name", "created_at"];
    const lines = [cols.join(",")];
    for (const m of list) {
      lines.push(cols.map((c) => `"${String(m[c] ?? "").replace(/"/g, '""')}"`).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `senditto-messages-selected-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    setMsg(`Exported ${list.length} selected message${list.length === 1 ? "" : "s"}`);
  }

  async function queueMessage(e) {
    e.preventDefault();
    if (!form.to.trim() || !form.subject.trim()) {
      setMsg("Recipient and subject are required");
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      const body = {
        to: form.to.trim(),
        from: form.from.trim() || "hello@senditto.local",
        subject: form.subject.trim(),
        stream: form.stream,
        body: form.body || undefined,
        respectSuppressions: form.respectSuppressions,
      };
      if (form.workspaceId) body.workspaceId = form.workspaceId;
      const data = await api("/api/messages", { method: "POST", token, body });
      setMsg(`Queued to ${data.message?.to_email || form.to}`);
      setQueueOpen(false);
      setForm((p) => ({
        ...p,
        to: "",
        subject: "",
        body: "",
        stream: "Transactional",
      }));
      await load();
      onChanged?.();
      if (data.message?.id) setDetailId(data.message.id);
    } catch (ex) {
      setMsg(redact(ex.message));
    } finally {
      setBusy(false);
    }
  }

  async function setMessageStatus(m, status, note) {
    setBusy(true);
    setMsg("");
    try {
      const body = { status };
      if (note != null && String(note).trim()) body.note = String(note).trim();
      await api(`/api/messages/${m.id}`, { method: "PATCH", token, body });
      setMsg(`${m.to_email || "Message"} → ${messageStatusLabel(status)}`);
      await load();
      onChanged?.();
    } catch (ex) {
      setMsg(redact(ex.message));
    } finally {
      setBusy(false);
    }
  }

  async function deleteMessage(m) {
    const ok = await confirm({
      title: "Delete message",
      message: `Permanently delete message to ${m.to_email || "recipient"} (“${m.subject || "no subject"}”)? This removes it from the send log.`,
      danger: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    setBusy(true);
    setMsg("");
    try {
      await api(`/api/messages/${m.id}`, { method: "DELETE", token });
      setMsg("Message deleted");
      if (detailId === m.id) setDetailId(null);
      await load();
      onChanged?.();
    } catch (ex) {
      setMsg(redact(ex.message));
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    const cols = [
      "id",
      "status",
      "stream",
      "from_email",
      "to_email",
      "subject",
      "workspace_id",
      "workspace_name",
      "created_at",
    ];
    const lines = [cols.join(",")];
    for (const m of filtered) {
      const row = cols.map((c) => `"${String(m[c] ?? "").replace(/"/g, '""')}"`);
      lines.push(row.join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `senditto-messages-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    setMsg(`Exported ${filtered.length} message${filtered.length === 1 ? "" : "s"}`);
  }

  function menuFor(m) {
    const st = String(m.status || "").toLowerCase();
    return [
      {
        id: "open",
        label: "Open details",
        icon: <Mail size={15} />,
        onClick: () => setDetailId(m.id),
      },
      {
        id: "copy-to",
        label: isCopied(`to-${m.id}`) ? "Copied" : "Copy recipient",
        icon: copyIcon(`to-${m.id}`),
        onClick: () => copyText(m.to_email, `to-${m.id}`),
      },
      {
        id: "copy-id",
        label: isCopied(`id-${m.id}`) ? "Copied" : "Copy message ID",
        icon: copyIcon(`id-${m.id}`),
        onClick: () => copyText(m.id, `id-${m.id}`),
      },
      st !== "delivered"
        ? {
            id: "delivered",
            label: "Mark delivered",
            icon: <Check size={15} />,
            onClick: () => setMessageStatus(m, "delivered"),
          }
        : null,
      st !== "queued" && st !== "sent"
        ? {
            id: "requeue",
            label: "Re-queue",
            icon: <RefreshCw size={15} />,
            onClick: () => setMessageStatus(m, "queued"),
          }
        : null,
      st !== "bounced"
        ? {
            id: "bounce",
            label: "Mark bounced",
            icon: <Ban size={15} />,
            onClick: () => setMessageStatus(m, "bounced"),
          }
        : null,
      st !== "failed"
        ? {
            id: "fail",
            label: "Mark failed",
            icon: <X size={15} />,
            danger: true,
            onClick: () => setMessageStatus(m, "failed"),
          }
        : null,
      st !== "cancelled"
        ? {
            id: "cancel",
            label: "Cancel",
            icon: <Pause size={15} />,
            onClick: () => setMessageStatus(m, "cancelled"),
          }
        : null,
      {
        id: "delete",
        label: "Delete…",
        icon: <X size={15} />,
        danger: true,
        onClick: () => deleteMessage(m),
      },
    ].filter(Boolean);
  }

  return (
    <>
      <PageHead
        title="Messages"
        copy="Email send log for user workspaces. Queue tests, track status, and update delivery outcomes in realtime."
        actions={
          <>
            <button className="btn" type="button" onClick={exportCsv} disabled={!filtered.length}>
              <Download size={15} /> Export CSV
            </button>
            <button className="btn" type="button" onClick={load} disabled={loading || busy}>
              <RefreshCw size={15} /> Refresh
            </button>
            <button className="btn primary" type="button" onClick={() => setQueueOpen(true)}>
              <Mail size={15} /> Queue message
            </button>
          </>
        }
      />
      {msg ? (
        <Banner tone={/fail|error|cannot|invalid|required|suppress/i.test(msg) ? "bad" : "ok"}>
          {msg}
        </Banner>
      ) : null}
      {err ? <Banner tone="bad">{err}</Banner> : null}

      <StatGrid
        items={[
          {
            label: "Total",
            value: fmtNum(total ?? rows.length),
            hint: `${fmtNum(filtered.length)} shown`,
            tone: "blue",
            icon: <Mail size={16} />,
          },
          {
            label: "Queued",
            value: fmtNum(stats.queued),
            hint: "Waiting in the pipeline",
            tone: "amber",
          },
          {
            label: "Delivered / sent",
            value: fmtNum(stats.delivered),
            hint: `${fmtNum(stats.cancelled)} cancelled`,
            tone: "green",
          },
          {
            label: "Failed / bounced",
            value: fmtNum(stats.failed),
            hint: "Needs attention",
            tone: "red",
          },
        ]}
      />

      <Panel
        title="Message log"
        copy={
          loading
            ? "Loading…"
            : `${fmtNum(filtered.length)} of ${fmtNum(total ?? rows.length)} messages · realtime on create/update`
        }
      >
        <div className="ws-table-toolbar">
          <div className="tables-search-wrap wide">
            <Search size={14} className="tables-search-ico" />
            <input
              className="tables-search"
              placeholder="Search to, from, subject, workspace, ID…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="ws-chip-row">
            {["all", ...MESSAGE_STATUSES].map((s) => (
              <button
                key={s}
                type="button"
                className={`ws-chip ${statusFilter === s ? "active" : ""}`}
                onClick={() => setStatusFilter(s)}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="ws-chip-row">
            {["all", ...MESSAGE_STREAMS].map((s) => (
              <button
                key={s}
                type="button"
                className={`ws-chip ${streamFilter === s ? "active" : ""}`}
                onClick={() => setStreamFilter(s)}
              >
                {s === "all" ? "all streams" : s}
              </button>
            ))}
          </div>
          {(workspaces.rows || []).length > 0 ? (
            <AppSelect
              size="sm"
              className="ws-filter-select"
              value={wsFilter}
              onChange={setWsFilter}
              options={[
                { value: "all", label: "All workspaces" },
                ...(workspaces.rows || []).map((w) => ({
                  value: w.id,
                  label: w.name || w.id,
                })),
              ]}
              aria-label="Filter by workspace"
            />
          ) : null}
        </div>

        {!loading && filtered.length === 0 ? (
          <div className="empty">
            <b>{rows.length ? "No messages match" : "No messages yet"}</b>
            {rows.length
              ? "Try another search or filter."
              : "Queue a test message for a user workspace to start the send log."}
            {!rows.length ? (
              <div style={{ marginTop: 12 }}>
                <button type="button" className="btn primary" onClick={() => setQueueOpen(true)}>
                  <Mail size={15} /> Queue message
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="paged-table-stack">
            <BulkBar
              count={bulk.count}
              noun={bulk.count === 1 ? "message selected" : "messages selected"}
              pageCount={pager.pageRows.length}
              filteredCount={filtered.length}
              onClear={bulk.clear}
              onSelectPage={bulk.togglePage}
              onSelectAll={() => bulk.selectAll(filtered)}
              allPageSelected={bulk.allPageSelected}
              emptyHint="Select messages with the checkboxes (or Select page / Select all), then run bulk status, export, or delete."
            >
              <button type="button" className="btn sm" disabled={busy || !bulk.count} onClick={() => bulkSetStatus("queued")}>
                Re-queue
              </button>
              <button type="button" className="btn sm" disabled={busy || !bulk.count} onClick={() => bulkSetStatus("sent")}>
                Sent
              </button>
              <button type="button" className="btn sm" disabled={busy || !bulk.count} onClick={() => bulkSetStatus("delivered")}>
                Delivered
              </button>
              <button type="button" className="btn sm" disabled={busy || !bulk.count} onClick={() => bulkSetStatus("bounced")}>
                Bounced
              </button>
              <button type="button" className="btn sm" disabled={busy || !bulk.count} onClick={() => bulkSetStatus("failed")}>
                Failed
              </button>
              <button type="button" className="btn sm" disabled={busy || !bulk.count} onClick={() => bulkSetStatus("cancelled")}>
                Cancel
              </button>
              <button type="button" className="btn sm" disabled={busy || !bulk.count} onClick={exportSelectedCsv}>
                <Download size={14} /> Export
              </button>
              <button type="button" className="btn sm danger" disabled={busy || !bulk.count} onClick={bulkDeleteMessages}>
                Delete
              </button>
            </BulkBar>
            <TableShell rowCount={pager.pageRows.length}>
              <table className="data ws-table msg-table">
                <thead>
                  <tr>
                    <BulkSelectHeader
                      checked={bulk.allPageSelected}
                      indeterminate={bulk.somePageSelected && !bulk.allPageSelected}
                      onChange={bulk.togglePage}
                    />
                    <th>Status</th>
                    <th>Stream</th>
                    <th>To</th>
                    <th>From</th>
                    <th>Subject</th>
                    <th>Workspace</th>
                    <th>When</th>
                    <th className="col-actions" />
                  </tr>
                </thead>
                <tbody>
                  {pager.pageRows.map((m) => (
                    <tr
                      key={m.id}
                      className={`clickable ws-table-row ${detailId === m.id ? "active" : ""} ${bulk.isSelected(m.id) ? "bulk-selected" : ""}`}
                      onClick={() => setDetailId(m.id)}
                    >
                      <BulkSelectCell
                        checked={bulk.isSelected(m.id)}
                        onChange={() => bulk.toggle(m.id)}
                        label={`Select ${m.subject || m.id}`}
                      />
                      <td>
                        <span className={`tag ${messageStatusTone(m.status)}`}>
                          {messageStatusLabel(m.status)}
                        </span>
                      </td>
                      <td>
                        <span className="msg-stream-pill">{m.stream || "—"}</span>
                      </td>
                      <td>
                        <span className="mono msg-email" title={m.to_email}>
                          {m.to_email || "—"}
                        </span>
                      </td>
                      <td>
                        <span className="mono muted-sm" title={m.from_email}>
                          {m.from_email || "—"}
                        </span>
                      </td>
                      <td>
                        <b className="msg-subject" title={m.subject}>
                          {m.subject || "—"}
                        </b>
                      </td>
                      <td>
                        <span className="dom-ws-name">{m.workspace_name || "—"}</span>
                      </td>
                      <td className="muted-sm">{fmtTime(m.created_at)}</td>
                      <td className="col-actions" onClick={(e) => e.stopPropagation()}>
                        <RowMenu items={menuFor(m)} label={`Actions for ${m.subject || m.id}`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
            <TablePager
              page={pager.page}
              pageCount={pager.pageCount}
              total={pager.total}
              from={pager.from}
              to={pager.to}
              pageNumbers={pager.pageNumbers}
              middlePage={pager.middlePage}
              onPageChange={pager.setPage}
              onFirst={pager.goFirst}
              onMiddle={pager.goMiddle}
              onLast={pager.goLast}
              onPrev={pager.goPrev}
              onNext={pager.goNext}
            />
          </div>
        )}
      </Panel>

      {/* Queue message modal */}
      {queueOpen ? (
        <Modal title="Queue message" wide onClose={() => !busy && setQueueOpen(false)}>
          <form className="form" onSubmit={queueMessage}>
            <p className="keys-create-intro">
              Adds a message to the send log for a user workspace. Status starts as queued. Use this for
              tests or to record pipeline entries operators need to track.
            </p>
            <Field label="To (recipient)" full>
              <input
                required
                type="email"
                autoFocus
                value={form.to}
                onChange={(e) => setForm((p) => ({ ...p, to: e.target.value }))}
                placeholder="user@example.com"
              />
            </Field>
            <Field label="From" full>
              <input
                type="email"
                value={form.from}
                onChange={(e) => setForm((p) => ({ ...p, from: e.target.value }))}
                placeholder="hello@yourdomain.com"
              />
            </Field>
            <Field label="Subject" full>
              <input
                required
                value={form.subject}
                onChange={(e) => setForm((p) => ({ ...p, subject: e.target.value }))}
                placeholder="Message subject"
                maxLength={500}
              />
            </Field>
            <Field label="Stream" full>
              <AppSelect
                value={form.stream}
                onChange={(stream) => setForm((p) => ({ ...p, stream }))}
                options={MESSAGE_STREAMS}
                aria-label="Stream"
              />
            </Field>
            <Field label="User workspace" full>
              <AppSelect
                value={form.workspaceId}
                onChange={(workspaceId) => setForm((p) => ({ ...p, workspaceId }))}
                options={workspaceOptions}
                aria-label="Workspace"
              />
            </Field>
            <Field label="Body preview (optional)" full>
              <textarea
                value={form.body}
                onChange={(e) => setForm((p) => ({ ...p, body: e.target.value }))}
                placeholder="Optional text stored in meta for operator context (not a full MIME send)"
                rows={4}
              />
            </Field>
            <label className="keys-ack" style={{ marginBottom: 8 }}>
              <input
                type="checkbox"
                checked={form.respectSuppressions}
                onChange={(e) => setForm((p) => ({ ...p, respectSuppressions: e.target.checked }))}
              />
              <span>Respect suppressions (block queue if recipient is on the block list)</span>
            </label>
            <div className="full" style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="btn" disabled={busy} onClick={() => setQueueOpen(false)}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn primary"
                disabled={busy || !form.to.trim() || !form.subject.trim()}
              >
                {busy ? "Queueing…" : "Queue message"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {/* Detail modal */}
      {detail ? (
        <Modal title="Message" wide onClose={() => !busy && setDetailId(null)}>
          <div className="msg-detail-modal">
            <header className="keys-detail-hero">
              <div className="keys-detail-hero-main">
                <span className={`msg-detail-badge status-${String(detail.status || "").toLowerCase()}`}>
                  <Mail size={22} />
                </span>
                <div>
                  <h3 className="keys-detail-title">{detail.subject || "(no subject)"}</h3>
                  <p className="keys-detail-sub mono">
                    {detail.to_email || "—"} · {detail.stream || "—"}
                  </p>
                  <div className="keys-detail-tags">
                    <span className={`tag ${messageStatusTone(detail.status)}`}>
                      {messageStatusLabel(detail.status)}
                    </span>
                    <span className="tag">{detail.stream || "stream"}</span>
                  </div>
                </div>
              </div>
              <div className="keys-detail-hero-actions">
                {detail.status !== "delivered" ? (
                  <button
                    type="button"
                    className="btn sm primary"
                    disabled={busy}
                    onClick={() => setMessageStatus(detail, "delivered")}
                  >
                    <Check size={14} /> Delivered
                  </button>
                ) : null}
                {detail.status !== "failed" ? (
                  <button
                    type="button"
                    className="btn sm danger"
                    disabled={busy}
                    onClick={() => setMessageStatus(detail, "failed")}
                  >
                    Fail
                  </button>
                ) : null}
              </div>
            </header>

            <nav className="keys-detail-tabs" aria-label="Message sections">
              {[
                { id: "overview", label: "Overview", icon: <Mail size={14} /> },
                { id: "status", label: "Status", icon: <Activity size={14} /> },
                { id: "meta", label: "Meta", icon: <Settings size={14} /> },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`keys-detail-tab ${detailTab === t.id ? "active" : ""}`}
                  onClick={() => setDetailTab(t.id)}
                >
                  {t.icon}
                  {t.label}
                </button>
              ))}
            </nav>

            {detailTab === "overview" ? (
              <div className="keys-detail-pane">
                <div className="keys-detail-grid">
                  <article className="keys-detail-card">
                    <h4>Recipients</h4>
                    <div className="kv compact">
                      <div>
                        <span>To</span>
                        <b className="mono keys-copy-row">
                          {detail.to_email || "—"}
                          {detail.to_email ? (
                            <CopyButton text={detail.to_email} label="Copy" iconSize={13} />
                          ) : null}
                        </b>
                      </div>
                      <div>
                        <span>From</span>
                        <b className="mono keys-copy-row">
                          {detail.from_email || "—"}
                          {detail.from_email ? (
                            <CopyButton text={detail.from_email} label="Copy" iconSize={13} />
                          ) : null}
                        </b>
                      </div>
                    </div>
                  </article>
                  <article className="keys-detail-card">
                    <h4>Placement</h4>
                    <div className="kv compact">
                      <div>
                        <span>Workspace</span>
                        <b>{detail.workspace_name || "—"}</b>
                      </div>
                      <div>
                        <span>Owner</span>
                        <b>{detail.owner_email || "—"}</b>
                      </div>
                      <div>
                        <span>Stream</span>
                        <b>{detail.stream || "—"}</b>
                      </div>
                    </div>
                  </article>
                  <article className="keys-detail-card">
                    <h4>Identity</h4>
                    <div className="kv compact">
                      <div>
                        <span>Message ID</span>
                        <b className="mono keys-copy-row">
                          <span className="keys-ellipsis">{detail.id}</span>
                          <CopyButton text={detail.id} label="Copy" iconSize={13} />
                        </b>
                      </div>
                      <div>
                        <span>Created</span>
                        <b>{fmtTime(detail.created_at)}</b>
                      </div>
                      <div>
                        <span>Status</span>
                        <b>{messageStatusLabel(detail.status)}</b>
                      </div>
                    </div>
                  </article>
                  {detailMeta.bodyPreview ? (
                    <article className="keys-detail-card keys-detail-card-wide">
                      <h4>Body preview</h4>
                      <pre className="keys-code-block">{detailMeta.bodyPreview}</pre>
                    </article>
                  ) : null}
                </div>
                <div className="grant-actions" style={{ marginTop: 14 }}>
                  <button type="button" className="btn" onClick={() => setDetailId(null)}>
                    Close
                  </button>
                  <button type="button" className="btn" onClick={() => setDetailTab("status")}>
                    Update status
                  </button>
                  <button
                    type="button"
                    className="btn danger"
                    disabled={busy}
                    onClick={() => deleteMessage(detail)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ) : null}

            {detailTab === "status" ? (
              <div className="keys-detail-pane">
                <p className="role-grant-hint" style={{ marginTop: 0 }}>
                  Current status:{" "}
                  <span className={`tag ${messageStatusTone(detail.status)}`}>
                    {messageStatusLabel(detail.status)}
                  </span>
                  . Choose a new outcome for this pipeline entry.
                </p>
                <div className="msg-status-grid">
                  {MESSAGE_STATUSES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`msg-status-option ${detail.status === s ? "active" : ""} tone-${messageStatusTone(s)}`}
                      disabled={busy || detail.status === s}
                      onClick={() => setMessageStatus(detail, s, statusNote)}
                    >
                      <b>{messageStatusLabel(s)}</b>
                      <span>
                        {s === "queued"
                          ? "Waiting to send"
                          : s === "sent"
                            ? "Handed to transport"
                            : s === "delivered"
                              ? "Accepted by mailbox"
                              : s === "bounced"
                                ? "Hard or soft bounce"
                                : s === "failed"
                                  ? "Send error"
                                  : "Cancelled by operator"}
                      </span>
                    </button>
                  ))}
                </div>
                <Field label="Operator note (optional)" full>
                  <input
                    value={statusNote}
                    onChange={(e) => setStatusNote(e.target.value)}
                    placeholder="Why this status changed…"
                    maxLength={1000}
                  />
                </Field>
                {Array.isArray(detailMeta.statusHistory) && detailMeta.statusHistory.length ? (
                  <div className="msg-history">
                    <h4>Status history</h4>
                    <ul>
                      {[...detailMeta.statusHistory].reverse().map((h, i) => (
                        <li key={i}>
                          <span className="mono">
                            {h.from || "?"} → {h.to || "?"}
                          </span>
                          <span className="muted-sm">
                            {h.at ? fmtTime(h.at) : ""} {h.by ? `· ${h.by}` : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div className="grant-actions" style={{ marginTop: 14 }}>
                  <button type="button" className="btn" onClick={() => setDetailId(null)}>
                    Close
                  </button>
                </div>
              </div>
            ) : null}

            {detailTab === "meta" ? (
              <div className="keys-detail-pane">
                <article className="keys-detail-card keys-detail-card-wide">
                  <h4>Raw meta (JSON)</h4>
                  <pre className="keys-code-block mono">
                    {JSON.stringify(detailMeta, null, 2) || "{}"}
                  </pre>
                  <CopyButton
                    getText={() => JSON.stringify(detailMeta, null, 2)}
                    label="Copy meta"
                  />
                </article>
                <div className="grant-actions" style={{ marginTop: 14 }}>
                  <button type="button" className="btn" onClick={() => setDetailId(null)}>
                    Close
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </>
  );
}

const SUPPRESSION_REASONS = ["unsubscribe", "bounce", "complaint"];
const SUPPRESSION_SOURCES = [
  "user_unsubscribe",
  "one_click_unsubscribe",
  "bounce_processor",
  "complaint_fbl",
  "delivery_event",
  "platform_api",
];

function suppressionReasonTone(reason) {
  const r = String(reason || "").toLowerCase();
  if (r === "unsubscribe") return "slate";
  if (r === "bounce") return "warn";
  if (r === "complaint") return "bad";
  return "ok";
}

function suppressionReasonLabel(reason) {
  const r = String(reason || "").toLowerCase();
  if (r === "unsubscribe") return "Unsubscribed";
  if (r === "bounce") return "Bounced";
  if (r === "complaint") return "Complaint";
  return r ? r.charAt(0).toUpperCase() + r.slice(1) : "—";
}

function suppressionSourceLabel(source) {
  const s = String(source || "platform_api").toLowerCase();
  const map = {
    user_unsubscribe: "User unsubscribed",
    one_click_unsubscribe: "One-click unsubscribe",
    bounce_processor: "Bounce processor",
    complaint_fbl: "Complaint (FBL)",
    delivery_event: "Delivery event",
    platform_api: "Platform event",
    // legacy
    manual: "Platform event",
    webhook: "Complaint (FBL)",
    api: "Platform event",
    import: "Platform event",
    complaint: "Complaint (FBL)",
  };
  return map[s] || s.replace(/_/g, " ");
}

function suppressionUserNote(s) {
  if (!s) return "";
  return String(s.user_note || s.note || "").trim();
}

export function SuppressionsPage({ token, session, events = [], onChanged }) {
  const confirm = useAppConfirm();
  const { rows, total, err, loading, load } = useEntity(token, "/api/suppressions");
  const workspaces = useEntity(token, "/api/workspaces");
  const { copy: copyText, isCopied, copyIcon } = useCopyFeedback();

  const [q, setQ] = useState("");
  const [reasonFilter, setReasonFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [wsFilter, setWsFilter] = useState("all");
  const [noteFilter, setNoteFilter] = useState("all"); // all | with_note | no_note
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [detailId, setDetailId] = useState(null);
  const [recordOpen, setRecordOpen] = useState(false);
  const [recordForm, setRecordForm] = useState({ email: "", workspaceId: "", note: "", channel: "support_email" });

  const lastRt = useRef("");
  useEffect(() => {
    if (!events?.length) return;
    const ev = events[0];
    if (ev?.type !== "suppression") return;
    const sig = `${ev.event}:${ev.id || ""}:${ev.email || ""}:${ev.reason || ""}:${ev.at || ""}`;
    if (sig === lastRt.current) return;
    lastRt.current = sig;
    load();
    onChanged?.();
  }, [events, load, onChanged]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((s) => {
      const userNote = suppressionUserNote(s);
      const hay = `${s.email || ""} ${s.reason || ""} ${s.source || ""} ${userNote} ${s.workspace_name || ""} ${s.owner_email || ""} ${s.id || ""}`.toLowerCase();
      if (needle && !hay.includes(needle)) return false;
      if (reasonFilter !== "all" && String(s.reason || "").toLowerCase() !== reasonFilter) return false;
      if (sourceFilter !== "all" && String(s.source || "platform_api").toLowerCase() !== sourceFilter) return false;
      if (wsFilter !== "all" && String(s.workspace_id || "") !== wsFilter) return false;
      if (noteFilter === "with_note" && !userNote) return false;
      if (noteFilter === "no_note" && userNote) return false;
      return true;
    });
  }, [rows, q, reasonFilter, sourceFilter, wsFilter, noteFilter]);

  const filterKey = `${q}|${reasonFilter}|${sourceFilter}|${wsFilter}|${noteFilter}`;
  const pager = useClientPager(filtered, { resetKey: filterKey });
  const bulk = useBulkSelection(pager.pageRows, { resetKey: filterKey });
  const detail = useMemo(() => rows.find((s) => String(s.id) === String(detailId)) || null, [rows, detailId]);

  const stats = useMemo(() => {
    const unsubscribe = rows.filter((s) => s.reason === "unsubscribe").length;
    const bounce = rows.filter((s) => s.reason === "bounce").length;
    const complaint = rows.filter((s) => s.reason === "complaint").length;
    const withNote = rows.filter((s) => suppressionUserNote(s)).length;
    return { unsubscribe, bounce, complaint, withNote };
  }, [rows]);

  async function safetyRemove(s) {
    const ok = await confirm({
      title: "Safety unblock",
      message: `Remove ${s.email} from the automatic suppression ledger for “${s.workspace_name || "workspace"}”?\n\nOnly do this when compliance/support has confirmed it is lawful to mail them again. This does not invent or change what the user did — it only clears the block so future sends are allowed.`,
      danger: true,
      confirmLabel: "Safety unblock",
    });
    if (!ok) return;
    setBusy(true);
    setMsg("");
    try {
      await api(`/api/suppressions/${s.id}`, { method: "DELETE", token });
      setMsg(`Safety-unblocked ${s.email}`);
      if (detailId && String(detailId) === String(s.id)) setDetailId(null);
      await load();
      onChanged?.();
    } catch (ex) {
      setMsg(redact(ex.message));
    } finally {
      setBusy(false);
    }
  }

  async function bulkSafetyRemove() {
    if (!bulk.count) return;
    const ids = [...bulk.selectedIds];
    const ok = await confirm({
      title: "Bulk safety unblock",
      message: `Safety-unblock ${ids.length} selected address${ids.length === 1 ? "" : "es"}?\n\nUse only when you must clear automatic blocks. You cannot change unsubscribe/bounce/complaint reasons — those come from users and delivery systems.`,
      danger: true,
      confirmLabel: "Unblock selected",
    });
    if (!ok) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await runBulk(ids, (id) => api(`/api/suppressions/${id}`, { method: "DELETE", token }));
      setMsg(res.fail ? `Unblocked ${res.ok}, failed ${res.fail}` : `Safety-unblocked ${res.ok} address${res.ok === 1 ? "" : "es"}`);
      if (detailId && ids.some((id) => String(id) === String(detailId))) setDetailId(null);
      bulk.clear();
      await load();
      onChanged?.();
    } catch (ex) {
      setMsg(redact(ex.message));
    } finally {
      setBusy(false);
    }
  }

  async function recordOptOut(e) {
    e.preventDefault();
    const email = recordForm.email.trim();
    if (!email) return;
    const ok = await confirm({
      title: "Record user opt-out",
      message: `Record that ${email} asked (via support) to stop receiving mail?\n\nThis creates a real unsubscribe entry with source “support request”. Only do this when the recipient genuinely asked — the request text is stored verbatim for audit.`,
      confirmLabel: "Record opt-out",
    });
    if (!ok) return;
    setBusy(true);
    setMsg("");
    try {
      await api("/api/suppressions", {
        method: "POST",
        token,
        body: {
          email,
          reason: "unsubscribe",
          source: "support_request",
          userNote: recordForm.note.trim(),
          channel: recordForm.channel,
          workspaceId: recordForm.workspaceId || undefined,
        },
      });
      setMsg(`Recorded opt-out for ${email}`);
      setRecordOpen(false);
      setRecordForm({ email: "", workspaceId: "", note: "", channel: "support_email" });
      await load();
      onChanged?.();
    } catch (ex) {
      setMsg(redact(ex.message));
    } finally {
      setBusy(false);
    }
  }

  function exportCsv(list, filename) {
    const cols = [
      "id",
      "email",
      "reason",
      "source",
      "user_note",
      "workspace_name",
      "owner_email",
      "event_at",
      "created_at",
    ];
    const lines = [cols.join(",")];
    for (const s of list) {
      const row = {
        ...s,
        user_note: suppressionUserNote(s),
        event_at: s.event_at || s.created_at,
      };
      lines.push(cols.map((c) => `"${String(row[c] ?? "").replace(/"/g, '""')}"`).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function exportAllCsv() {
    if (!filtered.length) return;
    exportCsv(filtered, `senditto-suppressions-${Date.now()}.csv`);
    setMsg(`Exported ${filtered.length} automatic record${filtered.length === 1 ? "" : "s"}`);
  }

  function exportSelectedCsv() {
    const set = new Set(bulk.selectedIds.map(String));
    const list = filtered.filter((s) => set.has(String(s.id)));
    if (!list.length) return;
    exportCsv(list, `senditto-suppressions-selected-${Date.now()}.csv`);
    setMsg(`Exported ${list.length} selected record${list.length === 1 ? "" : "s"}`);
  }

  function menuFor(s) {
    return [
      {
        id: "open",
        label: "Open record",
        icon: <Ban size={15} />,
        onClick: () => setDetailId(s.id),
      },
      {
        id: "copy-email",
        label: isCopied(`email-${s.id}`) ? "Copied" : "Copy email",
        icon: copyIcon(`email-${s.id}`),
        onClick: () => copyText(s.email, `email-${s.id}`),
      },
      {
        id: "copy-id",
        label: isCopied(`id-${s.id}`) ? "Copied" : "Copy ID",
        icon: copyIcon(`id-${s.id}`),
        onClick: () => copyText(s.id, `id-${s.id}`),
      },
      {
        id: "remove",
        label: "Safety unblock…",
        icon: <X size={15} />,
        danger: true,
        onClick: () => safetyRemove(s),
      },
    ];
  }

  return (
    <>
      <PageHead
        title="Suppressions"
        copy="Automatic compliance ledger. Entries arrive from user opt-outs and delivery feedback — platform owners and admins never invent unsubscribes or change what the user did."
        actions={
          <>
            <button className="btn" type="button" onClick={() => setGuideOpen(true)}>
              <BookOpen size={15} /> How this works
            </button>
            <button className="btn" type="button" onClick={() => setRecordOpen(true)}>
              <Plus size={15} /> Record user opt-out
            </button>
            <button className="btn" type="button" onClick={exportAllCsv} disabled={!filtered.length}>
              <Download size={15} /> Export CSV
            </button>
            <button className="btn" type="button" onClick={load} disabled={loading || busy}>
              <RefreshCw size={15} /> Refresh
            </button>
          </>
        }
      />
      {msg ? (
        <Banner tone={/fail|error|invalid|cannot|forbidden|required/i.test(msg) ? "bad" : "ok"}>{msg}</Banner>
      ) : null}
      {err ? <Banner tone="bad">{err}</Banner> : null}

      <div className="sup-policy-banner" role="note">
        <ShieldCheck size={18} />
        <div>
          <b>Read-only from the operator side</b>
          <span>
            Unsubscribes, bounces, and complaints are written by the product and delivery systems. You can review
            them, export for audits, and use <em>safety unblock</em> only when lawfully clearing a block — never
            mark a user as unsubscribed for them.
          </span>
        </div>
      </div>

      <StatGrid
        items={[
          {
            label: "Auto-recorded",
            value: fmtNum(total ?? rows.length),
            hint: `${fmtNum(filtered.length)} shown`,
            tone: "blue",
            icon: <Ban size={16} />,
          },
          {
            label: "User unsubscribes",
            value: fmtNum(stats.unsubscribe),
            hint: "From recipient opt-out",
            tone: "purple",
          },
          {
            label: "Delivery bounces",
            value: fmtNum(stats.bounce),
            hint: "Hard / permanent fails",
            tone: "amber",
          },
          {
            label: "With user note",
            value: fmtNum(stats.withNote),
            hint: `${fmtNum(stats.complaint)} complaint${stats.complaint === 1 ? "" : "s"}`,
            tone: "green",
          },
        ]}
      />

      <Panel
        title="Automatic suppression ledger"
        copy={
          loading
            ? "Loading…"
            : `${fmtNum(filtered.length)} of ${fmtNum(total ?? rows.length)} records · written by users & delivery · realtime`
        }
      >
        <div className="ws-table-toolbar">
          <div className="tables-search-wrap wide">
            <Search size={14} className="tables-search-ico" />
            <input
              className="tables-search"
              placeholder="Search email, user note, workspace, source…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="ws-chip-row">
            {["all", ...SUPPRESSION_REASONS].map((r) => (
              <button
                key={r}
                type="button"
                className={`ws-chip ${reasonFilter === r ? "active" : ""}`}
                onClick={() => setReasonFilter(r)}
              >
                {r === "all" ? "all events" : suppressionReasonLabel(r).toLowerCase()}
              </button>
            ))}
          </div>
          <div className="ws-chip-row">
            {[
              { id: "all", label: "all notes" },
              { id: "with_note", label: "left a note" },
              { id: "no_note", label: "no note" },
            ].map((n) => (
              <button
                key={n.id}
                type="button"
                className={`ws-chip ${noteFilter === n.id ? "active" : ""}`}
                onClick={() => setNoteFilter(n.id)}
              >
                {n.label}
              </button>
            ))}
          </div>
          <div className="ws-chip-row">
            {["all", ...SUPPRESSION_SOURCES].map((s) => (
              <button
                key={s}
                type="button"
                className={`ws-chip ${sourceFilter === s ? "active" : ""}`}
                onClick={() => setSourceFilter(s)}
              >
                {s === "all" ? "all sources" : suppressionSourceLabel(s)}
              </button>
            ))}
          </div>
          {(workspaces.rows || []).length > 0 ? (
            <AppSelect
              size="sm"
              className="ws-filter-select"
              value={wsFilter}
              onChange={setWsFilter}
              options={[
                { value: "all", label: "All workspaces" },
                ...(workspaces.rows || []).map((w) => ({
                  value: w.id,
                  label: w.name || w.id,
                })),
              ]}
              aria-label="Filter by workspace"
            />
          ) : null}
        </div>

        {!loading && filtered.length === 0 ? (
          <div className="empty">
            <b>{rows.length ? "No records match" : "No automatic suppressions yet"}</b>
            {rows.length
              ? "Try another search or filter."
              : "When a recipient unsubscribes, or delivery reports a bounce/complaint, it will appear here automatically for owners and admins."}
          </div>
        ) : (
          <div className="paged-table-stack">
            <BulkBar
              count={bulk.count}
              noun={bulk.count === 1 ? "record selected" : "records selected"}
              pageCount={pager.pageRows.length}
              filteredCount={filtered.length}
              onClear={bulk.clear}
              onSelectPage={bulk.togglePage}
              onSelectAll={() => bulk.selectAll(filtered)}
              allPageSelected={bulk.allPageSelected}
              emptyHint="Select rows to export or safety-unblock. You cannot change user opt-outs or reasons from here."
            >
              <button type="button" className="btn sm" disabled={busy || !bulk.count} onClick={exportSelectedCsv}>
                <Download size={14} /> Export
              </button>
              <button type="button" className="btn sm danger" disabled={busy || !bulk.count} onClick={bulkSafetyRemove}>
                Safety unblock
              </button>
            </BulkBar>
            <TableShell rowCount={pager.pageRows.length}>
              <table className="data ws-table sup-table">
                <thead>
                  <tr>
                    <BulkSelectHeader
                      checked={bulk.allPageSelected}
                      indeterminate={bulk.somePageSelected && !bulk.allPageSelected}
                      onChange={bulk.togglePage}
                    />
                    <th>Recipient</th>
                    <th>Event</th>
                    <th>How it arrived</th>
                    <th>User note</th>
                    <th>Workspace</th>
                    <th>When</th>
                    <th className="col-actions" />
                  </tr>
                </thead>
                <tbody>
                  {pager.pageRows.map((s) => {
                    const userNote = suppressionUserNote(s);
                    return (
                      <tr
                        key={s.id}
                        className={`clickable ws-table-row ${detailId === s.id ? "active" : ""} ${bulk.isSelected(s.id) ? "bulk-selected" : ""}`}
                        onClick={() => setDetailId(s.id)}
                      >
                        <BulkSelectCell
                          checked={bulk.isSelected(s.id)}
                          onChange={() => bulk.toggle(s.id)}
                          label={`Select ${s.email}`}
                        />
                        <td>
                          <div className="sup-email-cell">
                            <span className="ws-table-avatar sm" data-status={String(s.reason || "").toLowerCase()}>
                              <Ban size={14} />
                            </span>
                            <div>
                              <b className="mono sup-email" title={s.email}>
                                {s.email}
                              </b>
                              {s.owner_email ? <small>Workspace owner {s.owner_email}</small> : null}
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className={`tag ${suppressionReasonTone(s.reason)}`}>
                            {suppressionReasonLabel(s.reason)}
                          </span>
                        </td>
                        <td>
                          <span className="sup-source-pill" title={s.source || ""}>
                            {suppressionSourceLabel(s.source)}
                          </span>
                        </td>
                        <td>
                          {userNote ? (
                            <span className="sup-user-note" title={userNote}>
                              “{userNote.length > 56 ? `${userNote.slice(0, 56)}…` : userNote}”
                            </span>
                          ) : (
                            <span className="muted-sm sup-no-note">No note left</span>
                          )}
                        </td>
                        <td>
                          <span className="dom-ws-name">{s.workspace_name || "—"}</span>
                        </td>
                        <td className="muted-sm">{fmtTime(s.event_at || s.created_at)}</td>
                        <td className="col-actions" onClick={(e) => e.stopPropagation()}>
                          <RowMenu items={menuFor(s)} label={`Actions for ${s.email}`} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableShell>
            <TablePager
              page={pager.page}
              pageCount={pager.pageCount}
              total={pager.total}
              from={pager.from}
              to={pager.to}
              pageNumbers={pager.pageNumbers}
              middlePage={pager.middlePage}
              onPageChange={pager.setPage}
              onFirst={pager.goFirst}
              onMiddle={pager.goMiddle}
              onLast={pager.goLast}
              onPrev={pager.goPrev}
              onNext={pager.goNext}
            />
          </div>
        )}
      </Panel>

      {detail ? (
        <Modal title="Suppression record" wide onClose={() => !busy && setDetailId(null)}>
          <div className="sup-detail-modal">
            <header className="keys-detail-hero">
              <div className="keys-detail-hero-main">
                <span className={`sup-detail-badge reason-${String(detail.reason || "unsubscribe").toLowerCase()}`}>
                  <Ban size={22} />
                </span>
                <div>
                  <h3 className="keys-detail-title mono">{detail.email}</h3>
                  <p className="keys-detail-sub">
                    Automatic record · {suppressionSourceLabel(detail.source)} ·{" "}
                    {detail.workspace_name || "Workspace"}
                  </p>
                  <div className="keys-detail-tags">
                    <span className={`tag ${suppressionReasonTone(detail.reason)}`}>
                      {suppressionReasonLabel(detail.reason)}
                    </span>
                    <span className="tag">Recorded automatically</span>
                  </div>
                </div>
              </div>
              <div className="keys-detail-hero-actions">
                <CopyButton text={detail.email || ""} label="Copy email" />
                <button type="button" className="btn sm danger" disabled={busy} onClick={() => safetyRemove(detail)}>
                  <X size={14} /> Safety unblock
                </button>
              </div>
            </header>

            <div className="sup-detail-body">
              {suppressionUserNote(detail) ? (
                <article className="sup-user-note-block">
                  <h4>What the recipient left</h4>
                  <blockquote>“{suppressionUserNote(detail)}”</blockquote>
                  <p className="muted-sm">
                    This text came from the user or delivery event. Platform operators cannot edit or invent it.
                  </p>
                </article>
              ) : (
                <article className="sup-user-note-block empty-note">
                  <h4>What the recipient left</h4>
                  <p>No note or feedback was provided with this event.</p>
                </article>
              )}

              <div className="keys-detail-grid">
                <div className="keys-detail-card">
                  <small>Event</small>
                  <b>{suppressionReasonLabel(detail.reason)}</b>
                </div>
                <div className="keys-detail-card">
                  <small>How it arrived</small>
                  <b>{suppressionSourceLabel(detail.source)}</b>
                </div>
                <div className="keys-detail-card">
                  <small>Workspace</small>
                  <b>{detail.workspace_name || "—"}</b>
                  {detail.owner_email ? <span className="muted-sm">{detail.owner_email}</span> : null}
                </div>
                <div className="keys-detail-card">
                  <small>Event time</small>
                  <b>{fmtTime(detail.event_at || detail.created_at)}</b>
                </div>
                <div className="keys-detail-card">
                  <small>Recorded in ledger</small>
                  <b>{fmtTime(detail.created_at)}</b>
                </div>
                <div className="keys-detail-card">
                  <small>Last update</small>
                  <b>{fmtTime(detail.updated_at || detail.created_at)}</b>
                </div>
              </div>

              <div className="sup-readonly-callout">
                <Lock size={15} />
                <span>
                  Owners and admins cannot mark unsubscribe, bounce, or complaint from this console. Those actions
                  belong to recipients and the delivery platform. The only operator action is safety unblock when
                  mailing must lawfully resume.
                </span>
              </div>

              <div className="sup-detail-id mono muted-sm">
                ID {detail.id}{" "}
                <CopyButton text={detail.id || ""} label="Copy" showLabel className="btn sm" />
              </div>
              <div className="grant-actions" style={{ marginTop: 14 }}>
                <button type="button" className="btn" onClick={() => setDetailId(null)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </Modal>
      ) : null}

      {recordOpen ? (
        <Modal title="Record user opt-out (support request)" onClose={() => setRecordOpen(false)}>
          <form onSubmit={recordOptOut}>
            <p className="muted-sm" style={{ marginTop: 0 }}>
              Use this only when a recipient asked support (email, phone, letter) to stop receiving mail. It records a
              genuine unsubscribe on their behalf — source is stored as “support request” and is fully audited.
            </p>
            <div className="form">
              <Field label="Recipient email" full>
                <input
                  type="email"
                  required
                  autoFocus
                  value={recordForm.email}
                  onChange={(e) => setRecordForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="person@example.com"
                />
              </Field>
              <Field label="Workspace">
                <AppSelect
                  value={recordForm.workspaceId}
                  onChange={(v) => setRecordForm((f) => ({ ...f, workspaceId: v }))}
                  options={[
                    { value: "", label: "All workspaces (global)" },
                    ...(workspaces.rows || []).map((w) => ({ value: String(w.id), label: w.name || w.id })),
                  ]}
                />
              </Field>
              <Field label="Request channel">
                <AppSelect
                  value={recordForm.channel}
                  onChange={(v) => setRecordForm((f) => ({ ...f, channel: v }))}
                  options={[
                    { value: "support_email", label: "Support email" },
                    { value: "support_phone", label: "Phone call" },
                    { value: "support_chat", label: "Live chat" },
                    { value: "letter", label: "Letter / postal" },
                  ]}
                />
              </Field>
              <Field label="What the user said (verbatim)" full>
                <textarea
                  rows={3}
                  value={recordForm.note}
                  onChange={(e) => setRecordForm((f) => ({ ...f, note: e.target.value }))}
                  placeholder="“Please stop sending me marketing emails.”"
                />
              </Field>
            </div>
            <div className="grant-actions" style={{ marginTop: 16 }}>
              <button className="btn" type="button" onClick={() => setRecordOpen(false)}>
                Cancel
              </button>
              <button className="btn primary" type="submit" disabled={busy || !recordForm.email.trim()}>
                {busy ? "Recording…" : "Record opt-out"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {guideOpen ? (
        <Modal title="How suppressions work" wide onClose={() => setGuideOpen(false)}>
          <div className="sup-guide-prose">
            <h3>Automatic only</h3>
            <p>
              This ledger is filled by the product when a <b>recipient unsubscribes</b> (including one-click), when
              the <b>bounce processor</b> reports a permanent failure, or when a <b>spam complaint</b> arrives.
              Database owners and admins watch and audit — they do not act as the user.
            </p>
            <h3>User notes</h3>
            <p>
              If the recipient left a reason or feedback when opting out (or the delivery event included a note), it
              appears under <b>User note</b>. That text is never rewritten from the studio.
            </p>
            <h3>What operators may do</h3>
            <ul>
              <li>Search, filter, open records, export CSV for compliance reviews</li>
              <li>
                <b>Safety unblock</b> — remove a ledger row when support/legal confirms the address may receive
                mail again
              </li>
            </ul>
            <h3>What operators must not do</h3>
            <ul>
              <li>Mark someone as unsubscribed, bounced, or complained “for them”</li>
              <li>Change the event reason or invent a user note</li>
              <li>Force preference changes that belong on the user / product side</li>
            </ul>
            <div className="grant-actions" style={{ marginTop: 16 }}>
              <button type="button" className="btn primary" onClick={() => setGuideOpen(false)}>
                Got it
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

const AUDIT_LEVELS = ["info", "warn", "error", "success"];

function auditLevelTone(level) {
  const l = String(level || "").toLowerCase();
  if (l === "error" || l === "warn") return "bad";
  if (l === "success") return "ok";
  if (l === "info") return "slate";
  return "ok";
}

function auditLevelLabel(level) {
  const l = String(level || "info");
  return l.charAt(0).toUpperCase() + l.slice(1);
}

function auditCategoryOf(a) {
  if (a?.category) return String(a.category);
  const ev = String(a?.event || "");
  return ev.includes(".") ? ev.split(".")[0] : ev || "system";
}

function auditMetaText(a) {
  const m = a?.meta;
  if (m == null) return "";
  if (typeof m === "string") return m;
  try {
    return JSON.stringify(m);
  } catch {
    return "";
  }
}

export function AuditPage({ token, events = [], rtState = "connecting", onChanged }) {
  // Always-on trail — no pause. High limit so operators see the full recent stream.
  const { rows, total, err, loading, load } = useEntity(token, "/api/audit?limit=500");
  const workspaces = useEntity(token, "/api/workspaces");
  const { copy: copyText, isCopied, copyIcon } = useCopyFeedback();

  const [q, setQ] = useState("");
  const [level, setLevel] = useState("all");
  const [category, setCategory] = useState("all");
  const [wsFilter, setWsFilter] = useState("all");
  const [msg, setMsg] = useState("");
  const [detailId, setDetailId] = useState(null);
  const [liveFlash, setLiveFlash] = useState(0);
  const [lastLiveAt, setLastLiveAt] = useState(null);

  // Permanent live: every SSE audit event refreshes the table immediately
  const lastRt = useRef("");
  useEffect(() => {
    if (!events?.length) return;
    const ev = events[0];
    if (ev?.type !== "audit") return;
    const sig = `${ev.event}:${ev.id || ""}:${ev.auditEvent || ""}:${ev.at || ""}`;
    if (sig === lastRt.current) return;
    lastRt.current = sig;
    setLiveFlash((n) => n + 1);
    setLastLiveAt(ev.at || new Date().toISOString());
    load();
    onChanged?.();
  }, [events, load, onChanged]);

  // Safety net: soft re-fetch while the page is open so nothing stays stale if an SSE tick is missed
  useEffect(() => {
    if (!token) return undefined;
    const id = window.setInterval(() => {
      load();
    }, 12_000);
    return () => window.clearInterval(id);
  }, [token, load]);

  const categories = useMemo(() => {
    const set = new Set();
    for (const a of rows) set.add(auditCategoryOf(a));
    return [...set].sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((a) => {
      const cat = auditCategoryOf(a);
      const hay = `${a.level || ""} ${a.event || ""} ${a.message || ""} ${cat} ${a.workspace_name || ""} ${a.owner_email || ""} ${auditMetaText(a)} ${a.id || ""}`.toLowerCase();
      if (needle && !hay.includes(needle)) return false;
      if (level !== "all" && String(a.level || "").toLowerCase() !== level) return false;
      if (category !== "all" && cat !== category) return false;
      if (wsFilter === "platform" && a.workspace_id) return false;
      if (wsFilter !== "all" && wsFilter !== "platform" && String(a.workspace_id || "") !== wsFilter) return false;
      return true;
    });
  }, [rows, q, level, category, wsFilter]);

  const filterKey = `${q}|${level}|${category}|${wsFilter}`;
  const pager = useClientPager(filtered, { resetKey: filterKey });
  const detail = useMemo(() => rows.find((a) => String(a.id) === String(detailId)) || null, [rows, detailId]);

  const stats = useMemo(() => {
    const info = rows.filter((a) => a.level === "info").length;
    const warn = rows.filter((a) => a.level === "warn").length;
    const error = rows.filter((a) => a.level === "error").length;
    const hourAgo = Date.now() - 60 * 60 * 1000;
    const lastHour = rows.filter((a) => {
      const t = new Date(a.created_at).getTime();
      return !Number.isNaN(t) && t >= hourAgo;
    }).length;
    return { info, warn, error, lastHour };
  }, [rows]);

  function exportJson(list, filename) {
    const blob = new Blob([JSON.stringify(list, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function exportCsv(list, filename) {
    const cols = [
      "id",
      "date",
      "time",
      "created_at_iso",
      "level",
      "category",
      "event",
      "message",
      "workspace_name",
      "workspace_id",
      "meta",
    ];
    const lines = [cols.join(",")];
    for (const a of list) {
      const row = {
        id: a.id,
        date: fmtDate(a.created_at),
        time: fmtClock(a.created_at),
        created_at_iso: fmtIso(a.created_at),
        level: a.level,
        category: auditCategoryOf(a),
        event: a.event,
        message: a.message,
        workspace_name: a.workspace_name,
        workspace_id: a.workspace_id,
        meta: auditMetaText(a),
      };
      lines.push(cols.map((c) => `"${String(row[c] ?? "").replace(/"/g, '""')}"`).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function exportAll(kind) {
    if (!filtered.length) return;
    if (kind === "csv") {
      exportCsv(filtered, `senditto-audit-${Date.now()}.csv`);
      setMsg(`Exported ${filtered.length} event${filtered.length === 1 ? "" : "s"} as CSV`);
    } else {
      exportJson(filtered, `senditto-audit-${Date.now()}.json`);
      setMsg(`Exported ${filtered.length} event${filtered.length === 1 ? "" : "s"} as JSON`);
    }
  }

  function menuFor(a) {
    return [
      {
        id: "open",
        label: "Open details",
        icon: <Activity size={15} />,
        onClick: () => setDetailId(a.id),
      },
      {
        id: "copy-event",
        label: isCopied(`ev-${a.id}`) ? "Copied" : "Copy event key",
        icon: copyIcon(`ev-${a.id}`),
        onClick: () => copyText(a.event || "", `ev-${a.id}`),
      },
      {
        id: "copy-msg",
        label: isCopied(`msg-${a.id}`) ? "Copied" : "Copy message",
        icon: copyIcon(`msg-${a.id}`),
        onClick: () => copyText(a.message || "", `msg-${a.id}`),
      },
      {
        id: "copy-id",
        label: isCopied(`id-${a.id}`) ? "Copied" : "Copy ID",
        icon: copyIcon(`id-${a.id}`),
        onClick: () => copyText(a.id || "", `id-${a.id}`),
      },
    ];
  }

  const liveLabel =
    rtState === "live"
      ? "Always live"
      : rtState === "error"
        ? "Stream error — auto-retrying"
        : "Connecting stream…";

  return (
    <>
      <PageHead
        title="Audit log"
        copy="Permanent, always-on security trail. Every platform action is recorded automatically and cannot be turned off from this console."
        actions={
          <>
            <span
              className={`audit-live-pill is-permanent ${rtState === "live" ? "is-live" : rtState === "error" ? "is-bad" : ""}`}
              title={
                lastLiveAt
                  ? `Always live · last event ${fmtTime(lastLiveAt)}`
                  : "Always live — recording cannot be paused or disabled"
              }
            >
              <span className="audit-live-dot" />
              {liveLabel}
              {liveFlash > 0 ? <small>+{liveFlash}</small> : null}
            </span>
            <button className="btn" type="button" onClick={() => exportAll("csv")} disabled={!filtered.length}>
              <Download size={15} /> Export CSV
            </button>
            <button className="btn" type="button" onClick={() => exportAll("json")} disabled={!filtered.length}>
              Export JSON
            </button>
            <button className="btn" type="button" onClick={load} disabled={loading}>
              <RefreshCw size={15} /> Refresh
            </button>
          </>
        }
      />
      {msg ? <Banner tone="ok">{msg}</Banner> : null}
      {err ? <Banner tone="bad">{err}</Banner> : null}

      <div className="sup-policy-banner" role="note">
        <Shield size={18} />
        <div>
          <b>Always on · append-only</b>
          <span>
            The audit trail stays live permanently — there is no pause or off switch. Sign-ins, failed logins,
            role grants, keys, domains, messages, suppressions, matrix changes, and session events are written by
            the platform as they happen. Operators can only review and export; nothing is edited or deleted here.
          </span>
        </div>
      </div>

      <StatGrid
        items={[
          {
            label: "Events in trail",
            value: fmtNum(total ?? rows.length),
            hint: `${fmtNum(filtered.length)} match filters`,
            tone: "blue",
            icon: <Activity size={16} />,
          },
          {
            label: "Info",
            value: fmtNum(stats.info),
            hint: "Routine operations",
            tone: "purple",
          },
          {
            label: "Warnings",
            value: fmtNum(stats.warn),
            hint: `${fmtNum(stats.error)} error${stats.error === 1 ? "" : "s"}`,
            tone: "amber",
          },
          {
            label: "Last hour",
            value: fmtNum(stats.lastHour),
            hint: "Always recording",
            tone: "green",
          },
        ]}
      />

      <Panel
        title="Event stream"
        copy={
          loading
            ? "Loading…"
            : `${fmtNum(filtered.length)} of ${fmtNum(total ?? rows.length)} events · always live · newest first · up to 20 per page`
        }
      >
        <div className="ws-table-toolbar">
          <div className="tables-search-wrap wide">
            <Search size={14} className="tables-search-ico" />
            <input
              className="tables-search"
              placeholder="Search event, message, workspace, meta, ID…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="ws-chip-row">
            {["all", ...AUDIT_LEVELS].map((l) => (
              <button
                key={l}
                type="button"
                className={`ws-chip ${level === l ? "active" : ""}`}
                onClick={() => setLevel(l)}
              >
                {l === "all" ? "all levels" : l}
              </button>
            ))}
          </div>
          <div className="ws-chip-row">
            <button
              type="button"
              className={`ws-chip ${category === "all" ? "active" : ""}`}
              onClick={() => setCategory("all")}
            >
              all categories
            </button>
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                className={`ws-chip ${category === c ? "active" : ""}`}
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>
          <AppSelect
            size="sm"
            className="ws-filter-select"
            value={wsFilter}
            onChange={setWsFilter}
            options={[
              { value: "all", label: "All scopes" },
              { value: "platform", label: "Platform-only (no workspace)" },
              ...(workspaces.rows || []).map((w) => ({
                value: w.id,
                label: w.name || w.id,
              })),
            ]}
            aria-label="Filter by workspace"
          />
        </div>

        {!loading && filtered.length === 0 ? (
          <div className="empty">
            <b>{rows.length ? "No events match" : "No audit events yet"}</b>
            {rows.length
              ? "Try another search or filter."
              : "Sign-ins, grants, key actions, and compliance changes will stream here automatically."}
          </div>
        ) : (
          <div className="paged-table-stack">
            <TableShell rowCount={pager.pageRows.length}>
              <table className="data ws-table audit-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Time</th>
                    <th>Level</th>
                    <th>Category</th>
                    <th>Event</th>
                    <th>Message</th>
                    <th>Workspace</th>
                    <th className="col-actions" />
                  </tr>
                </thead>
                <tbody>
                  {pager.pageRows.map((a) => {
                    const cat = auditCategoryOf(a);
                    const iso = fmtIso(a.created_at);
                    return (
                      <tr
                        key={a.id}
                        className={`clickable ws-table-row ${detailId === a.id ? "active" : ""}`}
                        onClick={() => setDetailId(a.id)}
                      >
                        <td className="audit-date" title={iso}>
                          <span className="audit-date-main">{fmtDate(a.created_at)}</span>
                        </td>
                        <td className="audit-time mono" title={iso}>
                          {fmtClock(a.created_at)}
                        </td>
                        <td>
                          <span className={`tag ${auditLevelTone(a.level)}`}>{auditLevelLabel(a.level)}</span>
                        </td>
                        <td>
                          <span className="audit-cat-pill">{cat}</span>
                        </td>
                        <td>
                          <code className="mono audit-event-key">{a.event}</code>
                        </td>
                        <td>
                          <span className="audit-msg" title={a.message || ""}>
                            {a.message || "—"}
                          </span>
                        </td>
                        <td>
                          <span className="dom-ws-name">{a.workspace_name || (a.workspace_id ? "—" : "Platform")}</span>
                        </td>
                        <td className="col-actions" onClick={(e) => e.stopPropagation()}>
                          <RowMenu items={menuFor(a)} label={`Actions for ${a.event}`} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableShell>
            <TablePager
              page={pager.page}
              pageCount={pager.pageCount}
              total={pager.total}
              from={pager.from}
              to={pager.to}
              pageNumbers={pager.pageNumbers}
              middlePage={pager.middlePage}
              onPageChange={pager.setPage}
              onFirst={pager.goFirst}
              onMiddle={pager.goMiddle}
              onLast={pager.goLast}
              onPrev={pager.goPrev}
              onNext={pager.goNext}
            />
          </div>
        )}
      </Panel>

      {detail ? (
        <Modal title="Audit event" wide onClose={() => setDetailId(null)}>
          <div className="audit-detail-modal">
            <header className="keys-detail-hero">
              <div className="keys-detail-hero-main">
                <span className={`audit-detail-badge level-${String(detail.level || "info").toLowerCase()}`}>
                  <Activity size={22} />
                </span>
                <div>
                  <h3 className="keys-detail-title mono">{detail.event}</h3>
                  <p className="keys-detail-sub audit-detail-when">
                    <span>{fmtDate(detail.created_at)}</span>
                    <span className="audit-detail-when-sep">·</span>
                    <span className="mono">{fmtClock(detail.created_at)}</span>
                  </p>
                  <div className="keys-detail-tags">
                    <span className={`tag ${auditLevelTone(detail.level)}`}>{auditLevelLabel(detail.level)}</span>
                    <span className="tag">{auditCategoryOf(detail)}</span>
                    <span className="tag">Append-only</span>
                  </div>
                </div>
              </div>
              <div className="keys-detail-hero-actions">
                <CopyButton text={detail.event || ""} label="Copy event" />
                <CopyButton text={detail.message || ""} label="Copy message" />
              </div>
            </header>

            <article className="audit-message-block">
              <h4>Message</h4>
              <p>{detail.message || "—"}</p>
            </article>

            <div className="keys-detail-grid">
              <div className="keys-detail-card">
                <small>Date</small>
                <b>{fmtDate(detail.created_at)}</b>
              </div>
              <div className="keys-detail-card">
                <small>Time</small>
                <b className="mono">{fmtClock(detail.created_at)}</b>
              </div>
              <div className="keys-detail-card">
                <small>Registered (UTC)</small>
                <b className="mono audit-iso" title={fmtIso(detail.created_at)}>
                  {fmtIso(detail.created_at)}
                </b>
                <CopyButton text={fmtIso(detail.created_at)} label="Copy ISO" className="btn sm" />
              </div>
              <div className="keys-detail-card">
                <small>Level</small>
                <b>
                  <span className={`tag ${auditLevelTone(detail.level)}`}>{auditLevelLabel(detail.level)}</span>
                </b>
              </div>
              <div className="keys-detail-card">
                <small>Category</small>
                <b>{auditCategoryOf(detail)}</b>
              </div>
              <div className="keys-detail-card">
                <small>Workspace</small>
                <b>{detail.workspace_name || (detail.workspace_id ? detail.workspace_id : "Platform")}</b>
                {detail.owner_email ? <span className="muted-sm">{detail.owner_email}</span> : null}
              </div>
            </div>

            <article className="audit-meta-block">
              <div className="audit-meta-head">
                <h4>Meta</h4>
                <CopyButton
                  getText={() => JSON.stringify(detail.meta || {}, null, 2)}
                  label="Copy meta"
                />
              </div>
              <pre className="audit-meta-pre mono">
                {JSON.stringify(detail.meta && Object.keys(detail.meta).length ? detail.meta : {}, null, 2)}
              </pre>
            </article>

            <div className="sup-detail-id mono muted-sm">
              ID {detail.id}{" "}
              <CopyButton text={detail.id || ""} label="Copy" showLabel className="btn sm" />
            </div>
            <div className="grant-actions" style={{ marginTop: 14 }}>
              <button type="button" className="btn" onClick={() => setDetailId(null)}>
                Close
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

const RIGHTS_TYPES = [
  "access",
  "erasure",
  "portability",
  "rectification",
  "objection",
  "restriction",
  "withdraw_consent",
];
const RIGHTS_STATUSES = ["recorded", "in_progress", "completed", "rejected", "cancelled"];

function rightsTypeLabel(type) {
  const t = String(type || "").toLowerCase();
  const map = {
    access: "Access",
    erasure: "Erasure / delete",
    portability: "Portability",
    rectification: "Rectification",
    objection: "Objection",
    restriction: "Restriction",
    withdraw_consent: "Withdraw consent",
  };
  return map[t] || (t ? t.replace(/_/g, " ") : "—");
}

function rightsStatusTone(status) {
  const s = String(status || "").toLowerCase();
  if (s === "completed") return "ok";
  if (s === "in_progress") return "warn";
  if (s === "rejected" || s === "cancelled") return "bad";
  return "slate";
}

function rightsStatusLabel(status) {
  const s = String(status || "recorded").toLowerCase();
  if (s === "in_progress") return "In progress";
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "—";
}

function rightsDetailDescription(r) {
  if (!r) return "";
  if (r.description) return String(r.description).trim();
  const d = r.detail;
  if (!d) return "";
  if (typeof d === "string") return d;
  return String(d.description || d.note || d.message || "").trim();
}

function rightsStatusHistory(r) {
  if (Array.isArray(r?.status_history) && r.status_history.length) return r.status_history;
  const d = r?.detail;
  if (d && typeof d === "object" && Array.isArray(d.statusHistory)) return d.statusHistory;
  return [];
}

function rightsIsOpen(status) {
  const s = String(status || "").toLowerCase();
  return s === "recorded" || s === "in_progress";
}

export function RightsPage({ token, events = [], onChanged }) {
  const confirm = useAppConfirm();
  const { rows, total, err, loading, load } = useEntity(token, "/api/rights?limit=200");
  const workspaces = useEntity(token, "/api/workspaces");
  const { copy: copyText, isCopied, copyIcon } = useCopyFeedback();

  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [wsFilter, setWsFilter] = useState("all");
  const [dueFilter, setDueFilter] = useState("all"); // all | open | overdue
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    type: "access",
    requesterEmail: "",
    requesterName: "",
    subjectEmail: "",
    workspaceId: "",
    description: "",
    note: "",
    dueAt: "",
  });

  const [detailId, setDetailId] = useState(null);
  const [detailTab, setDetailTab] = useState("overview"); // overview | activity | edit
  const [editNote, setEditNote] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editDueAt, setEditDueAt] = useState("");

  const lastRt = useRef("");
  useEffect(() => {
    if (!events?.length) return;
    const ev = events[0];
    if (ev?.type !== "rights") return;
    const sig = `${ev.event}:${ev.id || ""}:${ev.status || ""}:${ev.at || ""}`;
    if (sig === lastRt.current) return;
    lastRt.current = sig;
    load();
    onChanged?.();
  }, [events, load, onChanged]);

  // Soft refresh so open tickets never go stale if an SSE tick is missed
  useEffect(() => {
    if (!token) return undefined;
    const id = window.setInterval(() => load(), 15_000);
    return () => window.clearInterval(id);
  }, [token, load]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      const desc = rightsDetailDescription(r);
      const hay = `${r.type || ""} ${r.status || ""} ${r.requester_email || ""} ${r.requester_name || ""} ${r.subject_email || ""} ${r.note || ""} ${desc} ${r.workspace_name || ""} ${r.id || ""} ${r.channel || ""} ${r.source || ""}`.toLowerCase();
      if (needle && !hay.includes(needle)) return false;
      if (typeFilter !== "all" && String(r.type || "") !== typeFilter) return false;
      if (statusFilter !== "all" && String(r.status || "") !== statusFilter) return false;
      if (wsFilter !== "all" && String(r.workspace_id || "") !== wsFilter) return false;
      if (dueFilter === "open" && !rightsIsOpen(r.status)) return false;
      if (dueFilter === "overdue" && !r.overdue) return false;
      return true;
    });
  }, [rows, q, typeFilter, statusFilter, wsFilter, dueFilter]);

  const filterKey = `${q}|${typeFilter}|${statusFilter}|${wsFilter}|${dueFilter}`;
  const pager = useClientPager(filtered, { resetKey: filterKey });
  const bulk = useBulkSelection(pager.pageRows, { resetKey: filterKey });
  const detail = useMemo(() => rows.find((r) => String(r.id) === String(detailId)) || null, [rows, detailId]);

  useEffect(() => {
    if (!detail) return;
    setDetailTab("overview");
    setEditNote(detail.note || "");
    setEditDescription(rightsDetailDescription(detail));
    setEditDueAt(detail.due_at ? String(detail.due_at).slice(0, 10) : "");
  }, [detail?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    const open = rows.filter((r) => rightsIsOpen(r.status)).length;
    const inProgress = rows.filter((r) => r.status === "in_progress").length;
    const completed = rows.filter((r) => r.status === "completed").length;
    const overdue = rows.filter((r) => r.overdue).length;
    return { open, inProgress, completed, overdue };
  }, [rows]);

  const workspaceOptions = useMemo(() => {
    const list = (workspaces.rows || []).map((w) => ({ value: w.id, label: w.name || w.id }));
    return [{ value: "", label: "No workspace / platform" }, ...list];
  }, [workspaces.rows]);

  async function create(e) {
    e.preventDefault();
    if (!form.requesterEmail.trim() && !form.subjectEmail.trim()) {
      setMsg("Requester or data-subject email is required");
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      const body = {
        type: form.type,
        requesterEmail: form.requesterEmail.trim() || undefined,
        requesterName: form.requesterName.trim() || undefined,
        subjectEmail: form.subjectEmail.trim() || form.requesterEmail.trim() || undefined,
        note: form.note.trim() || undefined,
        description: form.description.trim() || undefined,
        source: "database-studio",
        channel: "studio",
      };
      if (form.workspaceId) body.workspaceId = form.workspaceId;
      if (form.dueAt) body.dueAt = `${form.dueAt}T23:59:59.000Z`;
      const data = await api("/api/rights", { method: "POST", token, body });
      setMsg(`Recorded ${rightsTypeLabel(form.type)} request`);
      setCreateOpen(false);
      setForm({
        type: "access",
        requesterEmail: "",
        requesterName: "",
        subjectEmail: "",
        workspaceId: "",
        description: "",
        note: "",
        dueAt: "",
      });
      await load();
      onChanged?.();
      if (data.request?.id) setDetailId(data.request.id);
    } catch (ex) {
      setMsg(redact(ex.message));
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(r, status) {
    const ok = await confirm({
      title: `${rightsStatusLabel(status)} request`,
      message: `Set this ${rightsTypeLabel(r.type)} request for ${r.subject_email || r.requester_email || "subject"} to “${rightsStatusLabel(status)}”?`,
      confirmLabel: rightsStatusLabel(status),
      danger: status === "rejected" || status === "cancelled",
    });
    if (!ok) return;
    setBusy(true);
    setMsg("");
    try {
      await api(`/api/rights/${r.id}`, { method: "PATCH", token, body: { status } });
      setMsg(`${rightsTypeLabel(r.type)} → ${rightsStatusLabel(status)}`);
      await load();
      onChanged?.();
    } catch (ex) {
      setMsg(redact(ex.message));
    } finally {
      setBusy(false);
    }
  }

  async function saveDetail(e) {
    e?.preventDefault?.();
    if (!detail) return;
    setBusy(true);
    setMsg("");
    try {
      const body = {
        note: editNote,
        description: editDescription,
      };
      if (editDueAt) body.dueAt = `${editDueAt}T23:59:59.000Z`;
      await api(`/api/rights/${detail.id}`, { method: "PATCH", token, body });
      setMsg("Request details saved");
      await load();
      onChanged?.();
      setDetailTab("overview");
    } catch (ex) {
      setMsg(redact(ex.message));
    } finally {
      setBusy(false);
    }
  }

  async function remove(r) {
    const ok = await confirm({
      title: "Delete rights request",
      message: `Permanently delete this ${rightsTypeLabel(r.type)} record? Prefer marking cancelled when you need an audit trail.`,
      danger: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    setBusy(true);
    setMsg("");
    try {
      await api(`/api/rights/${r.id}`, { method: "DELETE", token });
      setMsg("Request deleted");
      if (detailId && String(detailId) === String(r.id)) setDetailId(null);
      await load();
      onChanged?.();
    } catch (ex) {
      setMsg(redact(ex.message));
    } finally {
      setBusy(false);
    }
  }

  async function bulkSetStatus(status) {
    if (!bulk.count) return;
    const ids = [...bulk.selectedIds];
    const ok = await confirm({
      title: `Bulk: ${rightsStatusLabel(status)}`,
      message: `Set ${ids.length} selected request${ids.length === 1 ? "" : "s"} to “${rightsStatusLabel(status)}”?`,
      confirmLabel: rightsStatusLabel(status),
      danger: status === "rejected" || status === "cancelled",
    });
    if (!ok) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await runBulk(ids, (id) =>
        api(`/api/rights/${id}`, { method: "PATCH", token, body: { status } })
      );
      setMsg(res.fail ? `Updated ${res.ok}, failed ${res.fail}` : `Updated ${res.ok} request${res.ok === 1 ? "" : "s"}`);
      bulk.clear();
      await load();
      onChanged?.();
    } catch (ex) {
      setMsg(redact(ex.message));
    } finally {
      setBusy(false);
    }
  }

  function exportList(list, filename) {
    const cols = [
      "id",
      "type",
      "status",
      "requester_email",
      "requester_name",
      "subject_email",
      "workspace_name",
      "note",
      "description",
      "due_at",
      "overdue",
      "created_at",
      "updated_at",
      "resolved_at",
      "resolved_by",
      "source",
      "channel",
    ];
    const lines = [cols.join(",")];
    for (const r of list) {
      const row = {
        ...r,
        description: rightsDetailDescription(r),
        overdue: r.overdue ? "yes" : "no",
      };
      lines.push(cols.map((c) => `"${String(row[c] ?? "").replace(/"/g, '""')}"`).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function exportCsv() {
    if (!filtered.length) return;
    exportList(filtered, `senditto-rights-${Date.now()}.csv`);
    setMsg(`Exported ${filtered.length} request${filtered.length === 1 ? "" : "s"}`);
  }

  function exportSelectedCsv() {
    const set = new Set(bulk.selectedIds.map(String));
    const list = filtered.filter((r) => set.has(String(r.id)));
    if (!list.length) return;
    exportList(list, `senditto-rights-selected-${Date.now()}.csv`);
    setMsg(`Exported ${list.length} selected request${list.length === 1 ? "" : "s"}`);
  }

  function menuFor(r) {
    const st = String(r.status || "");
    return [
      {
        id: "open",
        label: "Open details",
        icon: <Shield size={15} />,
        onClick: () => setDetailId(r.id),
      },
      r.subject_email || r.requester_email
        ? {
            id: "copy-email",
            label: isCopied(`em-${r.id}`) ? "Copied" : "Copy subject email",
            icon: copyIcon(`em-${r.id}`),
            onClick: () => copyText(r.subject_email || r.requester_email || "", `em-${r.id}`),
          }
        : null,
      {
        id: "copy-id",
        label: isCopied(`id-${r.id}`) ? "Copied" : "Copy ID",
        icon: copyIcon(`id-${r.id}`),
        onClick: () => copyText(r.id, `id-${r.id}`),
      },
      st !== "in_progress"
        ? {
            id: "progress",
            label: "Mark in progress",
            icon: <Play size={15} />,
            onClick: () => setStatus(r, "in_progress"),
          }
        : null,
      st !== "recorded" && !rightsIsOpen(st)
        ? {
            id: "reopen",
            label: "Re-open (recorded)",
            icon: <RefreshCw size={15} />,
            onClick: () => setStatus(r, "recorded"),
          }
        : null,
      st !== "completed"
        ? {
            id: "complete",
            label: "Mark completed",
            icon: <Check size={15} />,
            onClick: () => setStatus(r, "completed"),
          }
        : null,
      st !== "rejected"
        ? {
            id: "reject",
            label: "Reject…",
            icon: <Ban size={15} />,
            danger: true,
            onClick: () => setStatus(r, "rejected"),
          }
        : null,
      st !== "cancelled"
        ? {
            id: "cancel",
            label: "Cancel…",
            icon: <X size={15} />,
            danger: true,
            onClick: () => setStatus(r, "cancelled"),
          }
        : null,
      {
        id: "delete",
        label: "Delete record…",
        icon: <X size={15} />,
        danger: true,
        onClick: () => remove(r),
      },
    ].filter(Boolean);
  }

  return (
    <>
      <PageHead
        title="Rights requests"
        copy="Privacy & data-subject requests — access, erasure, portability, rectification, objection, and related tickets. Track SLA, activity history, and outcomes with a full audit trail."
        actions={
          <>
            <button className="btn" type="button" onClick={() => setGuideOpen(true)}>
              <BookOpen size={15} /> Guide
            </button>
            <button className="btn" type="button" onClick={exportCsv} disabled={!filtered.length}>
              <Download size={15} /> Export CSV
            </button>
            <button className="btn" type="button" onClick={load} disabled={loading || busy}>
              <RefreshCw size={15} /> Refresh
            </button>
            <button className="btn primary" type="button" onClick={() => setCreateOpen(true)}>
              <Shield size={15} /> Record request
            </button>
          </>
        }
      />
      {msg ? (
        <Banner tone={/fail|error|invalid|cannot|forbidden|required/i.test(msg) ? "bad" : "ok"}>{msg}</Banner>
      ) : null}
      {err ? <Banner tone="bad">{err}</Banner> : null}

      <div className="sup-policy-banner" role="note">
        <ShieldCheck size={18} />
        <div>
          <b>Compliance queue · 30-day SLA by default</b>
          <span>
            Record requests as they arrive. Work them with status transitions (each change is audited and listed in
            activity history). Prefer completed / rejected / cancelled over hard-delete. Overdue open tickets are
            flagged automatically.
          </span>
        </div>
      </div>

      <StatGrid
        items={[
          {
            label: "Open",
            value: fmtNum(stats.open),
            hint: `${fmtNum(stats.inProgress)} in progress`,
            tone: "amber",
            icon: <Shield size={16} />,
          },
          {
            label: "Total",
            value: fmtNum(total ?? rows.length),
            hint: `${fmtNum(filtered.length)} shown`,
            tone: "blue",
          },
          {
            label: "Completed",
            value: fmtNum(stats.completed),
            hint: "Closed successfully",
            tone: "green",
          },
          {
            label: "Overdue",
            value: fmtNum(stats.overdue),
            hint: "Open past due date",
            tone: "red",
          },
        ]}
      />

      <Panel
        title="Request inventory"
        copy={
          loading
            ? "Loading…"
            : `${fmtNum(filtered.length)} of ${fmtNum(total ?? rows.length)} requests · realtime · auto-refresh`
        }
      >
        <div className="ws-table-toolbar">
          <div className="tables-search-wrap wide">
            <Search size={14} className="tables-search-ico" />
            <input
              className="tables-search"
              placeholder="Search email, type, note, workspace, ID…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="ws-chip-row">
            {["all", ...RIGHTS_STATUSES].map((s) => (
              <button
                key={s}
                type="button"
                className={`ws-chip ${statusFilter === s ? "active" : ""}`}
                onClick={() => setStatusFilter(s)}
              >
                {s === "all" ? "all status" : rightsStatusLabel(s)}
              </button>
            ))}
          </div>
          <div className="ws-chip-row">
            {[
              { id: "all", label: "all due" },
              { id: "open", label: "open only" },
              { id: "overdue", label: "overdue" },
            ].map((d) => (
              <button
                key={d.id}
                type="button"
                className={`ws-chip ${dueFilter === d.id ? "active" : ""}`}
                onClick={() => setDueFilter(d.id)}
              >
                {d.label}
              </button>
            ))}
          </div>
          <div className="ws-chip-row">
            {["all", ...RIGHTS_TYPES].map((t) => (
              <button
                key={t}
                type="button"
                className={`ws-chip ${typeFilter === t ? "active" : ""}`}
                onClick={() => setTypeFilter(t)}
              >
                {t === "all" ? "all types" : rightsTypeLabel(t)}
              </button>
            ))}
          </div>
          {(workspaces.rows || []).length > 0 ? (
            <AppSelect
              size="sm"
              className="ws-filter-select"
              value={wsFilter}
              onChange={setWsFilter}
              options={[
                { value: "all", label: "All workspaces" },
                ...(workspaces.rows || []).map((w) => ({ value: w.id, label: w.name || w.id })),
              ]}
              aria-label="Filter by workspace"
            />
          ) : null}
        </div>

        {!loading && filtered.length === 0 ? (
          <div className="empty">
            <b>{rows.length ? "No requests match" : "No rights requests yet"}</b>
            {rows.length
              ? "Try another search or filter."
              : "Record an access, erasure, or portability request when a data subject asks."}
            {!rows.length ? (
              <div style={{ marginTop: 12 }}>
                <button type="button" className="btn primary" onClick={() => setCreateOpen(true)}>
                  <Shield size={15} /> Record request
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="paged-table-stack">
            <BulkBar
              count={bulk.count}
              noun={bulk.count === 1 ? "request selected" : "requests selected"}
              pageCount={pager.pageRows.length}
              filteredCount={filtered.length}
              onClear={bulk.clear}
              onSelectPage={bulk.togglePage}
              onSelectAll={() => bulk.selectAll(filtered)}
              allPageSelected={bulk.allPageSelected}
              emptyHint="Select requests for bulk status updates or export."
            >
              <button type="button" className="btn sm" disabled={busy || !bulk.count} onClick={() => bulkSetStatus("in_progress")}>
                In progress
              </button>
              <button type="button" className="btn sm" disabled={busy || !bulk.count} onClick={() => bulkSetStatus("completed")}>
                Complete
              </button>
              <button type="button" className="btn sm danger" disabled={busy || !bulk.count} onClick={() => bulkSetStatus("rejected")}>
                Reject
              </button>
              <button type="button" className="btn sm danger" disabled={busy || !bulk.count} onClick={() => bulkSetStatus("cancelled")}>
                Cancel
              </button>
              <button type="button" className="btn sm" disabled={busy || !bulk.count} onClick={exportSelectedCsv}>
                <Download size={14} /> Export
              </button>
            </BulkBar>
            <TableShell rowCount={pager.pageRows.length}>
              <table className="data ws-table rights-table">
                <thead>
                  <tr>
                    <BulkSelectHeader
                      checked={bulk.allPageSelected}
                      indeterminate={bulk.somePageSelected && !bulk.allPageSelected}
                      onChange={bulk.togglePage}
                    />
                    <th>Date</th>
                    <th>Time</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Subject</th>
                    <th>Due</th>
                    <th>Workspace</th>
                    <th className="col-actions" />
                  </tr>
                </thead>
                <tbody>
                  {pager.pageRows.map((r) => {
                    const desc = rightsDetailDescription(r);
                    return (
                      <tr
                        key={r.id}
                        className={`clickable ws-table-row ${detailId === r.id ? "active" : ""} ${bulk.isSelected(r.id) ? "bulk-selected" : ""} ${r.overdue ? "rights-row-overdue" : ""}`}
                        onClick={() => setDetailId(r.id)}
                      >
                        <BulkSelectCell
                          checked={bulk.isSelected(r.id)}
                          onChange={() => bulk.toggle(r.id)}
                          label={`Select ${r.type}`}
                        />
                        <td className="audit-date" title={fmtIso(r.created_at)}>
                          <span className="audit-date-main">{fmtDate(r.created_at)}</span>
                        </td>
                        <td className="audit-time mono" title={fmtIso(r.created_at)}>
                          {fmtClock(r.created_at)}
                        </td>
                        <td>
                          <span className="rights-type-pill">{rightsTypeLabel(r.type)}</span>
                        </td>
                        <td>
                          <span className={`tag ${rightsStatusTone(r.status)}`}>{rightsStatusLabel(r.status)}</span>
                        </td>
                        <td>
                          <div className="rights-req-cell">
                            <b className="mono" title={r.subject_email || ""}>
                              {r.subject_email || r.requester_email || "—"}
                            </b>
                            {desc ? (
                              <small className="rights-desc-snip" title={desc}>
                                {desc.length > 48 ? `${desc.slice(0, 48)}…` : desc}
                              </small>
                            ) : r.requester_name ? (
                              <small>{r.requester_name}</small>
                            ) : null}
                          </div>
                        </td>
                        <td>
                          {r.due_at ? (
                            <span className={`rights-due ${r.overdue ? "is-overdue" : ""}`} title={fmtIso(r.due_at)}>
                              {fmtDate(r.due_at)}
                              {r.overdue ? <small>Overdue</small> : null}
                            </span>
                          ) : (
                            <span className="muted-sm">—</span>
                          )}
                        </td>
                        <td>
                          <span className="dom-ws-name">{r.workspace_name || "Platform"}</span>
                        </td>
                        <td className="col-actions" onClick={(e) => e.stopPropagation()}>
                          <RowMenu items={menuFor(r)} label={`Actions for ${r.type}`} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableShell>
            <TablePager
              page={pager.page}
              pageCount={pager.pageCount}
              total={pager.total}
              from={pager.from}
              to={pager.to}
              pageNumbers={pager.pageNumbers}
              middlePage={pager.middlePage}
              onPageChange={pager.setPage}
              onFirst={pager.goFirst}
              onMiddle={pager.goMiddle}
              onLast={pager.goLast}
              onPrev={pager.goPrev}
              onNext={pager.goNext}
            />
          </div>
        )}
      </Panel>

      {createOpen ? (
        <Modal title="Record rights request" wide onClose={() => !busy && setCreateOpen(false)}>
          <form className="form" onSubmit={create}>
            <p className="keys-create-intro">
              Opens a compliance ticket. A due date defaults to 30 days (typical response window). Every later
              status change is stored in activity history and the platform audit log.
            </p>
            <Field label="Request type" full>
              <AppSelect
                value={form.type}
                onChange={(type) => setForm((p) => ({ ...p, type }))}
                options={RIGHTS_TYPES.map((t) => ({ value: t, label: rightsTypeLabel(t) }))}
                aria-label="Type"
              />
            </Field>
            <Field label="Requester email" full>
              <input
                type="email"
                required={!form.subjectEmail.trim()}
                value={form.requesterEmail}
                onChange={(e) => setForm((p) => ({ ...p, requesterEmail: e.target.value }))}
                placeholder="person@example.com"
                disabled={busy}
              />
            </Field>
            <Field label="Requester name" full>
              <input
                value={form.requesterName}
                onChange={(e) => setForm((p) => ({ ...p, requesterName: e.target.value }))}
                placeholder="Optional display name"
                disabled={busy}
              />
            </Field>
            <Field label="Data subject email" full>
              <input
                type="email"
                required={!form.requesterEmail.trim()}
                value={form.subjectEmail}
                onChange={(e) => setForm((p) => ({ ...p, subjectEmail: e.target.value }))}
                placeholder="Defaults to requester if empty"
                disabled={busy}
              />
            </Field>
            <Field label="Due date (optional)" full>
              <input
                type="date"
                value={form.dueAt}
                onChange={(e) => setForm((p) => ({ ...p, dueAt: e.target.value }))}
                disabled={busy}
              />
              <span className="muted-sm" style={{ display: "block", marginTop: 4 }}>
                Leave empty for automatic +30 days from today.
              </span>
            </Field>
            <Field label="Workspace (optional)" full>
              <AppSelect
                value={form.workspaceId}
                onChange={(workspaceId) => setForm((p) => ({ ...p, workspaceId }))}
                options={workspaceOptions}
                aria-label="Workspace"
              />
            </Field>
            <Field label="Description" full>
              <textarea
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                rows={3}
                placeholder="What did the subject ask for?"
                disabled={busy}
              />
            </Field>
            <Field label="Operator note" full>
              <textarea
                value={form.note}
                onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))}
                rows={2}
                placeholder="Internal note (ticket ID, channel, …)"
                disabled={busy}
              />
            </Field>
            <div className="full" style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="btn" disabled={busy} onClick={() => setCreateOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="btn primary" disabled={busy}>
                {busy ? "Saving…" : "Record request"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {detail ? (
        <Modal title="Rights request" wide onClose={() => !busy && setDetailId(null)}>
          <div className="rights-detail-modal">
            <header className="keys-detail-hero">
              <div className="keys-detail-hero-main">
                <span className={`rights-detail-badge status-${String(detail.status || "recorded")}`}>
                  <Shield size={22} />
                </span>
                <div>
                  <h3 className="keys-detail-title">{rightsTypeLabel(detail.type)}</h3>
                  <p className="keys-detail-sub mono">
                    {detail.subject_email || detail.requester_email || "No email on file"}
                  </p>
                  <div className="keys-detail-tags">
                    <span className={`tag ${rightsStatusTone(detail.status)}`}>
                      {rightsStatusLabel(detail.status)}
                    </span>
                    <span className="tag">{rightsTypeLabel(detail.type)}</span>
                    {detail.overdue ? <span className="tag bad">Overdue</span> : null}
                  </div>
                </div>
              </div>
              <div className="keys-detail-hero-actions">
                <CopyButton text={detail.subject_email || detail.requester_email || ""} label="Copy email" />
                {detail.status !== "in_progress" ? (
                  <button type="button" className="btn sm" disabled={busy} onClick={() => setStatus(detail, "in_progress")}>
                    In progress
                  </button>
                ) : null}
                {detail.status !== "completed" ? (
                  <button type="button" className="btn sm primary" disabled={busy} onClick={() => setStatus(detail, "completed")}>
                    <Check size={14} /> Complete
                  </button>
                ) : null}
              </div>
            </header>

            <div className="keys-detail-tabs" role="tablist">
              {[
                { id: "overview", label: "Overview" },
                { id: "activity", label: "Activity" },
                { id: "edit", label: "Notes & due" },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  className={`keys-detail-tab ${detailTab === t.id ? "active" : ""}`}
                  aria-selected={detailTab === t.id}
                  onClick={() => setDetailTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {detailTab === "overview" ? (
              <div className="sup-detail-body">
                <div className="keys-detail-grid">
                  <div className="keys-detail-card">
                    <small>Date recorded</small>
                    <b>{fmtDate(detail.created_at)}</b>
                    <span className="muted-sm mono">{fmtClock(detail.created_at)}</span>
                  </div>
                  <div className="keys-detail-card">
                    <small>Due</small>
                    <b className={detail.overdue ? "rights-overdue-text" : ""}>
                      {detail.due_at ? fmtDate(detail.due_at) : "—"}
                    </b>
                    {detail.overdue ? <span className="muted-sm">Past due</span> : null}
                  </div>
                  <div className="keys-detail-card">
                    <small>Subject</small>
                    <b className="mono">{detail.subject_email || "—"}</b>
                  </div>
                  <div className="keys-detail-card">
                    <small>Requester</small>
                    <b>{detail.requester_name || "—"}</b>
                    {detail.requester_email ? <span className="muted-sm mono">{detail.requester_email}</span> : null}
                  </div>
                  <div className="keys-detail-card">
                    <small>Workspace</small>
                    <b>{detail.workspace_name || "Platform"}</b>
                  </div>
                  <div className="keys-detail-card">
                    <small>Source / channel</small>
                    <b>
                      {detail.source || "—"}
                      {detail.channel ? ` · ${detail.channel}` : ""}
                    </b>
                    {detail.recorded_by ? <span className="muted-sm">By {detail.recorded_by}</span> : null}
                  </div>
                  <div className="keys-detail-card">
                    <small>Resolved</small>
                    <b>
                      {detail.resolved_at
                        ? `${fmtDate(detail.resolved_at)} ${fmtClock(detail.resolved_at)}`
                        : "—"}
                    </b>
                    {detail.resolved_by ? <span className="muted-sm">{detail.resolved_by}</span> : null}
                  </div>
                  <div className="keys-detail-card">
                    <small>Last updated</small>
                    <b>
                      {detail.updated_at
                        ? `${fmtDate(detail.updated_at)} ${fmtClock(detail.updated_at)}`
                        : "—"}
                    </b>
                  </div>
                </div>
                {rightsDetailDescription(detail) ? (
                  <article className="sup-user-note-block">
                    <h4>Description</h4>
                    <p style={{ fontStyle: "normal" }}>{rightsDetailDescription(detail)}</p>
                  </article>
                ) : null}
                {detail.note ? (
                  <article className="sup-note-block">
                    <h4>Operator note</h4>
                    <p>{detail.note}</p>
                  </article>
                ) : null}
                <div className="sup-detail-id mono muted-sm">
                  ID {detail.id}{" "}
                  <CopyButton text={detail.id || ""} label="Copy" showLabel className="btn sm" />
                </div>
                <div className="grant-actions" style={{ marginTop: 14, flexWrap: "wrap" }}>
                  <button type="button" className="btn" onClick={() => setDetailTab("edit")}>
                    Edit notes & due
                  </button>
                  {!rightsIsOpen(detail.status) ? (
                    <button type="button" className="btn" disabled={busy} onClick={() => setStatus(detail, "recorded")}>
                      Re-open
                    </button>
                  ) : null}
                  {detail.status !== "rejected" ? (
                    <button type="button" className="btn danger" disabled={busy} onClick={() => setStatus(detail, "rejected")}>
                      Reject
                    </button>
                  ) : null}
                  {detail.status !== "cancelled" ? (
                    <button type="button" className="btn danger" disabled={busy} onClick={() => setStatus(detail, "cancelled")}>
                      Cancel
                    </button>
                  ) : null}
                  <button type="button" className="btn" onClick={() => setDetailId(null)}>
                    Close
                  </button>
                </div>
              </div>
            ) : null}

            {detailTab === "activity" ? (
              <div className="rights-activity" style={{ marginTop: 12 }}>
                <p className="muted-sm" style={{ marginBottom: 10 }}>
                  Status transitions for this ticket (also written to the platform audit log).
                </p>
                {rightsStatusHistory(detail).length === 0 ? (
                  <div className="empty">
                    <b>No activity yet</b>
                    Status changes will appear here.
                  </div>
                ) : (
                  <ol className="rights-timeline">
                    {[...rightsStatusHistory(detail)].reverse().map((h, i) => (
                      <li key={`${h.at || i}-${h.to || ""}`}>
                        <div className="rights-timeline-dot" />
                        <div className="rights-timeline-body">
                          <b>
                            {h.from ? `${rightsStatusLabel(h.from)} → ` : ""}
                            {rightsStatusLabel(h.to || h.status)}
                          </b>
                          <span className="muted-sm">
                            {h.at ? `${fmtDate(h.at)} ${fmtClock(h.at)}` : ""}
                            {h.by ? ` · ${h.by}` : ""}
                          </span>
                          {h.note ? <p>{h.note}</p> : null}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
                <div className="grant-actions" style={{ marginTop: 14 }}>
                  <button type="button" className="btn" onClick={() => setDetailTab("overview")}>
                    Back
                  </button>
                </div>
              </div>
            ) : null}

            {detailTab === "edit" ? (
              <form className="form" onSubmit={saveDetail} style={{ marginTop: 12 }}>
                <Field label="Description" full>
                  <textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    rows={4}
                    disabled={busy}
                  />
                </Field>
                <Field label="Operator note" full>
                  <textarea value={editNote} onChange={(e) => setEditNote(e.target.value)} rows={4} disabled={busy} />
                </Field>
                <Field label="Due date" full>
                  <input type="date" value={editDueAt} onChange={(e) => setEditDueAt(e.target.value)} disabled={busy} />
                </Field>
                <div className="full" style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button type="button" className="btn" disabled={busy} onClick={() => setDetailTab("overview")}>
                    Cancel
                  </button>
                  <button type="submit" className="btn primary" disabled={busy}>
                    {busy ? "Saving…" : "Save"}
                  </button>
                </div>
              </form>
            ) : null}
          </div>
        </Modal>
      ) : null}

      {guideOpen ? (
        <Modal title="Rights requests guide" wide onClose={() => setGuideOpen(false)}>
          <div className="sup-guide-prose">
            <h3>What this queue is for</h3>
            <p>
              Data subjects can ask for access, erasure, portability, correction, objection, restriction, or
              withdrawal of consent. Record each ask here and process it with clear status changes.
            </p>
            <h3>SLA</h3>
            <p>
              New tickets default to a <b>30-day due date</b> (common response window). Overdue open tickets are
              highlighted. Adjust the due date in Notes when legal requires a different window.
            </p>
            <h3>Statuses</h3>
            <ul>
              <li>
                <b>Recorded</b> — received
              </li>
              <li>
                <b>In progress</b> — being handled
              </li>
              <li>
                <b>Completed</b> — fulfilled
              </li>
              <li>
                <b>Rejected</b> — denied with a lawful reason (document in notes)
              </li>
              <li>
                <b>Cancelled</b> — withdrawn or duplicate
              </li>
            </ul>
            <h3>Activity & audit</h3>
            <p>
              Every status change is stored on the ticket activity timeline and also written to the platform Audit
              log. Prefer cancel/complete over delete so history remains.
            </p>
            <div className="grant-actions" style={{ marginTop: 16 }}>
              <button type="button" className="btn primary" onClick={() => setGuideOpen(false)}>
                Got it
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

function fmtUptime(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  if (!s) return "—";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h || d) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}

/**
 * Server health — infrastructure only, using the same stats feed as Overview.
 * Fields come from /api/stats: server, postgres, tables, health, checkedAt.
 */
export function ServerPage({ overview, liveAt, rtState = "connecting", token, onRefresh }) {
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [latencyMs, setLatencyMs] = useState(null);

  const p = overview?.postgres || {};
  const server = overview?.server || {};
  const tables = overview?.tables || [];
  const health = overview?.health || {};
  const checkedAt = overview?.checkedAt || health.checkedAt || liveAt || null;

  const engineVersion = p.shortVersion
    ? `PostgreSQL ${String(p.shortVersion).split(" ")[0]}`
    : p.version
      ? redact(String(p.version).split(",")[0])
      : "—";

  const totalConns = p.activeConnections != null ? Number(p.activeConnections) : null;
  const activeQ = p.activeQueries != null ? Number(p.activeQueries) : null;
  const maxConns = p.maxConnections != null ? Number(p.maxConnections) : null;

  // Light latency check against /api/health (server reachability)
  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    async function tick() {
      try {
        const data = await api("/api/health", { token });
        if (!cancelled) setLatencyMs(data.latencyMs ?? null);
      } catch {
        if (!cancelled) setLatencyMs(null);
      }
    }
    tick();
    const id = window.setInterval(tick, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [token]);

  async function refresh() {
    setBusy(true);
    try {
      await onRefresh?.();
      try {
        const data = await api("/api/health", { token });
        setLatencyMs(data.latencyMs ?? null);
      } catch {
        setLatencyMs(null);
      }
    } finally {
      setBusy(false);
    }
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return tables;
    return tables.filter((t) => String(t.name || "").toLowerCase().includes(needle));
  }, [tables, q]);

  const pager = useClientPager(filtered, { resetKey: q });

  const healthy =
    overview?.ok !== false &&
    (health.status ? health.status === "healthy" : true) &&
    rtState !== "error";

  const largestForChart = useMemo(() => {
    const src = (overview?.charts?.tableSizes || tables || [])
      .map((t) => ({
        label: t.name || t.label,
        n: Number(t.bytes || t.n || 0),
      }))
      .filter((t) => t.label)
      .slice(0, 8);
    return src;
  }, [overview?.charts?.tableSizes, tables]);

  return (
    <>
      <PageHead
        title="Server health"
        copy="Database engine status for the Senditto product PostgreSQL instance."
        actions={
          <button className="btn" type="button" onClick={refresh} disabled={busy || !onRefresh}>
            <RefreshCw size={15} /> {busy ? "Refreshing…" : "Refresh"}
          </button>
        }
      />

      {checkedAt || liveAt ? (
        <Banner tone={healthy ? "ok" : "warn"}>
          {healthy ? "Database API healthy" : "Health check needs attention"}
          {" · "}
          Last check{" "}
          {checkedAt ? (
            <>
              {fmtDate(checkedAt)} <span className="mono">{fmtClock(checkedAt)}</span>
            </>
          ) : (
            "—"
          )}
          {latencyMs != null ? ` · API ${latencyMs} ms` : ""}
          {rtState === "live" ? " · Realtime live" : rtState === "error" ? " · Realtime down" : " · Realtime connecting"}
        </Banner>
      ) : null}

      <StatGrid
        items={[
          {
            label: "Database size",
            value: p.databaseSize || "—",
            hint: p.databaseBytes != null ? `${fmtNum(p.databaseBytes)} bytes` : "On-disk size",
            tone: "blue",
            icon: <HardDrive size={16} />,
          },
          {
            label: "Connections",
            value: totalConns != null ? fmtNum(totalConns) : "—",
            hint:
              maxConns != null
                ? `${fmtNum(activeQ)} active · max ${fmtNum(maxConns)}`
                : `${fmtNum(activeQ)} active queries`,
            tone: "green",
            icon: <Activity size={16} />,
          },
          {
            label: "Active queries",
            value: activeQ != null ? fmtNum(activeQ) : "—",
            hint:
              p.idleConnections != null
                ? `${fmtNum(p.idleConnections)} idle · ${fmtNum(p.waitingQueries)} waiting`
                : "Currently executing",
            tone: "amber",
          },
          {
            label: "Relations",
            value: fmtNum(tables.length),
            hint: "Public tables in this database",
            tone: "purple",
            icon: <Table2 size={16} />,
          },
        ]}
      />

      <div className="grid-2">
        <Panel title="Engine" copy="Identity of the product database server.">
          <div className="kv">
            <div>
              <span>Product label</span>
              <b>{server.name || "Senditto product"}</b>
            </div>
            <div>
              <span>Database</span>
              <b className="mono">{server.database || "senditto"}</b>
            </div>
            <div>
              <span>Role</span>
              <b className="mono">{server.user || "senditto"}</b>
            </div>
            <div>
              <span>Engine</span>
              <b title={p.version || ""}>{engineVersion}</b>
            </div>
            <div>
              <span>Timezone</span>
              <b className="mono">{p.timezone || "—"}</b>
            </div>
            <div>
              <span>Uptime</span>
              <b>
                {fmtUptime(p.uptimeSeconds)}
                {p.startedAt ? (
                  <span className="muted-sm" style={{ display: "block", fontWeight: 500 }}>
                    Started {fmtDate(p.startedAt)} {fmtClock(p.startedAt)}
                  </span>
                ) : null}
              </b>
            </div>
            <div>
              <span>Cache hit ratio</span>
              <b>{p.cacheHitRatio != null ? `${p.cacheHitRatio}%` : "—"}</b>
            </div>
            <div>
              <span>Last checked</span>
              <b>
                {checkedAt ? (
                  <>
                    {fmtDate(checkedAt)} <span className="mono">{fmtClock(checkedAt)}</span>
                  </>
                ) : (
                  "—"
                )}
              </b>
            </div>
          </div>
        </Panel>

        <Panel title="Largest tables" copy="By on-disk size (PostgreSQL relation size).">
          {largestForChart.length ? (
            <BarChart items={largestForChart} />
          ) : (
            <div className="empty">
              <b>No table stats yet</b>
              Refresh when the API is connected.
            </div>
          )}
        </Panel>
      </div>

      <Panel
        title="All relations"
        copy={
          tables.length
            ? `${fmtNum(filtered.length)} of ${fmtNum(tables.length)} public tables · approximate row counts from pg_stat`
            : "No relations reported"
        }
      >
        <div className="ws-table-toolbar">
          <div className="tables-search-wrap wide">
            <Search size={14} className="tables-search-ico" />
            <input
              className="tables-search"
              placeholder="Filter by table name…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
        {!tables.length ? (
          <div className="empty">
            <b>No relations</b>
            The stats feed has not returned table sizes yet.
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty">
            <b>No tables match</b>
            Try another filter.
          </div>
        ) : (
          <div className="paged-table-stack">
            <TableShell rowCount={pager.pageRows.length}>
              <table className="data ws-table">
                <thead>
                  <tr>
                    <th>Table</th>
                    <th>Approx. rows</th>
                    <th>Size</th>
                  </tr>
                </thead>
                <tbody>
                  {pager.pageRows.map((t) => (
                    <tr key={t.name}>
                      <td>
                        <code className="mono">{t.name}</code>
                      </td>
                      <td>{fmtNum(t.approx_rows)}</td>
                      <td>{t.size || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
            <TablePager
              page={pager.page}
              pageCount={pager.pageCount}
              total={pager.total}
              from={pager.from}
              to={pager.to}
              pageNumbers={pager.pageNumbers}
              middlePage={pager.middlePage}
              onPageChange={pager.setPage}
              onFirst={pager.goFirst}
              onMiddle={pager.goMiddle}
              onLast={pager.goLast}
              onPrev={pager.goPrev}
              onNext={pager.goNext}
            />
          </div>
        )}
      </Panel>
    </>
  );
}

export function SessionsPage({ token, session, rtState, onLogout, onNavigate }) {
  const confirm = useAppConfirm();
  const { rows, err, loading, load } = useEntity(token, "/api/sessions");
  const [tab, setTab] = useState("active"); // active | yours | settings

  async function revoke(s) {
    const ok = await confirm({
      title: "Revoke session",
      message: "Revoke this session? The user will need to sign in again.",
      danger: true,
      confirmLabel: "Revoke",
    });
    if (!ok) return;
    await api(`/api/sessions/${s.id}`, { method: "DELETE", token });
    await load();
  }

  const tabs = [
    { id: "active", label: "Active sessions", icon: Activity },
    { id: "yours", label: "Your session", icon: Link2 },
    { id: "settings", label: "Settings", icon: Settings },
  ];

  return (
    <>
      <PageHead
        title="Sessions"
        copy="Each button opens its own page — active logins, your studio session, or settings."
        actions={
          tab === "active" ? (
            <button className="btn" type="button" onClick={load} disabled={loading}>
              <RefreshCw size={15} /> Refresh
            </button>
          ) : null
        }
      />

      <nav className="page-subnav" aria-label="Sessions sections">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              className={tab === t.id ? "active" : ""}
              onClick={() => setTab(t.id)}
            >
              <Icon size={15} />
              {t.label}
              {t.id === "active" ? <em>{fmtNum(rows.length)}</em> : null}
            </button>
          );
        })}
      </nav>

      {tab === "active" ? (
        <>
          {err ? <Banner tone="bad">{err}</Banner> : null}
          <Panel
            title="Active sessions"
            copy={loading ? "Loading…" : `${fmtNum(rows.length)} live sign-ins across platform and studio`}
          >
            <PagedDataTable
              rows={rows}
              empty={loading ? "Loading sessions…" : "No active sessions right now."}
              columns={[
                { key: "email", label: "User", mono: true },
                { key: "role", label: "Role" },
                { key: "purpose", label: "Client" },
                { key: "last_seen_at", label: "Last seen", render: (s) => fmtTime(s.last_seen_at) },
                { key: "expires_at", label: "Expires", render: (s) => fmtTime(s.expires_at) },
                {
                  key: "actions",
                  label: "",
                  render: (s) => (
                    <div onClick={(e) => e.stopPropagation()}>
                      <RowMenu
                        label={`Session actions for ${s.email}`}
                        items={[
                          {
                            id: "revoke",
                            label: "Revoke session",
                            danger: true,
                            onClick: () => revoke(s),
                          },
                        ]}
                      />
                    </div>
                  ),
                },
              ]}
            />
          </Panel>
        </>
      ) : null}

      {tab === "yours" ? (
        <Panel title="Your studio session" copy="This browser’s owner / admin sign-in.">
          <div className="kv">
            <div>
              <span>Email</span>
              <b>{session?.user?.email || "—"}</b>
            </div>
            <div>
              <span>Name</span>
              <b>{session?.user?.displayName || "—"}</b>
            </div>
            <div>
              <span>Role</span>
              <b>{session?.user?.role || "—"}</b>
            </div>
            <div>
              <span>Expires</span>
              <b>{session?.expiresAt ? new Date(session.expiresAt).toLocaleString() : "—"}</b>
            </div>
            <div>
              <span>Realtime</span>
              <b>{rtState || "—"}</b>
            </div>
          </div>
          <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn danger" type="button" onClick={onLogout}>
              Sign out
            </button>
            <button className="btn" type="button" onClick={() => setTab("active")}>
              View all active sessions
            </button>
          </div>
        </Panel>
      ) : null}

      {tab === "settings" ? (
        <Panel
          title="Session & studio settings"
          copy="Appearance and security preferences live on the Settings page."
        >
          <div className="ws-action-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <button type="button" className="ws-action-card" onClick={() => onNavigate?.("settings")}>
              <Settings size={20} />
              <b>Open Settings</b>
              <span>Theme, Auto mode, and studio preferences</span>
            </button>
            <button type="button" className="ws-action-card" onClick={() => setTab("active")}>
              <Activity size={20} />
              <b>Active sessions</b>
              <span>Back to the live sessions table</span>
            </button>
            <button type="button" className="ws-action-card" onClick={() => setTab("yours")}>
              <Link2 size={20} />
              <b>Your session</b>
              <span>This browser’s signed-in account</span>
            </button>
          </div>
        </Panel>
      ) : null}
    </>
  );
}

function ThemeWindowPreview({ mode }) {
  /* CSS-drawn mini app window: chrome + sidebar + content cards */
  return (
    <div className={`theme-window theme-window--${mode}`} aria-hidden="true">
      <div className="theme-window-chrome">
        <span className="theme-window-dot" />
        <span className="theme-window-dot" />
        <span className="theme-window-dot" />
        <span className="theme-window-title">Database Studio</span>
      </div>
      <div className="theme-window-body">
        <aside className="theme-window-side">
          <i className="theme-window-logo" />
          <i />
          <i />
          <i className="on" />
          <i />
        </aside>
        <main className="theme-window-main">
          <div className="theme-window-top" />
          <div className="theme-window-cards">
            <span />
            <span />
            <span />
          </div>
          <div className="theme-window-panel" />
        </main>
      </div>
      {mode === "auto" ? (
        <div className="theme-window-split" title="Day / night">
          <div className="theme-window-half light" />
          <div className="theme-window-half dark" />
        </div>
      ) : null}
    </div>
  );
}

function MatrixCell({ allowed, locked, dirty, editable, onToggle, title }) {
  const cls = [
    "matrix-cell",
    allowed ? "yes" : "no",
    locked ? "locked" : "",
    dirty ? "dirty" : "",
    editable ? "editable" : "",
  ]
    .filter(Boolean)
    .join(" ");
  if (editable && !locked) {
    return (
      <button
        type="button"
        className={cls}
        title={title || (allowed ? "Click to revoke" : "Click to grant")}
        aria-label={title || (allowed ? "Granted — click to revoke" : "Not granted — click to grant")}
        aria-pressed={allowed}
        onClick={onToggle}
      >
        {allowed ? <Check size={14} strokeWidth={2.5} /> : <X size={14} strokeWidth={2.5} />}
      </button>
    );
  }
  return (
    <span
      className={cls}
      title={title || (locked ? "Locked" : allowed ? "Allowed" : "Not allowed")}
      aria-label={title || (allowed ? "Allowed" : "Not allowed")}
    >
      {allowed ? <Check size={14} strokeWidth={2.5} /> : <X size={14} strokeWidth={2.5} />}
      {locked ? <Lock size={9} className="matrix-lock-ico" /> : null}
    </span>
  );
}

export function MatrixPage({ token, session, onNavigate }) {
  const confirm = useAppConfirm();
  const me = session?.user || null;
  const myRole = String(me?.role || "viewer").toLowerCase();
  const isOwner = myRole === "owner";

  const [savedMatrix, setSavedMatrix] = useState(() => cloneMatrix(DEFAULT_ROLE_MATRIX));
  const [draft, setDraft] = useState(() => cloneMatrix(DEFAULT_ROLE_MATRIX));
  const [wsDraft, setWsDraft] = useState(() => cloneWorkspaceMatrix(DEFAULT_WORKSPACE_MATRIX));
  const [focusRole, setFocusRole] = useState(myRole);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [meta, setMeta] = useState({ source: "defaults", updatedAt: null });
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveMode, setSaveMode] = useState("save"); // save | reset
  const [twoFaCode, setTwoFaCode] = useState("");
  const [saveErr, setSaveErr] = useState("");
  const [copyFrom, setCopyFrom] = useState("admin");

  const groups = useMemo(() => [...new Set(PERMISSIONS.map((p) => p.group))], []);
  const dirtyCount = useMemo(() => matrixDiffCount(savedMatrix, draft), [savedMatrix, draft]);
  const dirtyList = useMemo(() => matrixDiffList(savedMatrix, draft), [savedMatrix, draft]);
  const canEdit = isOwner; // server also requires matrix.write + 2FA on save
  const canView = can(myRole, "matrix.read", draft) || isOwner;

  const filteredPerms = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return PERMISSIONS;
    return PERMISSIONS.filter(
      (p) =>
        p.label.toLowerCase().includes(needle) ||
        p.id.toLowerCase().includes(needle) ||
        p.group.toLowerCase().includes(needle)
    );
  }, [q]);

  const focusMeta = PLATFORM_ROLES.find((r) => r.id === focusRole) || PLATFORM_ROLES[0];
  const focusCount = countRoleAllows(draft, focusRole);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr("");
    try {
      const data = await api("/api/roles/matrix", { token });
      const m = applyHardLocks(data.matrix || DEFAULT_ROLE_MATRIX);
      setSavedMatrix(m);
      setDraft(cloneMatrix(m));
      setMeta({
        source: data.source || "database",
        updatedAt: data.updatedAt || null,
        canEdit: !!data.canEdit,
      });
    } catch (ex) {
      setErr(redact(ex.message));
      const m = cloneMatrix(DEFAULT_ROLE_MATRIX);
      setSavedMatrix(m);
      setDraft(m);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  function toggleCell(roleId, permId) {
    if (!canEdit) return;
    if (isCellLocked(roleId, permId)) {
      setMsg(cellLockReason(roleId, permId) || "This cell is locked");
      return;
    }
    setDraft((prev) => {
      const cur = !!prev?.[roleId]?.[permId];
      return setMatrixCell(prev, roleId, permId, !cur);
    });
    setMsg("");
  }

  function grantAllForRole(roleId) {
    if (!canEdit) return;
    setDraft((prev) => setMatrixColumn(prev, roleId, true));
  }

  function revokeAllForRole(roleId) {
    if (!canEdit) return;
    setDraft((prev) => setMatrixColumn(prev, roleId, false));
  }

  function grantFilteredForRole(roleId) {
    if (!canEdit) return;
    const ids = filteredPerms.map((p) => p.id);
    setDraft((prev) => setMatrixColumn(prev, roleId, true, { onlyPermIds: ids }));
  }

  function revokeFilteredForRole(roleId) {
    if (!canEdit) return;
    const ids = filteredPerms.map((p) => p.id);
    setDraft((prev) => setMatrixColumn(prev, roleId, false, { onlyPermIds: ids }));
  }

  function doCopyRole() {
    if (!canEdit || copyFrom === focusRole) return;
    setDraft((prev) => copyMatrixRole(prev, copyFrom, focusRole));
    setMsg(`Copied ${roleLabel(copyFrom)} → ${roleLabel(focusRole)} (locked cells kept)`);
  }

  async function discardDraft() {
    if (!dirtyCount) return;
    const ok = await confirm({
      title: "Discard changes?",
      message: `Throw away ${dirtyCount} unsaved permission change${dirtyCount === 1 ? "" : "s"}?`,
      confirmLabel: "Discard",
      danger: true,
    });
    if (!ok) return;
    setDraft(cloneMatrix(savedMatrix));
    setMsg("Draft discarded");
  }

  function openSave(mode = "save") {
    if (!canEdit) {
      setMsg("Only the platform owner can save matrix changes — with 2FA.");
      return;
    }
    if (mode === "save" && !dirtyCount) {
      setMsg("No changes to save");
      return;
    }
    setSaveMode(mode);
    setTwoFaCode("");
    setSaveErr("");
    setSaveOpen(true);
  }

  async function submitSave(e) {
    e?.preventDefault?.();
    if (!/^\d{6}$/.test(String(twoFaCode).trim())) {
      setSaveErr("Enter the 6-digit 2FA code from your authenticator");
      return;
    }
    setBusy(true);
    setSaveErr("");
    try {
      let data;
      if (saveMode === "reset") {
        data = await api("/api/roles/matrix/reset", {
          method: "POST",
          token,
          body: { twoFactorCode: String(twoFaCode).trim() },
        });
        setMsg("Matrix reset to factory defaults (2FA verified)");
      } else {
        data = await api("/api/roles/matrix", {
          method: "PUT",
          token,
          body: {
            matrix: applyHardLocks(draft),
            twoFactorCode: String(twoFaCode).trim(),
          },
        });
        setMsg(
          `Matrix saved — ${dirtyCount} change${dirtyCount === 1 ? "" : "s"} applied (2FA verified)`
        );
      }
      const m = applyHardLocks(data.matrix || DEFAULT_ROLE_MATRIX);
      setSavedMatrix(m);
      setDraft(cloneMatrix(m));
      setMeta((prev) => ({
        ...prev,
        source: "database",
        updatedAt: data.savedAt || new Date().toISOString(),
      }));
      setSaveOpen(false);
      setTwoFaCode("");
    } catch (ex) {
      setSaveErr(redact(ex.message));
    } finally {
      setBusy(false);
    }
  }

  function restoreDefaultsLocal() {
    if (!canEdit) return;
    setDraft(cloneMatrix(DEFAULT_ROLE_MATRIX));
    setMsg("Draft set to factory defaults — save with 2FA to apply, or discard to cancel");
  }

  if (!canView && !loading) {
    return (
      <>
        <PageHead title="Role matrix" copy="You do not have permission to view the matrix." />
        <Banner tone="bad">matrix.read is not granted for your role.</Banner>
      </>
    );
  }

  return (
    <>
      <PageHead
        title="Role matrix"
        copy={
          canEdit
            ? "Click any cell to grant or revoke a permission. Save with owner 2FA. Locked cells protect security-critical owner powers."
            : "Live map of what each platform role can do. Only the platform owner can edit and save changes (with 2FA)."
        }
        actions={
          <>
            <button className="btn" type="button" onClick={load} disabled={loading || busy}>
              <RefreshCw size={15} /> Refresh
            </button>
            {can(myRole, "roles.grant", draft) ? (
              <button className="btn" type="button" onClick={() => onNavigate?.("users")}>
                <ShieldCheck size={15} /> Grant roles
              </button>
            ) : null}
            {canEdit ? (
              <button
                className="btn primary"
                type="button"
                disabled={!dirtyCount || busy}
                onClick={() => openSave("save")}
                title={dirtyCount ? `Save ${dirtyCount} changes with 2FA` : "No unsaved changes"}
              >
                <Lock size={15} /> Save matrix ({dirtyCount})
              </button>
            ) : null}
          </>
        }
      />

      {msg ? <Banner tone={/fail|error|cannot|lock/i.test(msg) ? "bad" : "ok"}>{msg}</Banner> : null}
      {err ? <Banner tone="bad">{err}</Banner> : null}
      {dirtyCount > 0 && canEdit ? (
        <Banner tone="warn">
          <b>{dirtyCount} unsaved change{dirtyCount === 1 ? "" : "s"}</b> — click cells to grant/revoke,
          then <b>Save matrix</b> with owner 2FA.{" "}
          <button type="button" className="btn sm" onClick={discardDraft} style={{ marginLeft: 8 }}>
            Discard
          </button>
        </Banner>
      ) : null}

      <StatGrid
        items={[
          {
            label: "Platform roles",
            value: fmtNum(PLATFORM_ROLES.length),
            hint: loading ? "Loading…" : meta.source === "database" ? "Live from database" : "Factory defaults",
            tone: "purple",
            icon: <Shield size={16} />,
          },
          {
            label: "Permissions",
            value: fmtNum(PERMISSIONS.length),
            hint: `${groups.length} groups`,
            tone: "blue",
            icon: <Grid3x3 size={16} />,
          },
          {
            label: "Unsaved edits",
            value: fmtNum(dirtyCount),
            hint: canEdit ? "Owner can save with 2FA" : "Read-only for your role",
            tone: dirtyCount ? "amber" : "green",
          },
          {
            label: `${roleLabel(focusRole)} allows`,
            value: fmtNum(focusCount),
            hint: `of ${PERMISSIONS.length} capabilities`,
            tone: "amber",
          },
        ]}
      />

      <Panel
        title="Platform roles"
        copy="Select a role to highlight its column and use bulk grant/revoke tools. Click cells in the grid to toggle grant / not grant."
      >
        <div className="matrix-role-cards">
          {PLATFORM_ROLES.map((r) => {
            const n = countRoleAllows(draft, r.id);
            const roleDirty = PERMISSIONS.some(
              (p) => !!draft?.[r.id]?.[p.id] !== !!savedMatrix?.[r.id]?.[p.id]
            );
            return (
              <button
                key={r.id}
                type="button"
                className={`matrix-role-card ${focusRole === r.id ? "active" : ""} ${roleDirty ? "has-dirty" : ""} tone-${r.tone}`}
                onClick={() => setFocusRole(r.id)}
              >
                <div className="matrix-role-card-top">
                  <span className={`users-role-pill tone-${r.tone}`}>{r.label}</span>
                  <span className="matrix-role-card-badges">
                    {myRole === r.id ? <em className="matrix-you">You</em> : null}
                    {roleDirty ? <em className="matrix-dirty-tag">Edited</em> : null}
                  </span>
                </div>
                <b>{r.short}</b>
                <p>{r.description}</p>
                <small>
                  {n}/{PERMISSIONS.length} granted · rank {r.rank}
                </small>
              </button>
            );
          })}
        </div>
      </Panel>

      <Panel
        title="Capability matrix"
        copy={
          canEdit
            ? `Editable grid. Green ✓ = granted · grey ✗ = not granted · lock = cannot change. Focus: ${focusMeta.label}.`
            : `Read-only grid. Green = granted · grey = not granted. Focus: ${focusMeta.label}.`
        }
      >
        <div className="matrix-toolbar">
          <div className="tables-search-wrap wide">
            <Search size={14} className="tables-search-ico" />
            <input
              className="tables-search"
              placeholder="Filter permissions…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="ws-chip-row">
            {PLATFORM_ROLES.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`ws-chip ${focusRole === r.id ? "active" : ""}`}
                onClick={() => setFocusRole(r.id)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {canEdit ? (
          <div className="matrix-bulk-bar">
            <span className="matrix-bulk-label">
              Bulk for <b>{roleLabel(focusRole)}</b>
            </span>
            <button type="button" className="btn sm" onClick={() => grantAllForRole(focusRole)} title="Grant every unlocked permission">
              Grant all
            </button>
            <button type="button" className="btn sm" onClick={() => revokeAllForRole(focusRole)} title="Revoke every unlocked permission">
              Revoke all
            </button>
            {q.trim() ? (
              <>
                <button type="button" className="btn sm" onClick={() => grantFilteredForRole(focusRole)}>
                  Grant filtered
                </button>
                <button type="button" className="btn sm" onClick={() => revokeFilteredForRole(focusRole)}>
                  Revoke filtered
                </button>
              </>
            ) : null}
            <span className="matrix-bulk-sep" />
            <label className="matrix-copy-label">
              Copy from
              <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
                {PLATFORM_ROLES.filter((r) => r.id !== focusRole).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn sm" onClick={doCopyRole}>
              Copy onto {roleLabel(focusRole)}
            </button>
            <span className="matrix-bulk-sep" />
            <button type="button" className="btn sm" onClick={restoreDefaultsLocal}>
              Load defaults in draft
            </button>
            <button type="button" className="btn sm danger" onClick={() => openSave("reset")} title="Reset saved matrix to defaults (2FA)">
              Reset saved…
            </button>
          </div>
        ) : (
          <p className="role-grant-hint" style={{ marginBottom: 12 }}>
            You are signed in as <b>{roleLabel(myRole)}</b>. Matrix edits require the{" "}
            <b>platform owner</b> and <b>2FA</b>.
          </p>
        )}

        <div className="matrix-scroll">
          <table className="matrix-table matrix-table-edit">
            <thead>
              <tr>
                <th className="matrix-perm-col">Permission</th>
                {PLATFORM_ROLES.map((r) => (
                  <th
                    key={r.id}
                    className={`matrix-role-col ${focusRole === r.id ? "focus" : ""}`}
                  >
                    <span className={`users-role-pill tone-${r.tone}`}>{r.label}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => {
                const rows = filteredPerms.filter((p) => p.group === group);
                if (!rows.length) return null;
                return (
                  <Fragment key={group}>
                    <tr className="matrix-group-row">
                      <td colSpan={1 + PLATFORM_ROLES.length}>{group}</td>
                    </tr>
                    {rows.map((p) => (
                      <tr key={p.id}>
                        <td className="matrix-perm-col">
                          <b>{p.label}</b>
                          <small className="mono">{p.id}</small>
                        </td>
                        {PLATFORM_ROLES.map((r) => {
                          const allowed = !!draft?.[r.id]?.[p.id];
                          const was = !!savedMatrix?.[r.id]?.[p.id];
                          const locked = isCellLocked(r.id, p.id);
                          const lockReason = cellLockReason(r.id, p.id);
                          const cellDirty = allowed !== was;
                          return (
                            <td
                              key={r.id}
                              className={`matrix-role-col ${focusRole === r.id ? "focus" : ""} ${allowed ? "ok" : ""} ${cellDirty ? "cell-dirty" : ""}`}
                            >
                              <MatrixCell
                                allowed={allowed}
                                locked={locked}
                                dirty={cellDirty}
                                editable={canEdit}
                                title={
                                  locked
                                    ? lockReason
                                    : canEdit
                                      ? `${roleLabel(r.id)} · ${p.label}: ${allowed ? "granted" : "not granted"} — click to ${allowed ? "revoke" : "grant"}`
                                      : `${roleLabel(r.id)} · ${p.label}: ${allowed ? "granted" : "not granted"}`
                                }
                                onToggle={() => toggleCell(r.id, p.id)}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {!filteredPerms.length ? (
            <div className="empty">
              <b>No permissions match</b>
              Try another search.
            </div>
          ) : null}
        </div>

        {dirtyCount > 0 && canEdit ? (
          <div className="matrix-diff-panel">
            <b>Pending changes ({dirtyCount})</b>
            <ul>
              {dirtyList.slice(0, 24).map((c) => (
                <li key={`${c.role}-${c.perm}`}>
                  <span className={`users-role-pill tone-${roleTone(c.role)}`}>{roleLabel(c.role)}</span>
                  <code className="mono">{c.perm}</code>
                  <span className={c.to ? "diff-grant" : "diff-revoke"}>
                    {c.from ? "granted" : "not granted"} → {c.to ? "granted" : "not granted"}
                  </span>
                </li>
              ))}
              {dirtyList.length > 24 ? <li>…and {dirtyList.length - 24} more</li> : null}
            </ul>
          </div>
        ) : null}

        {meta.updatedAt ? (
          <p className="role-grant-hint" style={{ marginTop: 12 }}>
            Last saved: <b>{fmtTime(meta.updatedAt)}</b> · source: {meta.source}
          </p>
        ) : (
          <p className="role-grant-hint" style={{ marginTop: 12 }}>
            Using factory defaults until the owner saves a custom matrix.
          </p>
        )}
      </Panel>

      <Panel
        title="Security rules (always enforced)"
        copy="These locks apply even when you edit the matrix — the API re-applies them on every save."
      >
        <ul className="matrix-rules">
          <li>
            <ShieldCheck size={15} />
            <div>
              <b>roles.grant & matrix.write = owner only</b>
              <span>
                You cannot grant these to admin/operator/developer/support/viewer. Cells are locked.
              </span>
            </div>
          </li>
          <li>
            <Lock size={15} />
            <div>
              <b>Owner safety locks</b>
              <span>
                Owner always keeps studio access, matrix view/edit, role grants, 2FA self-manage, and
                user directory read — so you cannot lock yourself out.
              </span>
            </div>
          </li>
          <li>
            <Fingerprint size={15} />
            <div>
              <b>Save requires owner 2FA</b>
              <span>
                Every matrix save or reset verifies a live 6-digit authenticator code. Role assignment
                still uses Grant role (2FA) on Users.
              </span>
            </div>
          </li>
        </ul>
        <div className="matrix-actions-row">
          <button className="btn" type="button" onClick={() => onNavigate?.("users")}>
            <Users size={15} /> Open users
          </button>
          {canEdit && dirtyCount > 0 ? (
            <button className="btn primary" type="button" onClick={() => openSave("save")}>
              <Lock size={15} /> Save with 2FA
            </button>
          ) : null}
        </div>
      </Panel>

      <Panel
        title="Workspace team roles (product)"
        copy="Separate from the platform control plane. These are the roles inside a user's workspace (team invites). Toggle for reference; product workspace UI applies them at invite time."
      >
        <div className="matrix-scroll">
          <table className="matrix-table matrix-table-ws">
            <thead>
              <tr>
                <th className="matrix-perm-col">Workspace permission</th>
                {WORKSPACE_ROLES.filter((r) => r.id !== "ws_owner").map((r) => (
                  <th key={r.id}>{r.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {WORKSPACE_PERMISSIONS.map((p) => (
                <tr key={p.id}>
                  <td className="matrix-perm-col">
                    <b>{p.label}</b>
                    <small className="mono">{p.id}</small>
                  </td>
                  {WORKSPACE_ROLES.filter((r) => r.id !== "ws_owner").map((r) => {
                    const allowed = !!wsDraft?.[r.id]?.[p.id];
                    return (
                      <td key={r.id}>
                        <MatrixCell
                          allowed={allowed}
                          editable={canEdit}
                          title={
                            canEdit
                              ? `${r.label} · ${p.label} — click to toggle (workspace template)`
                              : undefined
                          }
                          onToggle={() => {
                            if (!canEdit) return;
                            setWsDraft((prev) => {
                              const next = cloneWorkspaceMatrix(prev);
                              next[r.id][p.id] = !next[r.id][p.id];
                              return next;
                            });
                          }}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="role-grant-hint" style={{ marginTop: 12 }}>
          Workspace <b>Owner</b> is always the account holder. Platform matrix changes do not replace
          workspace ownership. Workspace toggles here are a studio template preview for the product
          team roles (Admin / Developer / Marketer / Viewer).
        </p>
      </Panel>

      {saveOpen ? (
        <Modal
          title={saveMode === "reset" ? "Reset matrix (owner + 2FA)" : "Save matrix (owner + 2FA)"}
          onClose={() => !busy && setSaveOpen(false)}
        >
          <form className="grant-pane" onSubmit={submitSave}>
            <div className="grant-warning">
              <ShieldCheck size={18} />
              <div>
                <b>{saveMode === "reset" ? "Reset to factory defaults" : "Publish permission changes"}</b>
                <p>
                  {saveMode === "reset"
                    ? "This overwrites the live matrix with factory defaults for all roles."
                    : `You are about to apply ${dirtyCount} permission change${dirtyCount === 1 ? "" : "s"}. The API will enforce the new matrix immediately.`}{" "}
                  Enter your <b>owner 2FA</b> code to continue.
                </p>
              </div>
            </div>
            {saveMode === "save" && dirtyList.length ? (
              <div className="matrix-diff-panel compact">
                <ul>
                  {dirtyList.slice(0, 12).map((c) => (
                    <li key={`${c.role}-${c.perm}`}>
                      <b>{roleLabel(c.role)}</b> <code className="mono">{c.perm}</code>{" "}
                      <span className={c.to ? "diff-grant" : "diff-revoke"}>
                        {c.to ? "grant" : "revoke"}
                      </span>
                    </li>
                  ))}
                  {dirtyList.length > 12 ? <li>…and {dirtyList.length - 12} more</li> : null}
                </ul>
              </div>
            ) : null}
            <Field label="Owner 2FA code" full>
              <div className="field-with-ico">
                <Fingerprint size={15} className="field-ico" />
                <input
                  required
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={twoFaCode}
                  onChange={(e) => setTwoFaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  autoFocus
                />
              </div>
            </Field>
            {saveErr ? <Banner tone="bad">{saveErr}</Banner> : null}
            <div className="grant-actions">
              <button className="btn" type="button" disabled={busy} onClick={() => setSaveOpen(false)}>
                Cancel
              </button>
              <button
                className={`btn primary ${saveMode === "reset" ? "danger" : ""}`}
                type="submit"
                disabled={busy || twoFaCode.length !== 6}
              >
                {busy
                  ? "Verifying…"
                  : saveMode === "reset"
                    ? "Verify 2FA & reset"
                    : `Verify 2FA & save (${dirtyCount})`}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

export function SettingsPage({ themePref, resolvedTheme, onThemeChange, pollMs = 10000, onPollChange }) {
  const confirm = useAppConfirm();
  const pollOptions = [
    { value: "5000", label: "Every 5 seconds" },
    { value: "10000", label: "Every 10 seconds (default)" },
    { value: "30000", label: "Every 30 seconds" },
    { value: "60000", label: "Every minute" },
  ];
  async function clearLocalCache() {
    const ok = await confirm({
      title: "Clear local studio data",
      message:
        "Remove locally stored studio preferences and cached session from this browser?\n\nYou will be signed out. Nothing on the server is touched.",
      danger: true,
      confirmLabel: "Clear & sign out",
    });
    if (!ok) return;
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
    window.location.reload();
  }
  const themes = [
    {
      id: "light",
      title: "Light",
      desc: "Bright white studio — soft cards, calm blue accent.",
    },
    {
      id: "dark",
      title: "Dark",
      desc: "Night console — soft grey text, deep panels, easy on the eyes.",
    },
    {
      id: "auto",
      title: "Auto",
      desc: "Follows your system appearance, or day/night by the clock (7am–7pm light).",
    },
  ];
  const activeLabel =
    themePref === "auto"
      ? `Auto · currently ${resolvedTheme === "dark" ? "Dark" : "Light"}`
      : themes.find((t) => t.id === themePref)?.title || "Auto";

  return (
    <>
      <PageHead
        title="Settings"
        copy="Choose Light, Dark, or Auto. The whole studio updates together — sidebar, top bar, and content."
      />
      <Panel
        title="Appearance"
        copy={
          themePref === "auto"
            ? `Auto is on. Right now this device is using ${resolvedTheme === "dark" ? "Dark" : "Light"} (system preference, or time of day).`
            : "Pick a look. Soft text and borders in every mode."
        }
      >
        <div className="theme-grid">
          {themes.map((t) => (
            <button
              key={t.id}
              type="button"
              data-t={t.id}
              className={`theme-option ${themePref === t.id ? "active" : ""}`}
              onClick={() => onThemeChange(t.id)}
            >
              <ThemeWindowPreview mode={t.id === "auto" ? "auto" : t.id} />
              <div className="theme-option-meta">
                <b>{t.title}</b>
                <span>{t.desc}</span>
              </div>
              <span className="btn sm">{themePref === t.id ? "Selected" : "Use theme"}</span>
            </button>
          ))}
        </div>
      </Panel>
      <Panel
        title="Live refresh"
        copy="How often the studio re-polls overview stats when the realtime stream is quiet. Realtime events always apply instantly."
      >
        <div className="form">
          <Field label="Poll interval">
            <AppSelect
              value={String(pollMs)}
              onChange={(v) => onPollChange?.(Number(v))}
              options={pollOptions}
            />
          </Field>
        </div>
      </Panel>
      <Panel title="Security notes" copy="Network addresses and raw API hosts are never shown in this studio UI.">
        <div className="kv">
          <div>
            <span>IP / host display</span>
            <b>Hidden</b>
          </div>
          <div>
            <span>Theme storage</span>
            <b>This browser only</b>
          </div>
          <div>
            <span>Active theme</span>
            <b>{activeLabel}</b>
          </div>
          <div>
            <span>Realtime poll</span>
            <b>{Math.round(pollMs / 1000)}s fallback</b>
          </div>
        </div>
      </Panel>
      <Panel
        title="Local data"
        copy="The studio keeps only your theme, refresh preference and signed-in session in this browser."
      >
        <button className="btn danger" type="button" onClick={clearLocalCache}>
          Clear local studio data…
        </button>
      </Panel>
    </>
  );
}

export function SessionInfoPage({ session, rtState, onLogout }) {
  return (
    <>
      <PageHead title="Your session" copy="This studio sign-in (owner / admin console)." />
      <Panel title="Session details">
        <div className="kv">
          <div>
            <span>Email</span>
            <b>{session.user?.email}</b>
          </div>
          <div>
            <span>Name</span>
            <b>{session.user?.displayName || "—"}</b>
          </div>
          <div>
            <span>Role</span>
            <b>{roleLabel(session.user?.role)}</b>
          </div>
          <div>
            <span>Expires</span>
            <b>{session.expiresAt ? new Date(session.expiresAt).toLocaleString() : "—"}</b>
          </div>
          <div>
            <span>Realtime</span>
            <b>{rtState}</b>
          </div>
          <div>
            <span>API endpoint</span>
            <b>Hidden (secure local config)</b>
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          <button className="btn danger" type="button" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </Panel>
    </>
  );
}
