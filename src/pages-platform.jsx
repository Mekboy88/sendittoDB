import { useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  FileText,
  Inbox,
  Layers,
  Link2,
  Mail,
  Megaphone,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Tag,
  Trash2,
  Users,
  Webhook,
  X,
} from "lucide-react";
import { api, fmtNum, fmtTime, redact } from "./api.js";
import {
  DEFAULT_WORKSPACE_MATRIX,
  WORKSPACE_PERMISSIONS,
  WORKSPACE_ROLES,
  cloneWorkspaceMatrix,
} from "./roles.js";
import {
  AppSelect,
  Banner,
  BulkBar,
  BulkSelectCell,
  BulkSelectHeader,
  Field,
  Modal,
  PageHead,
  PagedDataTable,
  Panel,
  StatGrid,
  TablePager,
  TableShell,
  runBulk,
  useAppConfirm,
  useBulkSelection,
  useClientPager,
} from "./ui.jsx";
import { RowMenu, useEntity } from "./pages.jsx";

/* ---------- shared bits ---------- */

function toneFor(status) {
  const s = String(status || "").toLowerCase();
  if (/publish|live|active|sent|delivered|verified|connected|read/.test(s)) return "ok";
  if (/draft|scheduled|paused|pending|queued|processing|unread/.test(s)) return "amber";
  if (/fail|error|bounce|cancel|revoked|disabled/.test(s)) return "bad";
  return "";
}

function StatusTag({ value }) {
  return <span className={`tag ${toneFor(value)}`.trim()}>{String(value || "—")}</span>;
}

function csvDownload(filename, cols, rows) {
  const lines = [cols.join(",")];
  for (const r of rows) {
    lines.push(cols.map((c) => `"${String(r[c] ?? "").replace(/"/g, '""')}"`).join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function useWorkspaceOptions(token) {
  const workspaces = useEntity(token, "/api/workspaces");
  return useMemo(
    () => [
      { value: "", label: "All workspaces" },
      ...(workspaces.rows || []).map((w) => ({ value: String(w.id), label: w.name || String(w.id) })),
    ],
    [workspaces.rows]
  );
}

/* ============================================================
   TEMPLATES
   ============================================================ */

const TEMPLATE_CATEGORIES = ["Onboarding", "Security", "Billing", "Newsletter", "Product", "Other"];

export function TemplatesPage({ token, onChanged }) {
  const confirm = useAppConfirm();
  const { rows, total, err, loading, load } = useEntity(token, "/api/templates");
  const wsOptions = useWorkspaceOptions(token);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null); // null | {} | row

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((t) => {
      if (statusFilter !== "all" && String(t.status || "").toLowerCase() !== statusFilter) return false;
      if (!needle) return true;
      return `${t.name || ""} ${t.subject || ""} ${t.category || ""} ${t.workspace_name || ""}`
        .toLowerCase()
        .includes(needle);
    });
  }, [rows, q, statusFilter]);

  const stats = useMemo(() => {
    const published = rows.filter((t) => /publish/i.test(t.status || "")).length;
    const usage = rows.reduce((s, t) => s + (Number(t.usage) || 0), 0);
    const top = [...rows].sort((a, b) => (Number(b.usage) || 0) - (Number(a.usage) || 0))[0];
    return { published, usage, top };
  }, [rows]);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    try {
      const body = {
        name: editing.name?.trim(),
        category: editing.category || "Other",
        subject: editing.subject || "",
        html: editing.html || "",
        status: editing.status || "Draft",
        workspaceId: editing.workspaceId || undefined,
      };
      if (editing.id) await api(`/api/templates/${editing.id}`, { method: "PATCH", token, body });
      else await api("/api/templates", { method: "POST", token, body });
      setMsg(editing.id ? `Saved “${body.name}”` : `Created “${body.name}”`);
      setEditing(null);
      await load();
      onChanged?.();
    } catch (ex) {
      setMsg(redact(ex.message));
    } finally {
      setBusy(false);
    }
  }

  async function removeTemplate(t) {
    const ok = await confirm({
      title: "Delete template",
      message: `Delete template “${t.name}”? Sends that already used it keep their content.`,
      danger: true,
      confirmLabel: "Delete template",
    });
    if (!ok) return;
    try {
      await api(`/api/templates/${t.id}`, { method: "DELETE", token });
      setMsg(`Deleted “${t.name}”`);
      await load();
      onChanged?.();
    } catch (ex) {
      setMsg(redact(ex.message));
    }
  }

  return (
    <>
      <PageHead
        title="Templates"
        copy="Reusable email designs stored in the product database — what workspaces send with."
        actions={
          <button className="btn primary" type="button" onClick={() => setEditing({ status: "Draft", category: "Onboarding" })}>
            <Plus size={15} /> New template
          </button>
        }
      />
      {err ? <Banner tone="bad">{err}</Banner> : null}
      {msg ? <Banner tone="info">{msg}</Banner> : null}
      <StatGrid
        items={[
          { label: "Templates", value: fmtNum(total), hint: "All workspaces", icon: <FileText size={16} /> },
          { label: "Published", value: fmtNum(stats.published), hint: "Ready to send", tone: "ok", icon: <BadgeCheck size={16} /> },
          { label: "Total sends", value: fmtNum(stats.usage), hint: "Messages rendered from templates", icon: <Send size={16} /> },
          { label: "Most used", value: stats.top?.name || "—", hint: stats.top ? `${fmtNum(stats.top.usage)} sends` : "No usage yet", tone: "amber", icon: <Tag size={16} /> },
        ]}
      />
      <Panel title="Library" copy={`${fmtNum(filtered.length)} of ${fmtNum(total)} templates`}>
        <div className="ws-table-toolbar">
          <div className="tables-search-wrap wide">
            <Search size={14} className="tables-search-ico" />
            <input
              className="tables-search"
              placeholder="Search name, subject, category…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="ws-chip-row">
            {["all", "published", "draft"].map((s) => (
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
        <PagedDataTable
          rows={filtered}
          resetKey={`${q}|${statusFilter}`}
          empty="Templates created in the product appear here."
          columns={[
            { key: "name", label: "Template", render: (t) => <b>{t.name || "—"}</b> },
            { key: "category", label: "Category", render: (t) => <span className="tag">{t.category || "—"}</span> },
            { key: "subject", label: "Subject", render: (t) => t.subject || "—" },
            { key: "status", label: "Status", render: (t) => <StatusTag value={t.status} /> },
            { key: "usage", label: "Sends", render: (t) => fmtNum(t.usage || 0) },
            { key: "workspace_name", label: "Workspace", render: (t) => t.workspace_name || "Global" },
            { key: "updated_at", label: "Updated", render: (t) => fmtTime(t.updated_at || t.created_at) },
            {
              key: "menu",
              label: "",
              render: (t) => (
                <RowMenu
                  items={[
                    { id: "edit", label: "Edit template", icon: <FileText size={15} />, onClick: () => setEditing({ ...t, workspaceId: t.workspace_id ? String(t.workspace_id) : "" }) },
                    { id: "dup", label: "Duplicate", icon: <Plus size={15} />, onClick: () => setEditing({ ...t, id: undefined, name: `${t.name} (copy)`, status: "Draft", workspaceId: t.workspace_id ? String(t.workspace_id) : "" }) },
                    { id: "del", label: "Delete…", icon: <Trash2 size={15} />, danger: true, onClick: () => removeTemplate(t) },
                  ]}
                />
              ),
            },
          ]}
        />
      </Panel>

      {editing ? (
        <Modal title={editing.id ? "Edit template" : "New template"} wide onClose={() => setEditing(null)}>
          <form onSubmit={save}>
            <div className="form">
              <Field label="Name" full>
                <input
                  required
                  autoFocus
                  value={editing.name || ""}
                  onChange={(e) => setEditing((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Welcome email"
                />
              </Field>
              <Field label="Category">
                <AppSelect
                  value={editing.category || "Other"}
                  onChange={(v) => setEditing((f) => ({ ...f, category: v }))}
                  options={TEMPLATE_CATEGORIES.map((c) => ({ value: c, label: c }))}
                />
              </Field>
              <Field label="Status">
                <AppSelect
                  value={editing.status || "Draft"}
                  onChange={(v) => setEditing((f) => ({ ...f, status: v }))}
                  options={[
                    { value: "Draft", label: "Draft" },
                    { value: "Published", label: "Published" },
                  ]}
                />
              </Field>
              <Field label="Workspace">
                <AppSelect
                  value={editing.workspaceId || ""}
                  onChange={(v) => setEditing((f) => ({ ...f, workspaceId: v }))}
                  options={wsOptions.map((o) => (o.value === "" ? { ...o, label: "Global (all workspaces)" } : o))}
                />
              </Field>
              <Field label="Subject" full>
                <input
                  value={editing.subject || ""}
                  onChange={(e) => setEditing((f) => ({ ...f, subject: e.target.value }))}
                  placeholder="Welcome to {{product}} 👋"
                />
              </Field>
              <Field label="HTML body" full>
                <textarea
                  rows={8}
                  className="mono"
                  value={editing.html || ""}
                  onChange={(e) => setEditing((f) => ({ ...f, html: e.target.value }))}
                  placeholder="<h1>Hello {{name}}</h1>"
                />
              </Field>
            </div>
            <div className="grant-actions" style={{ marginTop: 16 }}>
              <button className="btn" type="button" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="btn primary" type="submit" disabled={busy || !(editing.name || "").trim()}>
                {busy ? "Saving…" : editing.id ? "Save template" : "Create template"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

/* ============================================================
   CAMPAIGNS
   ============================================================ */

export function CampaignsPage({ token, onChanged }) {
  const confirm = useAppConfirm();
  const { rows, total, err, loading, load } = useEntity(token, "/api/campaigns");
  const wsOptions = useWorkspaceOptions(token);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((c) => {
      if (statusFilter !== "all" && String(c.status || "").toLowerCase() !== statusFilter) return false;
      if (!needle) return true;
      return `${c.name || ""} ${c.subject || ""} ${c.audience || ""} ${c.workspace_name || ""}`
        .toLowerCase()
        .includes(needle);
    });
  }, [rows, q, statusFilter]);

  const stats = useMemo(() => {
    const sent = rows.reduce((s, c) => s + (Number(c.sent) || 0), 0);
    const opened = rows.reduce((s, c) => s + (Number(c.opened) || 0), 0);
    const clicked = rows.reduce((s, c) => s + (Number(c.clicked) || 0), 0);
    return {
      sent,
      openRate: sent ? `${((opened / sent) * 100).toFixed(1)}%` : "—",
      clickRate: sent ? `${((clicked / sent) * 100).toFixed(1)}%` : "—",
      running: rows.filter((c) => /scheduled|sending/i.test(c.status || "")).length,
    };
  }, [rows]);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    try {
      const body = {
        name: editing.name?.trim(),
        subject: editing.subject || "",
        audience: editing.audience || "",
        status: editing.status || "Draft",
        workspaceId: editing.workspaceId || undefined,
      };
      if (editing.id) await api(`/api/campaigns/${editing.id}`, { method: "PATCH", token, body });
      else await api("/api/campaigns", { method: "POST", token, body });
      setMsg(editing.id ? `Saved “${body.name}”` : `Created “${body.name}”`);
      setEditing(null);
      await load();
      onChanged?.();
    } catch (ex) {
      setMsg(redact(ex.message));
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(c, status, verb) {
    const ok = await confirm({
      title: `${verb} campaign`,
      message: `${verb} “${c.name}”?`,
      danger: status === "Cancelled",
      confirmLabel: verb,
    });
    if (!ok) return;
    try {
      await api(`/api/campaigns/${c.id}`, { method: "PATCH", token, body: { status } });
      setMsg(`${verb}ed “${c.name}”`);
      await load();
      onChanged?.();
    } catch (ex) {
      setMsg(redact(ex.message));
    }
  }

  async function removeCampaign(c) {
    const ok = await confirm({
      title: "Delete campaign",
      message: `Delete campaign “${c.name}” and its draft content? Delivery history in Messages is kept.`,
      danger: true,
      confirmLabel: "Delete campaign",
    });
    if (!ok) return;
    try {
      await api(`/api/campaigns/${c.id}`, { method: "DELETE", token });
      setMsg(`Deleted “${c.name}”`);
      await load();
      onChanged?.();
    } catch (ex) {
      setMsg(redact(ex.message));
    }
  }

  return (
    <>
      <PageHead
        title="Campaigns"
        copy="Marketing sends created by workspaces — schedule state and engagement, straight from the database."
        actions={
          <button className="btn primary" type="button" onClick={() => setEditing({ status: "Draft" })}>
            <Plus size={15} /> New campaign
          </button>
        }
      />
      {err ? <Banner tone="bad">{err}</Banner> : null}
      {msg ? <Banner tone="info">{msg}</Banner> : null}
      <StatGrid
        items={[
          { label: "Campaigns", value: fmtNum(total), hint: "All workspaces", icon: <Megaphone size={16} /> },
          { label: "Emails sent", value: fmtNum(stats.sent), hint: "Across all campaigns", icon: <Send size={16} /> },
          { label: "Open rate", value: stats.openRate, hint: "Weighted average", tone: "ok", icon: <Mail size={16} /> },
          { label: "Running now", value: fmtNum(stats.running), hint: "Scheduled or sending", tone: "amber", icon: <RefreshCw size={16} /> },
        ]}
      />
      <Panel title="All campaigns" copy={`${fmtNum(filtered.length)} of ${fmtNum(total)}`}>
        <div className="ws-table-toolbar">
          <div className="tables-search-wrap wide">
            <Search size={14} className="tables-search-ico" />
            <input
              className="tables-search"
              placeholder="Search name, subject, audience…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="ws-chip-row">
            {["all", "draft", "scheduled", "sending", "sent", "cancelled"].map((s) => (
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
        <PagedDataTable
          rows={filtered}
          resetKey={`${q}|${statusFilter}`}
          empty="Campaigns created in the product appear here."
          columns={[
            { key: "name", label: "Campaign", render: (c) => <b>{c.name || "—"}</b> },
            { key: "subject", label: "Subject", render: (c) => c.subject || "—" },
            { key: "audience", label: "Audience", render: (c) => (c.audience ? <span className="tag">{c.audience}</span> : "—") },
            { key: "status", label: "Status", render: (c) => <StatusTag value={c.status} /> },
            {
              key: "engagement",
              label: "Sent / opened / clicked",
              render: (c) => `${fmtNum(c.sent || 0)} · ${fmtNum(c.opened || 0)} · ${fmtNum(c.clicked || 0)}`,
            },
            { key: "workspace_name", label: "Workspace", render: (c) => c.workspace_name || "—" },
            { key: "updated_at", label: "Updated", render: (c) => fmtTime(c.updated_at || c.created_at) },
            {
              key: "menu",
              label: "",
              render: (c) => (
                <RowMenu
                  items={[
                    { id: "edit", label: "Edit campaign", icon: <Megaphone size={15} />, onClick: () => setEditing({ ...c, workspaceId: c.workspace_id ? String(c.workspace_id) : "" }) },
                    ...(/scheduled|sending/i.test(c.status || "")
                      ? [{ id: "cancel", label: "Cancel run…", icon: <X size={15} />, danger: true, onClick: () => setStatus(c, "Cancelled", "Cancel") }]
                      : []),
                    { id: "del", label: "Delete…", icon: <Trash2 size={15} />, danger: true, onClick: () => removeCampaign(c) },
                  ]}
                />
              ),
            },
          ]}
        />
      </Panel>

      {editing ? (
        <Modal title={editing.id ? "Edit campaign" : "New campaign"} onClose={() => setEditing(null)}>
          <form onSubmit={save}>
            <div className="form">
              <Field label="Name" full>
                <input
                  required
                  autoFocus
                  value={editing.name || ""}
                  onChange={(e) => setEditing((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Summer launch"
                />
              </Field>
              <Field label="Subject" full>
                <input
                  value={editing.subject || ""}
                  onChange={(e) => setEditing((f) => ({ ...f, subject: e.target.value }))}
                  placeholder="The summer release is here"
                />
              </Field>
              <Field label="Audience">
                <input
                  value={editing.audience || ""}
                  onChange={(e) => setEditing((f) => ({ ...f, audience: e.target.value }))}
                  placeholder="Newsletter audience"
                />
              </Field>
              <Field label="Status">
                <AppSelect
                  value={editing.status || "Draft"}
                  onChange={(v) => setEditing((f) => ({ ...f, status: v }))}
                  options={["Draft", "Scheduled", "Sending", "Sent", "Cancelled"].map((s) => ({ value: s, label: s }))}
                />
              </Field>
              <Field label="Workspace">
                <AppSelect
                  value={editing.workspaceId || ""}
                  onChange={(v) => setEditing((f) => ({ ...f, workspaceId: v }))}
                  options={wsOptions}
                />
              </Field>
            </div>
            <div className="grant-actions" style={{ marginTop: 16 }}>
              <button className="btn" type="button" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="btn primary" type="submit" disabled={busy || !(editing.name || "").trim()}>
                {busy ? "Saving…" : editing.id ? "Save campaign" : "Create campaign"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

/* ============================================================
   CONTACTS
   ============================================================ */

export function ContactsPage({ token, onChanged }) {
  const confirm = useAppConfirm();
  const { rows, total, err, loading, load } = useEntity(token, "/api/contacts");
  const wsOptions = useWorkspaceOptions(token);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [wsFilter, setWsFilter] = useState("all");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((c) => {
      if (statusFilter !== "all" && String(c.status || "").toLowerCase() !== statusFilter) return false;
      if (wsFilter !== "all" && String(c.workspace_id || "") !== wsFilter) return false;
      if (!needle) return true;
      return `${c.name || ""} ${c.email || ""} ${(Array.isArray(c.tags) ? c.tags : []).join(" ")} ${c.workspace_name || ""}`
        .toLowerCase()
        .includes(needle);
    });
  }, [rows, q, statusFilter, wsFilter]);

  const filterKey = `${q}|${statusFilter}|${wsFilter}`;
  const pager = useClientPager(filtered, { resetKey: filterKey });
  const bulk = useBulkSelection(pager.pageRows, { resetKey: filterKey });

  const stats = useMemo(
    () => ({
      subscribed: rows.filter((c) => /subscribed/i.test(c.status || "")).length,
      unsubscribed: rows.filter((c) => /unsubscribed/i.test(c.status || "")).length,
      pending: rows.filter((c) => /pending/i.test(c.status || "")).length,
    }),
    [rows]
  );

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    try {
      const body = {
        name: editing.name?.trim() || "",
        email: editing.email?.trim(),
        status: editing.status || "Subscribed",
        tags: String(editing.tagsText || "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        workspaceId: editing.workspaceId || undefined,
      };
      if (editing.id) await api(`/api/contacts/${editing.id}`, { method: "PATCH", token, body });
      else await api("/api/contacts", { method: "POST", token, body });
      setMsg(editing.id ? `Saved ${body.email}` : `Added ${body.email}`);
      setEditing(null);
      await load();
      onChanged?.();
    } catch (ex) {
      setMsg(redact(ex.message));
    } finally {
      setBusy(false);
    }
  }

  async function removeContact(c) {
    const ok = await confirm({
      title: "Delete contact",
      message: `Delete ${c.email} from the product database? Suppression history is kept separately.`,
      danger: true,
      confirmLabel: "Delete contact",
    });
    if (!ok) return;
    try {
      await api(`/api/contacts/${c.id}`, { method: "DELETE", token });
      setMsg(`Deleted ${c.email}`);
      await load();
      onChanged?.();
    } catch (ex) {
      setMsg(redact(ex.message));
    }
  }

  async function bulkDelete() {
    if (!bulk.count) return;
    const ids = [...bulk.selectedIds];
    const ok = await confirm({
      title: "Bulk delete contacts",
      message: `Delete ${ids.length} selected contact${ids.length === 1 ? "" : "s"}?`,
      danger: true,
      confirmLabel: "Delete selected",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await runBulk(ids, (id) => api(`/api/contacts/${id}`, { method: "DELETE", token }));
      setMsg(res.fail ? `Deleted ${res.ok}, failed ${res.fail}` : `Deleted ${res.ok} contact${res.ok === 1 ? "" : "s"}`);
      bulk.clear();
      await load();
      onChanged?.();
    } catch (ex) {
      setMsg(redact(ex.message));
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    if (!filtered.length) return;
    csvDownload(
      `senditto-contacts-${Date.now()}.csv`,
      ["id", "name", "email", "status", "tags", "workspace_name", "created_at"],
      filtered.map((c) => ({ ...c, tags: (Array.isArray(c.tags) ? c.tags : []).join(";") }))
    );
    setMsg(`Exported ${filtered.length} contacts`);
  }

  return (
    <>
      <PageHead
        title="Contacts"
        copy="The audience table behind every workspace — subscription state is user-owned; operators manage records, not consent."
        actions={
          <>
            <button className="btn" type="button" onClick={exportCsv} disabled={!filtered.length}>
              Export CSV
            </button>
            <button className="btn primary" type="button" onClick={() => setEditing({ status: "Subscribed" })}>
              <Plus size={15} /> Add contact
            </button>
          </>
        }
      />
      {err ? <Banner tone="bad">{err}</Banner> : null}
      {msg ? <Banner tone="info">{msg}</Banner> : null}
      <StatGrid
        items={[
          { label: "Contacts", value: fmtNum(total), hint: "All workspaces", icon: <Users size={16} /> },
          { label: "Subscribed", value: fmtNum(stats.subscribed), hint: "Can receive marketing", tone: "ok", icon: <BadgeCheck size={16} /> },
          { label: "Pending", value: fmtNum(stats.pending), hint: "Awaiting confirmation", tone: "amber", icon: <RefreshCw size={16} /> },
          { label: "Unsubscribed", value: fmtNum(stats.unsubscribed), hint: "Marketing blocked", tone: "bad", icon: <X size={16} /> },
        ]}
      />
      <Panel title="Directory" copy={`${fmtNum(filtered.length)} of ${fmtNum(total)} contacts`}>
        <div className="ws-table-toolbar">
          <div className="tables-search-wrap wide">
            <Search size={14} className="tables-search-ico" />
            <input
              className="tables-search"
              placeholder="Search name, email, tag…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="ws-chip-row">
            {["all", "subscribed", "pending", "unsubscribed"].map((s) => (
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
          <AppSelect
            value={wsFilter}
            onChange={setWsFilter}
            options={[{ value: "all", label: "All workspaces" }, ...wsOptions.slice(1)]}
          />
        </div>

        {!loading && filtered.length === 0 ? (
          <div className="empty">
            <b>No contacts match</b>
            {rows.length ? "Try another filter." : "Contacts created in the product appear here."}
          </div>
        ) : (
          <div className="paged-table-stack">
            <BulkBar
              count={bulk.count}
              noun={bulk.count === 1 ? "contact selected" : "contacts selected"}
              pageCount={pager.pageRows.length}
              filteredCount={filtered.length}
              onClear={bulk.clear}
              actions={
                <button className="btn sm danger" type="button" disabled={busy} onClick={bulkDelete}>
                  <Trash2 size={14} /> Delete selected
                </button>
              }
            />
            <TableShell rowCount={pager.pageRows.length}>
              <table className="data">
                <thead>
                  <tr>
                    <BulkSelectHeader
                      checked={bulk.allSelected}
                      indeterminate={bulk.someSelected}
                      onChange={bulk.toggleAll}
                    />
                    <th>Contact</th>
                    <th>Status</th>
                    <th>Tags</th>
                    <th>Workspace</th>
                    <th>Added</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {pager.pageRows.map((c) => (
                    <tr key={c.id}>
                      <BulkSelectCell checked={bulk.isSelected(c.id)} onChange={() => bulk.toggle(c.id)} />
                      <td>
                        <b>{c.name || "—"}</b>
                        <div className="muted-sm">{c.email}</div>
                      </td>
                      <td>
                        <StatusTag value={c.status} />
                      </td>
                      <td>
                        {(Array.isArray(c.tags) ? c.tags : []).length
                          ? (Array.isArray(c.tags) ? c.tags : []).map((t) => (
                              <span key={t} className="tag" style={{ marginRight: 4 }}>
                                {t}
                              </span>
                            ))
                          : "—"}
                      </td>
                      <td>{c.workspace_name || "—"}</td>
                      <td>{fmtTime(c.created_at)}</td>
                      <td>
                        <RowMenu
                          items={[
                            { id: "edit", label: "Edit contact", icon: <Users size={15} />, onClick: () => setEditing({ ...c, tagsText: (Array.isArray(c.tags) ? c.tags : []).join(", "), workspaceId: c.workspace_id ? String(c.workspace_id) : "" }) },
                            { id: "del", label: "Delete…", icon: <Trash2 size={15} />, danger: true, onClick: () => removeContact(c) },
                          ]}
                        />
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

      {editing ? (
        <Modal title={editing.id ? "Edit contact" : "Add contact"} onClose={() => setEditing(null)}>
          <form onSubmit={save}>
            <div className="form">
              <Field label="Email" full>
                <input
                  type="email"
                  required
                  autoFocus
                  value={editing.email || ""}
                  onChange={(e) => setEditing((f) => ({ ...f, email: e.target.value }))}
                  placeholder="ava@acme.dev"
                />
              </Field>
              <Field label="Full name">
                <input
                  value={editing.name || ""}
                  onChange={(e) => setEditing((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Ava Berg"
                />
              </Field>
              <Field label="Status">
                <AppSelect
                  value={editing.status || "Subscribed"}
                  onChange={(v) => setEditing((f) => ({ ...f, status: v }))}
                  options={["Subscribed", "Pending", "Unsubscribed"].map((s) => ({ value: s, label: s }))}
                />
              </Field>
              <Field label="Workspace">
                <AppSelect
                  value={editing.workspaceId || ""}
                  onChange={(v) => setEditing((f) => ({ ...f, workspaceId: v }))}
                  options={wsOptions}
                />
              </Field>
              <Field label="Tags (comma separated)" full>
                <input
                  value={editing.tagsText || ""}
                  onChange={(e) => setEditing((f) => ({ ...f, tagsText: e.target.value }))}
                  placeholder="customer, vip"
                />
              </Field>
            </div>
            <div className="grant-actions" style={{ marginTop: 16 }}>
              <button className="btn" type="button" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="btn primary" type="submit" disabled={busy || !(editing.email || "").trim()}>
                {busy ? "Saving…" : editing.id ? "Save contact" : "Add contact"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

/* ============================================================
   WEBHOOKS
   ============================================================ */

const WEBHOOK_EVENTS = [
  "email.delivered",
  "email.opened",
  "email.clicked",
  "email.bounced",
  "email.complained",
  "contact.subscribed",
  "contact.unsubscribed",
];

export function WebhooksPage({ token, onChanged }) {
  const confirm = useAppConfirm();
  const { rows, total, err, loading, load } = useEntity(token, "/api/webhooks");
  const wsOptions = useWorkspaceOptions(token);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);

  const stats = useMemo(() => {
    const active = rows.filter((w) => /active/i.test(w.status || "")).length;
    const success = rows.reduce((s, w) => s + (Number(w.success) || 0), 0);
    const failed = rows.reduce((s, w) => s + (Number(w.failed) || 0), 0);
    return { active, success, failed };
  }, [rows]);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    try {
      const body = {
        name: editing.name?.trim(),
        url: editing.url?.trim(),
        events: editing.events || [],
        status: editing.status || "Active",
        workspaceId: editing.workspaceId || undefined,
      };
      if (editing.id) await api(`/api/webhooks/${editing.id}`, { method: "PATCH", token, body });
      else await api("/api/webhooks", { method: "POST", token, body });
      setMsg(editing.id ? `Saved “${body.name}”` : `Created “${body.name}”`);
      setEditing(null);
      await load();
      onChanged?.();
    } catch (ex) {
      setMsg(redact(ex.message));
    } finally {
      setBusy(false);
    }
  }

  async function removeHook(w) {
    const ok = await confirm({
      title: "Delete webhook",
      message: `Delete endpoint “${w.name}”? The customer application stops receiving events immediately.`,
      danger: true,
      confirmLabel: "Delete webhook",
    });
    if (!ok) return;
    try {
      await api(`/api/webhooks/${w.id}`, { method: "DELETE", token });
      setMsg(`Deleted “${w.name}”`);
      await load();
      onChanged?.();
    } catch (ex) {
      setMsg(redact(ex.message));
    }
  }

  async function sendTest(w) {
    try {
      await api(`/api/webhooks/${w.id}/test`, { method: "POST", token });
      setMsg(`Queued test event to “${w.name}”`);
      await load();
      onChanged?.();
    } catch (ex) {
      setMsg(redact(ex.message));
    }
  }

  function toggleEvent(ev) {
    setEditing((f) => {
      const cur = new Set(f.events || []);
      cur.has(ev) ? cur.delete(ev) : cur.add(ev);
      return { ...f, events: [...cur] };
    });
  }

  return (
    <>
      <PageHead
        title="Webhooks"
        copy="Customer endpoints that receive delivery and audience events. URLs here are customer-owned targets — Senditto server addresses stay hidden."
        actions={
          <button
            className="btn primary"
            type="button"
            onClick={() => setEditing({ status: "Active", events: ["email.delivered", "email.bounced"] })}
          >
            <Plus size={15} /> Add webhook
          </button>
        }
      />
      {err ? <Banner tone="bad">{err}</Banner> : null}
      {msg ? <Banner tone="info">{msg}</Banner> : null}
      <StatGrid
        items={[
          { label: "Endpoints", value: fmtNum(total), hint: "All workspaces", icon: <Webhook size={16} /> },
          { label: "Active", value: fmtNum(stats.active), hint: "Receiving events", tone: "ok", icon: <BadgeCheck size={16} /> },
          { label: "Delivered events", value: fmtNum(stats.success), hint: "Successful posts", icon: <Send size={16} /> },
          { label: "Failed events", value: fmtNum(stats.failed), hint: "Will retry with backoff", tone: stats.failed ? "bad" : "", icon: <X size={16} /> },
        ]}
      />
      <Panel title="Endpoints" copy={`${fmtNum(total)} configured`}>
        <PagedDataTable
          rows={rows}
          empty="Webhook endpoints created in the product appear here."
          columns={[
            { key: "name", label: "Endpoint", render: (w) => <b>{w.name || "—"}</b> },
            { key: "url", label: "URL", mono: true, render: (w) => w.url || "—" },
            {
              key: "events",
              label: "Events",
              render: (w) =>
                (Array.isArray(w.events) ? w.events : []).length ? (
                  <span className="muted-sm">{(w.events || []).join(", ")}</span>
                ) : (
                  "—"
                ),
            },
            { key: "status", label: "Status", render: (w) => <StatusTag value={w.status} /> },
            {
              key: "health",
              label: "OK / failed",
              render: (w) => `${fmtNum(w.success || 0)} / ${fmtNum(w.failed || 0)}`,
            },
            { key: "workspace_name", label: "Workspace", render: (w) => w.workspace_name || "—" },
            {
              key: "menu",
              label: "",
              render: (w) => (
                <RowMenu
                  items={[
                    { id: "test", label: "Send test event", icon: <Send size={15} />, onClick: () => sendTest(w) },
                    { id: "edit", label: "Edit webhook", icon: <Link2 size={15} />, onClick: () => setEditing({ ...w, events: Array.isArray(w.events) ? w.events : [], workspaceId: w.workspace_id ? String(w.workspace_id) : "" }) },
                    {
                      id: "toggle",
                      label: /active/i.test(w.status || "") ? "Pause endpoint" : "Activate endpoint",
                      icon: <RefreshCw size={15} />,
                      onClick: async () => {
                        try {
                          await api(`/api/webhooks/${w.id}`, { method: "PATCH", token, body: { status: /active/i.test(w.status || "") ? "Paused" : "Active" } });
                          await load();
                          onChanged?.();
                        } catch (ex) {
                          setMsg(redact(ex.message));
                        }
                      },
                    },
                    { id: "del", label: "Delete…", icon: <Trash2 size={15} />, danger: true, onClick: () => removeHook(w) },
                  ]}
                />
              ),
            },
          ]}
        />
      </Panel>

      {editing ? (
        <Modal title={editing.id ? "Edit webhook" : "Add webhook"} onClose={() => setEditing(null)}>
          <form onSubmit={save}>
            <div className="form">
              <Field label="Name" full>
                <input
                  required
                  autoFocus
                  value={editing.name || ""}
                  onChange={(e) => setEditing((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Delivery events"
                />
              </Field>
              <Field label="Endpoint URL" full>
                <input
                  type="url"
                  required
                  value={editing.url || ""}
                  onChange={(e) => setEditing((f) => ({ ...f, url: e.target.value }))}
                  placeholder="https://api.customer-app.com/hooks/senditto"
                />
              </Field>
              <Field label="Status">
                <AppSelect
                  value={editing.status || "Active"}
                  onChange={(v) => setEditing((f) => ({ ...f, status: v }))}
                  options={["Active", "Paused"].map((s) => ({ value: s, label: s }))}
                />
              </Field>
              <Field label="Workspace">
                <AppSelect
                  value={editing.workspaceId || ""}
                  onChange={(v) => setEditing((f) => ({ ...f, workspaceId: v }))}
                  options={wsOptions}
                />
              </Field>
              <Field label="Events" full>
                <div className="ws-chip-row" style={{ flexWrap: "wrap" }}>
                  {WEBHOOK_EVENTS.map((ev) => (
                    <button
                      key={ev}
                      type="button"
                      className={`ws-chip ${(editing.events || []).includes(ev) ? "active" : ""}`}
                      onClick={() => toggleEvent(ev)}
                    >
                      {ev}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
            <div className="grant-actions" style={{ marginTop: 16 }}>
              <button className="btn" type="button" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button
                className="btn primary"
                type="submit"
                disabled={busy || !(editing.name || "").trim() || !(editing.url || "").trim()}
              >
                {busy ? "Saving…" : editing.id ? "Save webhook" : "Add webhook"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

/* ============================================================
   INTERNAL INBOX (operator ↔ user messages)
   ============================================================ */

export function InboxPage({ token, session, onChanged }) {
  const confirm = useAppConfirm();
  const { rows, total, err, loading, load } = useEntity(token, "/api/internal-messages");
  const wsOptions = useWorkspaceOptions(token);
  const [q, setQ] = useState("");
  const [channelFilter, setChannelFilter] = useState("all");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(null);
  const [compose, setCompose] = useState(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((m) => {
      if (channelFilter !== "all" && String(m.channel || "").toLowerCase() !== channelFilter) return false;
      if (!needle) return true;
      return `${m.subject || ""} ${m.to || ""} ${m.from || ""} ${m.body || ""} ${m.workspace_name || ""}`
        .toLowerCase()
        .includes(needle);
    });
  }, [rows, q, channelFilter]);

  const stats = useMemo(() => {
    const day = Date.now() - 24 * 3600 * 1000;
    return {
      email: rows.filter((m) => m.channel === "email" || m.channel === "both").length,
      internal: rows.filter((m) => m.channel === "internal" || m.channel === "both").length,
      recent: rows.filter((m) => new Date(m.created_at || 0).getTime() > day).length,
    };
  }, [rows]);

  async function send(e) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    try {
      await api("/api/internal-messages", {
        method: "POST",
        token,
        body: {
          channel: compose.channel || "internal",
          workspaceId: compose.workspaceId || undefined,
          to: compose.to?.trim(),
          subject: compose.subject?.trim(),
          body: compose.body || "",
          from: session?.user?.email || "operators@senditto",
        },
      });
      setMsg(`Message sent to ${compose.to}`);
      setCompose(null);
      await load();
      onChanged?.();
    } catch (ex) {
      setMsg(redact(ex.message));
    } finally {
      setBusy(false);
    }
  }

  async function removeMessage(m) {
    const ok = await confirm({
      title: "Delete message",
      message: `Delete the internal record of “${m.subject || "(no subject)"}”? Emails already delivered are not recalled.`,
      danger: true,
      confirmLabel: "Delete record",
    });
    if (!ok) return;
    try {
      await api(`/api/internal-messages/${m.id}`, { method: "DELETE", token });
      setMsg("Message record deleted");
      setDetail(null);
      await load();
      onChanged?.();
    } catch (ex) {
      setMsg(redact(ex.message));
    }
  }

  return (
    <>
      <PageHead
        title="Operator inbox"
        copy="Messages between platform operators and workspace owners — service notices, compliance answers, account help."
        actions={
          <button className="btn primary" type="button" onClick={() => setCompose({ channel: "internal" })}>
            <Send size={15} /> New message
          </button>
        }
      />
      {err ? <Banner tone="bad">{err}</Banner> : null}
      {msg ? <Banner tone="info">{msg}</Banner> : null}
      <StatGrid
        items={[
          { label: "Messages", value: fmtNum(total), hint: "All records", icon: <Inbox size={16} /> },
          { label: "Sent as email", value: fmtNum(stats.email), hint: "Delivered to the user's address", icon: <Mail size={16} /> },
          { label: "In-product", value: fmtNum(stats.internal), hint: "Shown inside the platform", icon: <Layers size={16} /> },
          { label: "Last 24h", value: fmtNum(stats.recent), hint: "Recent conversations", tone: "amber", icon: <RefreshCw size={16} /> },
        ]}
      />
      <Panel title="All messages" copy={`${fmtNum(filtered.length)} of ${fmtNum(total)}`}>
        <div className="ws-table-toolbar">
          <div className="tables-search-wrap wide">
            <Search size={14} className="tables-search-ico" />
            <input
              className="tables-search"
              placeholder="Search subject, recipient, body…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="ws-chip-row">
            {["all", "internal", "email", "both"].map((c) => (
              <button
                key={c}
                type="button"
                className={`ws-chip ${channelFilter === c ? "active" : ""}`}
                onClick={() => setChannelFilter(c)}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
        <PagedDataTable
          rows={filtered}
          resetKey={`${q}|${channelFilter}`}
          empty="Messages sent from the Workspaces page and this inbox appear here."
          onRowClick={(m) => setDetail(m)}
          columns={[
            { key: "subject", label: "Subject", render: (m) => <b>{m.subject || "(no subject)"}</b> },
            { key: "to", label: "To", render: (m) => m.to || "—" },
            { key: "from", label: "From", render: (m) => m.from || "—" },
            { key: "channel", label: "Channel", render: (m) => <span className="tag">{m.channel || "internal"}</span> },
            { key: "workspace_name", label: "Workspace", render: (m) => m.workspace_name || "—" },
            { key: "created_at", label: "Sent", render: (m) => fmtTime(m.created_at) },
          ]}
        />
      </Panel>

      {detail ? (
        <Modal title={detail.subject || "(no subject)"} wide onClose={() => setDetail(null)}>
          <div className="kv" style={{ marginBottom: 14 }}>
            <div>
              <span>To</span>
              <b>{detail.to || "—"}</b>
            </div>
            <div>
              <span>From</span>
              <b>{detail.from || "—"}</b>
            </div>
            <div>
              <span>Channel</span>
              <b>{detail.channel || "internal"}</b>
            </div>
            <div>
              <span>Workspace</span>
              <b>{detail.workspace_name || "—"}</b>
            </div>
            <div>
              <span>Sent</span>
              <b>{fmtTime(detail.created_at)}</b>
            </div>
          </div>
          <Panel title="Message">
            <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{detail.body || "—"}</p>
          </Panel>
          <div className="grant-actions" style={{ marginTop: 16 }}>
            <button
              className="btn"
              type="button"
              onClick={() => {
                setCompose({
                  channel: detail.channel || "internal",
                  to: detail.to,
                  workspaceId: detail.workspace_id ? String(detail.workspace_id) : "",
                  subject: detail.subject?.startsWith("Re:") ? detail.subject : `Re: ${detail.subject || ""}`,
                });
                setDetail(null);
              }}
            >
              <Send size={15} /> Reply
            </button>
            <button className="btn danger" type="button" onClick={() => removeMessage(detail)}>
              <Trash2 size={15} /> Delete record
            </button>
            <button className="btn" type="button" onClick={() => setDetail(null)}>
              Close
            </button>
          </div>
        </Modal>
      ) : null}

      {compose ? (
        <Modal title="New operator message" onClose={() => setCompose(null)}>
          <form onSubmit={send}>
            <div className="form">
              <Field label="To (email)" full>
                <input
                  type="email"
                  required
                  autoFocus
                  value={compose.to || ""}
                  onChange={(e) => setCompose((f) => ({ ...f, to: e.target.value }))}
                  placeholder="owner@customer.com"
                />
              </Field>
              <Field label="Channel">
                <AppSelect
                  value={compose.channel || "internal"}
                  onChange={(v) => setCompose((f) => ({ ...f, channel: v }))}
                  options={[
                    { value: "internal", label: "In-product only" },
                    { value: "email", label: "Email only" },
                    { value: "both", label: "In-product + email" },
                  ]}
                />
              </Field>
              <Field label="Workspace">
                <AppSelect
                  value={compose.workspaceId || ""}
                  onChange={(v) => setCompose((f) => ({ ...f, workspaceId: v }))}
                  options={wsOptions}
                />
              </Field>
              <Field label="Subject" full>
                <input
                  required
                  value={compose.subject || ""}
                  onChange={(e) => setCompose((f) => ({ ...f, subject: e.target.value }))}
                  placeholder="About your sending domain"
                />
              </Field>
              <Field label="Message" full>
                <textarea
                  rows={6}
                  required
                  value={compose.body || ""}
                  onChange={(e) => setCompose((f) => ({ ...f, body: e.target.value }))}
                  placeholder="Hello — a quick note from the Senditto operations team…"
                />
              </Field>
            </div>
            <div className="grant-actions" style={{ marginTop: 16 }}>
              <button className="btn" type="button" onClick={() => setCompose(null)}>
                Cancel
              </button>
              <button
                className="btn primary"
                type="submit"
                disabled={busy || !(compose.to || "").trim() || !(compose.subject || "").trim()}
              >
                {busy ? "Sending…" : "Send message"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

/* ============================================================
   WORKSPACE ROLES MATRIX
   ============================================================ */

export function WorkspaceMatrixPage({ token, onChanged }) {
  const confirm = useAppConfirm();
  const [matrix, setMatrix] = useState(() => cloneWorkspaceMatrix());
  const [serverMatrix, setServerMatrix] = useState(() => cloneWorkspaceMatrix());
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const data = await api("/api/roles/workspace-matrix", { token });
        if (dead) return;
        const m = cloneWorkspaceMatrix({ ...DEFAULT_WORKSPACE_MATRIX, ...(data.matrix || {}) });
        setMatrix(m);
        setServerMatrix(cloneWorkspaceMatrix(m));
        setErr("");
      } catch (ex) {
        if (!dead) setErr(redact(ex.message));
      }
    })();
    return () => {
      dead = true;
    };
  }, [token]);

  const dirty = useMemo(() => JSON.stringify(matrix) !== JSON.stringify(serverMatrix), [matrix, serverMatrix]);

  function toggle(roleId, permId) {
    if (roleId === "ws_owner") return;
    setMatrix((m) => ({
      ...m,
      [roleId]: { ...(m[roleId] || {}), [permId]: !m[roleId]?.[permId] },
    }));
  }

  async function save() {
    const ok = await confirm({
      title: "Save workspace role defaults",
      message:
        "Apply these defaults to every workspace on the platform?\n\nWorkspace owners always keep full access. Changes affect what new members can do.",
      confirmLabel: "Save defaults",
    });
    if (!ok) return;
    setBusy(true);
    setMsg("");
    try {
      await api("/api/roles/workspace-matrix", { method: "PUT", token, body: { matrix } });
      setServerMatrix(cloneWorkspaceMatrix(matrix));
      setMsg("Workspace role defaults saved");
      onChanged?.();
    } catch (ex) {
      setMsg(redact(ex.message));
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    const ok = await confirm({
      title: "Restore factory defaults",
      message: "Restore the built-in workspace role defaults?",
      danger: true,
      confirmLabel: "Restore defaults",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api("/api/roles/workspace-matrix/reset", { method: "POST", token });
      const m = cloneWorkspaceMatrix();
      setMatrix(m);
      setServerMatrix(cloneWorkspaceMatrix(m));
      setMsg("Restored factory defaults");
      onChanged?.();
    } catch (ex) {
      setMsg(redact(ex.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead
        title="Workspace roles"
        copy="Default member permissions inside every customer workspace. Platform roles (Matrix page) control this studio; these control the product."
        actions={
          <>
            <button className="btn" type="button" onClick={reset} disabled={busy}>
              Restore defaults
            </button>
            <button className="btn primary" type="button" onClick={save} disabled={busy || !dirty}>
              <ShieldCheck size={15} /> {dirty ? "Save changes" : "Saved"}
            </button>
          </>
        }
      />
      {err ? <Banner tone="bad">{err}</Banner> : null}
      {msg ? <Banner tone="info">{msg}</Banner> : null}
      <Panel
        title="Default permission grid"
        copy="Workspace owner is locked to full access — the account holder can never lose control of their own workspace."
      >
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Permission</th>
                {WORKSPACE_ROLES.map((r) => (
                  <th key={r.id} title={r.description}>
                    {r.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {WORKSPACE_PERMISSIONS.map((p) => (
                <tr key={p.id}>
                  <td>
                    <b>{p.label}</b>
                    <div className="muted-sm mono">{p.id}</div>
                  </td>
                  {WORKSPACE_ROLES.map((r) => {
                    const on = r.id === "ws_owner" ? true : !!matrix[r.id]?.[p.id];
                    const locked = r.id === "ws_owner";
                    return (
                      <td key={r.id}>
                        <button
                          type="button"
                          className={`btn sm ${on ? "primary" : ""}`}
                          style={locked ? { opacity: 0.7, cursor: "not-allowed" } : undefined}
                          title={locked ? "Workspace owners always have full access" : `Toggle ${p.label} for ${r.label}`}
                          onClick={() => toggle(r.id, p.id)}
                          disabled={locked || busy}
                        >
                          {on ? "Allowed" : "—"}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Roles" copy="What each workspace role is for.">
        <div className="kv">
          {WORKSPACE_ROLES.map((r) => (
            <div key={r.id}>
              <span>{r.label}</span>
              <b>{r.description}</b>
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}
