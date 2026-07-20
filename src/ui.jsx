import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Copy } from "lucide-react";
import { fmt, fmtTime } from "./api.js";

/** Copy text to the clipboard. Returns true on success. */
export async function copyToClipboard(text) {
  const value = text == null ? "" : String(text);
  if (!value) return false;
  await navigator.clipboard.writeText(value);
  return true;
}

/**
 * Shared copy control: icon flips to a light-green checkmark after a successful copy.
 * Use anywhere a “Copy …” action is shown.
 */
export function CopyButton({
  text,
  getText,
  label = "Copy",
  copiedLabel = "Copied",
  description,
  className = "btn sm",
  title,
  iconSize = 14,
  showLabel = true,
  labelAs: LabelTag = "span",
  onCopied,
  onError,
  disabled = false,
  stopPropagation = true,
}) {
  const [ok, setOk] = useState(false);
  const timerRef = useRef(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  async function handleClick(e) {
    if (stopPropagation) e?.stopPropagation?.();
    if (disabled) return;
    const value = typeof getText === "function" ? getText() : text;
    if (value == null || String(value) === "") return;
    try {
      await copyToClipboard(value);
      setOk(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setOk(false), 1600);
      onCopied?.(String(value));
    } catch (err) {
      setOk(false);
      onError?.(err);
    }
  }

  return (
    <button
      type="button"
      className={`copy-btn ${ok ? "is-copied" : ""} ${className}`.trim()}
      title={ok ? copiedLabel : title || label}
      aria-label={ok ? copiedLabel : title || label}
      onClick={handleClick}
      disabled={disabled}
    >
      {ok ? (
        <Check size={iconSize} strokeWidth={2.6} className="copy-btn-check" aria-hidden />
      ) : (
        <Copy size={iconSize} className="copy-btn-ico" aria-hidden />
      )}
      {showLabel ? <LabelTag className="copy-btn-label">{ok ? copiedLabel : label}</LabelTag> : null}
      {description != null ? <span className="copy-btn-desc">{description}</span> : null}
    </button>
  );
}

/** Hook for menus / multi-control pages that share one “which key was copied” flash. */
export function useCopyFeedback(ms = 1600) {
  const [copiedKey, setCopiedKey] = useState("");
  const timerRef = useRef(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  const markCopied = useCallback(
    (key = "default") => {
      setCopiedKey(key);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopiedKey(""), ms);
    },
    [ms]
  );

  const copy = useCallback(
    async (text, key = "default") => {
      try {
        await copyToClipboard(text);
        markCopied(key);
        return true;
      } catch {
        return false;
      }
    },
    [markCopied]
  );

  const isCopied = useCallback((key = "default") => copiedKey === key, [copiedKey]);

  /** Icon for menus: green check when this key was just copied. */
  const copyIcon = useCallback(
    (key, size = 15) =>
      isCopied(key) ? (
        <Check size={size} strokeWidth={2.6} className="copy-menu-check" />
      ) : (
        <Copy size={size} />
      ),
    [isCopied]
  );

  return { copiedKey, isCopied, copy, markCopied, copyIcon };
}

/** Host for in-app overlays — dedicated layer inside the product, not the grid shell. */
function getAppHost() {
  return (
    document.getElementById("app-layer") ||
    document.querySelector(".app") ||
    document.getElementById("root") ||
    document.body
  );
}

/** Ensure only one AppSelect menu is open at a time (prevents stacked/double menus). */
let closeOpenSelect = null;
function registerOpenSelect(closeFn) {
  if (closeOpenSelect && closeOpenSelect !== closeFn) closeOpenSelect();
  closeOpenSelect = closeFn;
}
function unregisterOpenSelect(closeFn) {
  if (closeOpenSelect === closeFn) closeOpenSelect = null;
}

const ConfirmContext = createContext(null);

/**
 * All popups/dropdowns live inside the project shell (.app / #root).
 * Never use window.confirm / native OS select menus.
 */
export function AppDialogsProvider({ children }) {
  const [confirmState, setConfirmState] = useState(null);

  const confirm = useCallback((opts) => {
    const message = typeof opts === "string" ? opts : opts?.message || "";
    const title = typeof opts === "string" ? "Please confirm" : opts?.title || "Please confirm";
    const danger = typeof opts === "string" ? false : !!opts?.danger;
    const confirmLabel = typeof opts === "string" ? "Confirm" : opts?.confirmLabel || "Confirm";
    const cancelLabel = typeof opts === "string" ? "Cancel" : opts?.cancelLabel || "Cancel";
    return new Promise((resolve) => {
      setConfirmState({ title, message, danger, confirmLabel, cancelLabel, resolve });
    });
  }, []);

  const closeConfirm = useCallback(
    (ok) => {
      confirmState?.resolve?.(ok);
      setConfirmState(null);
    },
    [confirmState]
  );

  const host = typeof document !== "undefined" ? getAppHost() : null;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {confirmState && host
        ? createPortal(
            <div className="app-overlay app-confirm" role="dialog" aria-modal="true" aria-labelledby="app-confirm-title">
              <button type="button" className="app-overlay-backdrop" aria-label="Cancel" onClick={() => closeConfirm(false)} />
              <div className="app-overlay-card app-confirm-card">
                <h3 id="app-confirm-title">{confirmState.title}</h3>
                <p>{confirmState.message}</p>
                <div className="app-confirm-actions">
                  <button type="button" className="btn" onClick={() => closeConfirm(false)}>
                    {confirmState.cancelLabel}
                  </button>
                  <button
                    type="button"
                    className={`btn ${confirmState.danger ? "danger" : "primary"}`}
                    onClick={() => closeConfirm(true)}
                    autoFocus
                  >
                    {confirmState.confirmLabel}
                  </button>
                </div>
              </div>
            </div>,
            host
          )
        : null}
    </ConfirmContext.Provider>
  );
}

export function useAppConfirm() {
  const fn = useContext(ConfirmContext);
  return fn || (async () => false);
}

function normalizeOptions(options) {
  return (options || []).map((o) =>
    typeof o === "string" || typeof o === "number"
      ? { value: String(o), label: String(o) }
      : { value: String(o.value), label: o.label ?? String(o.value) }
  );
}

/** In-app dropdown — one menu only, portaled into #app-layer (not the app grid). */
export function AppSelect({
  value,
  onChange,
  options = [],
  className = "",
  "aria-label": ariaLabel,
  placeholder = "Select…",
  size = "md",
  disabled = false,
}) {
  const opts = useMemo(() => normalizeOptions(options), [options]);
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState(null);
  const rootRef = useRef(null);
  const menuRef = useRef(null);
  const listId = useId();
  const current = opts.find((o) => o.value === String(value));
  const closeSelf = useCallback(() => setOpen(false), []);

  const placeMenu = useCallback(() => {
    if (!rootRef.current) return;
    const host = getAppHost();
    const hostRect = host.getBoundingClientRect();
    const btnRect = rootRef.current.getBoundingClientRect();
    const menuMax = 220;
    const gap = 4;
    const spaceBelow = hostRect.bottom - btnRect.bottom - 8;
    const spaceAbove = btnRect.top - hostRect.top - 8;
    const openUp = spaceBelow < 140 && spaceAbove > spaceBelow;
    const maxH = Math.max(96, Math.min(menuMax, openUp ? spaceAbove : spaceBelow));
    const width = Math.max(btnRect.width, 128);
    let left = btnRect.left - hostRect.left;
    if (left + width > hostRect.width - 8) left = Math.max(8, hostRect.width - width - 8);
    if (left < 8) left = 8;

    // Position from trigger edges (not a fixed maxH block) so we never get a double “ghost” frame
    const style = openUp
      ? {
          position: "absolute",
          left,
          width,
          maxHeight: maxH,
          bottom: hostRect.bottom - btnRect.top + gap,
          top: "auto",
        }
      : {
          position: "absolute",
          left,
          width,
          maxHeight: maxH,
          top: btnRect.bottom - hostRect.top + gap,
          bottom: "auto",
        };
    setMenuStyle(style);
  }, []);

  useEffect(() => {
    if (!open) {
      unregisterOpenSelect(closeSelf);
      setMenuStyle(null);
      return undefined;
    }
    registerOpenSelect(closeSelf);
    const onDoc = (e) => {
      if (rootRef.current?.contains(e.target)) return;
      if (menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onReposition = () => placeMenu();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReposition);
    document.querySelector(".content")?.addEventListener("scroll", onReposition, true);
    document.querySelector(".tables-side-list")?.addEventListener("scroll", onReposition, true);
    return () => {
      unregisterOpenSelect(closeSelf);
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReposition);
      document.querySelector(".content")?.removeEventListener("scroll", onReposition, true);
      document.querySelector(".tables-side-list")?.removeEventListener("scroll", onReposition, true);
    };
  }, [open, placeMenu, closeSelf]);

  useLayoutEffect(() => {
    if (open) placeMenu();
  }, [open, placeMenu, opts.length, value]);

  const host = typeof document !== "undefined" ? getAppHost() : null;
  const menu =
    open && host && menuStyle
      ? createPortal(
          <ul
            id={listId}
            className="app-select-menu app-select-menu-portal"
            role="listbox"
            ref={menuRef}
            tabIndex={-1}
            style={menuStyle}
          >
            {opts.map((o) => {
              const selected = o.value === String(value);
              return (
                <li key={o.value} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    className={selected ? "active" : ""}
                    onClick={() => {
                      onChange?.(o.value);
                      setOpen(false);
                    }}
                  >
                    <span>{o.label}</span>
                    {selected ? <Check size={14} /> : null}
                  </button>
                </li>
              );
            })}
          </ul>,
          host
        )
      : null;

  return (
    <div
      className={`app-select ${size === "sm" ? "sm" : ""} ${open ? "open" : ""} ${className}`.trim()}
      ref={rootRef}
    >
      <button
        type="button"
        className="app-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          if (disabled) return;
          setOpen((v) => !v);
        }}
      >
        <span className={current ? "" : "app-select-placeholder"}>{current?.label || placeholder}</span>
        <ChevronDown size={14} className="app-select-chevron" aria-hidden />
      </button>
      {menu}
    </div>
  );
}

export function Pill({ ok, label }) {
  const cls = ok === true ? "ok" : ok === false ? "bad" : "warn";
  return (
    <span className={`pill ${cls}`}>
      <i />
      {label}
    </span>
  );
}

export function Banner({ tone = "info", children }) {
  const t = tone === "bad" ? "bad" : tone === "ok" ? "ok" : tone === "warn" ? "warn" : "";
  return <div className={`banner ${t}`.trim()}>{children}</div>;
}

export function PageHead({ title, copy, actions }) {
  return (
    <div className="page-head">
      <div>
        <h2 className="page-title">{title}</h2>
        {copy ? <p className="page-copy">{copy}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}

export function StatGrid({ items }) {
  return (
    <div className="stat-grid">
      {items.map((it) => (
        <article key={it.label} className={`stat-card tone-${it.tone || "blue"}`}>
          <div className="stat-top">
            <small>{it.label}</small>
            {it.icon ? <span className="stat-ico">{it.icon}</span> : null}
          </div>
          <b>{it.value}</b>
          {it.hint ? <em>{it.hint}</em> : null}
          {it.bar != null ? (
            <div className="stat-bar">
              <i style={{ width: `${Math.max(0, Math.min(100, it.bar))}%` }} />
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

export function Panel({ title, copy, actions, children, className = "" }) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <div className="panel-head">
          <div>
            {title ? <h3>{title}</h3> : null}
            {copy ? <p>{copy}</p> : null}
          </div>
          {actions ? <div className="panel-actions">{actions}</div> : null}
        </div>
      )}
      {children}
    </section>
  );
}

/** Max rows shown per page / auto-height cap for inventory tables */
export const TABLE_PAGE_SIZE = 20;
export const TABLE_ROW_H = 48;
export const TABLE_HEAD_H = 44;

/** Normalize row ids so Set membership is stable across number/string APIs. */
export function bulkId(id) {
  if (id == null || id === "") return null;
  return String(id);
}

/**
 * Multi-select for inventory tables. Selection is kept across pages until cleared
 * or until resetKey changes (filters).
 */
export function useBulkSelection(pageRows = [], { getId = (r) => r?.id, resetKey = "" } = {}) {
  const [selected, setSelected] = useState(() => new Set());

  useEffect(() => {
    setSelected(new Set());
  }, [resetKey]);

  const resolveId = useCallback(
    (rowOrId) => {
      if (rowOrId != null && typeof rowOrId === "object") return bulkId(getId(rowOrId));
      return bulkId(rowOrId);
    },
    [getId]
  );

  const idsOnPage = useMemo(
    () => (pageRows || []).map((r) => bulkId(getId(r))).filter(Boolean),
    [pageRows, getId]
  );

  const allPageSelected = idsOnPage.length > 0 && idsOnPage.every((id) => selected.has(id));
  const somePageSelected = idsOnPage.some((id) => selected.has(id));

  const toggle = useCallback((id) => {
    const key = bulkId(id);
    if (!key) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const togglePage = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      const every = idsOnPage.length > 0 && idsOnPage.every((id) => next.has(id));
      if (every) idsOnPage.forEach((id) => next.delete(id));
      else idsOnPage.forEach((id) => next.add(id));
      return next;
    });
  }, [idsOnPage]);

  const clear = useCallback(() => setSelected(new Set()), []);

  const selectAll = useCallback(
    (allRows) => {
      const ids = (allRows || []).map((r) => bulkId(getId(r))).filter(Boolean);
      setSelected(new Set(ids));
    },
    [getId]
  );

  const isSelected = useCallback((id) => selected.has(bulkId(id)), [selected]);

  const selectedIds = useMemo(() => [...selected], [selected]);

  return {
    selected,
    selectedIds,
    count: selected.size,
    isSelected,
    toggle,
    togglePage,
    clear,
    selectAll,
    allPageSelected,
    somePageSelected,
    setSelected,
    resolveId,
  };
}

/** Header checkbox for “select all on this page”. */
export function BulkSelectHeader({ checked, indeterminate, onChange, label = "Select all on this page" }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!(indeterminate && !checked);
  }, [indeterminate, checked]);
  return (
    <th className="bulk-col" scope="col" title={label}>
      <label
        className="bulk-check"
        title={label}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <input
          ref={ref}
          type="checkbox"
          checked={!!checked}
          onChange={(e) => {
            e.stopPropagation();
            onChange?.(e);
          }}
          onClick={(e) => e.stopPropagation()}
          aria-label={label}
        />
      </label>
    </th>
  );
}

/** Row checkbox cell — stops row click navigation. */
export function BulkSelectCell({ checked, onChange, label = "Select row" }) {
  return (
    <td
      className="bulk-col"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <label className="bulk-check" title={label}>
        <input
          type="checkbox"
          checked={!!checked}
          onChange={(e) => {
            e.stopPropagation();
            onChange?.(e);
          }}
          onClick={(e) => e.stopPropagation()}
          aria-label={label}
        />
      </label>
    </td>
  );
}

/**
 * Always-visible bulk selection + actions bar above inventory tables.
 * Select page / select all filtered stay available even with 0 selected;
 * action buttons (children) enable when count > 0.
 */
export function BulkBar({
  count = 0,
  onClear,
  onSelectPage,
  onSelectAll,
  pageCount = 0,
  filteredCount = 0,
  allPageSelected = false,
  children,
  noun = "selected",
  emptyHint = "Use the checkboxes to select rows, then run bulk actions.",
}) {
  const hasSelection = count > 0;
  const pageLabel = pageCount === 1 ? "1 on page" : `${pageCount} on page`;
  const allLabel =
    filteredCount === 1 ? "1 filtered" : `${filteredCount} filtered`;
  const allFilteredSelected = hasSelection && filteredCount > 0 && count >= filteredCount;

  return (
    <div
      className={`bulk-bar ${hasSelection ? "has-selection" : "is-idle"}`}
      role="toolbar"
      aria-label="Bulk selection and actions"
    >
      <div className="bulk-bar-meta">
        <span className={`bulk-bar-count ${hasSelection ? "active" : ""}`}>
          {hasSelection ? (
            <>
              <b>{count}</b> {noun}
            </>
          ) : (
            <>
              <b>0</b> selected
            </>
          )}
        </span>
        {pageCount > 0 ? (
          <button
            type="button"
            className="btn sm bulk-select-btn"
            onClick={onSelectPage}
            title="Select or deselect every row on this page"
          >
            {allPageSelected ? "Deselect page" : `Select page (${pageLabel})`}
          </button>
        ) : null}
        {filteredCount > 0 ? (
          <button
            type="button"
            className="btn sm bulk-select-btn"
            onClick={onSelectAll}
            title="Select every row matching the current filters"
            disabled={allFilteredSelected}
          >
            Select all ({allLabel})
          </button>
        ) : null}
        {hasSelection ? (
          <button type="button" className="btn sm" onClick={onClear}>
            Clear
          </button>
        ) : null}
        {!hasSelection && emptyHint ? (
          <span className="bulk-bar-hint">{emptyHint}</span>
        ) : null}
      </div>
      {children ? (
        <div className={`bulk-bar-actions ${hasSelection ? "" : "is-disabled"}`} aria-disabled={!hasSelection}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** Run async work for many ids with settled results. */
export async function runBulk(ids, worker) {
  const list = [...ids];
  const results = await Promise.allSettled(list.map((id) => worker(id)));
  let ok = 0;
  let fail = 0;
  const errors = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") ok += 1;
    else {
      fail += 1;
      errors.push({ id: list[i], error: r.reason?.message || String(r.reason || "failed") });
    }
  });
  return { ok, fail, errors, total: list.length };
}

/**
 * Client-side pagination for table inventories (max 20 per page by default).
 * @param {unknown[]} rows
 * @param {{ resetKey?: string|number, pageSize?: number }} [opts]
 */
export function useClientPager(rows, { resetKey = "", pageSize = TABLE_PAGE_SIZE } = {}) {
  const [page, setPage] = useState(1);
  const list = Array.isArray(rows) ? rows : [];
  const pageCount = Math.max(1, Math.ceil(list.length / pageSize) || 1);

  useEffect(() => {
    setPage(1);
  }, [resetKey, pageSize]);

  useEffect(() => {
    setPage((p) => Math.min(Math.max(1, p), pageCount));
  }, [pageCount]);

  const safePage = Math.min(Math.max(1, page), pageCount);
  const pageRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return list.slice(start, start + pageSize);
  }, [list, safePage, pageSize]);

  const pageNumbers = useMemo(() => {
    const total = pageCount;
    const cur = safePage;
    if (total <= 9) return Array.from({ length: total }, (_, i) => i + 1);
    const set = new Set([1, total, cur, cur - 1, cur + 1, cur - 2, cur + 2]);
    const nums = [...set].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i < nums.length; i++) {
      if (i > 0 && nums[i] - nums[i - 1] > 1) out.push("…");
      out.push(nums[i]);
    }
    return out;
  }, [pageCount, safePage]);

  const from = list.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, list.length);
  const middlePage = Math.max(1, Math.ceil(pageCount / 2));

  return {
    page: safePage,
    setPage,
    pageSize,
    pageCount,
    pageRows,
    pageNumbers,
    total: list.length,
    from,
    to,
    middlePage,
    goFirst: () => setPage(1),
    goMiddle: () => setPage(middlePage),
    goLast: () => setPage(pageCount),
    goPrev: () => setPage((p) => Math.max(1, p - 1)),
    goNext: () => setPage((p) => Math.min(pageCount, p + 1)),
  };
}

/**
 * Table window in normal document flow (always below page content above it).
 * - Auto height = natural content height (3 rows → short, not empty 20-row box)
 * - Cap at measured height of up to 20 real rows (then internal scroll)
 * - Optional drag grip to grow/shrink within min…max
 */
export function TableShell({ rowCount = 0, children, className = "" }) {
  const scrollRef = useRef(null);
  const dragRef = useRef(null);
  const [manualH, setManualH] = useState(null);
  const [naturalH, setNaturalH] = useState(null);
  const [capH, setCapH] = useState(TABLE_HEAD_H + TABLE_PAGE_SIZE * TABLE_ROW_H);
  const n = Math.max(0, Number(rowCount) || 0);

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const table = el.querySelector("table");
    if (!table) return;
    const head = el.querySelector("thead");
    const headH = head ? head.getBoundingClientRect().height : TABLE_HEAD_H;
    const rows = el.querySelectorAll("tbody tr");
    let rowH = TABLE_ROW_H;
    if (rows[0]) {
      const r = rows[0].getBoundingClientRect().height;
      if (r > 0) rowH = r;
    }
    // Natural height of whatever is on this page (≤ 20 rows)
    const full = table.getBoundingClientRect().height;
    const natural = full > 0 ? Math.ceil(full) : headH + Math.max(n, 1) * rowH;
    // Cap = header + up to 20 real row heights
    const cap = Math.ceil(headH + TABLE_PAGE_SIZE * rowH);
    setNaturalH(natural);
    setCapH(Math.max(cap, headH + rowH));
  }, [n]);

  useLayoutEffect(() => {
    setManualH(null);
    // Measure after paint so multi-line rows (users, etc.) size correctly
    const id = requestAnimationFrame(() => measure());
    return () => cancelAnimationFrame(id);
  }, [n, children, measure]);

  useEffect(() => {
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [measure]);

  const minH = Math.max(TABLE_HEAD_H + TABLE_ROW_H, Math.min(naturalH || 0, capH) || TABLE_HEAD_H + TABLE_ROW_H);
  // Auto: use natural content height, never larger than 20-row cap
  const autoH = naturalH != null ? Math.min(naturalH, capH) : null;
  const applied =
    manualH != null
      ? Math.min(capH, Math.max(minH, manualH))
      : autoH;

  function onResizeStart(e) {
    e.preventDefault();
    const startY = e.clientY;
    const startH = applied ?? minH;
    dragRef.current = { startY, startH };
    const onMove = (ev) => {
      if (!dragRef.current) return;
      const dy = ev.clientY - dragRef.current.startY;
      setManualH(Math.min(capH, Math.max(minH, dragRef.current.startH + dy)));
    };
    const onUp = () => {
      dragRef.current = null;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  // Auto mode: height auto (natural), maxHeight = 20-row cap — nothing covers content above.
  // Manual resize: fixed height within min…cap.
  const scrollStyle =
    manualH != null
      ? { height: applied, maxHeight: capH }
      : {
          height: "auto",
          maxHeight: capH,
        };

  return (
    <div className={`table-shell-window ${className}`.trim()}>
      <div ref={scrollRef} className="table-shell-scroll" style={scrollStyle}>
        {children}
      </div>
      <button
        type="button"
        className="table-resize-grip"
        title="Drag to resize table height (max 20 rows)"
        aria-label="Resize table height"
        onPointerDown={onResizeStart}
      >
        <span className="table-resize-lines" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <small>Drag to resize</small>
      </button>
    </div>
  );
}

/**
 * Separate pager window below the table (not joined to the table chrome).
 * Beginning · Middle · Last + page numbers + prev/next.
 */
export function TablePager({
  page,
  pageCount,
  total,
  from,
  to,
  pageNumbers = [],
  middlePage,
  onPageChange,
  onFirst,
  onMiddle,
  onLast,
  onPrev,
  onNext,
}) {
  if (!total) return null;
  const pc = Math.max(1, pageCount || 1);
  const cur = Math.min(Math.max(1, page || 1), pc);
  const mid = middlePage || Math.max(1, Math.ceil(pc / 2));

  return (
    <div className="table-pager-window" role="navigation" aria-label="Table pages">
      <div className="table-pager-meta">
        {from != null && to != null ? (
          <>
            <b>
              {from}–{to}
            </b>
            <span> of {total.toLocaleString()}</span>
          </>
        ) : (
          <span>{total.toLocaleString()} rows</span>
        )}
        <span className="table-pager-sep">·</span>
        <span>
          Page {cur} of {pc}
        </span>
      </div>

      <div className="table-pager-jumps">
        <button
          type="button"
          className="btn sm"
          disabled={cur <= 1}
          onClick={() => (onFirst ? onFirst() : onPageChange?.(1))}
          title="Go to first page"
        >
          Beginning
        </button>
        <button
          type="button"
          className="btn sm"
          disabled={pc <= 1 || cur === mid}
          onClick={() => (onMiddle ? onMiddle() : onPageChange?.(mid))}
          title={`Go to middle (page ${mid})`}
        >
          Middle
        </button>
        <button
          type="button"
          className="btn sm"
          disabled={cur >= pc}
          onClick={() => (onLast ? onLast() : onPageChange?.(pc))}
          title="Go to last page"
        >
          Last
        </button>
      </div>

      <div className="table-pager-controls">
        <button
          type="button"
          className="btn sm"
          disabled={cur <= 1}
          onClick={() => (onPrev ? onPrev() : onPageChange?.(cur - 1))}
          title="Previous page"
        >
          ‹ Prev
        </button>
        <div className="table-page-numbers">
          {(pageNumbers.length
            ? pageNumbers
            : Array.from({ length: pc }, (_, i) => i + 1)
          ).map((n, i) =>
            n === "…" ? (
              <span key={`e-${i}`} className="table-page-ellipsis">
                …
              </span>
            ) : (
              <button
                key={n}
                type="button"
                className={`table-page-num ${n === cur ? "active" : ""}`}
                onClick={() => onPageChange?.(n)}
                aria-current={n === cur ? "page" : undefined}
              >
                {n}
              </button>
            )
          )}
        </div>
        <button
          type="button"
          className="btn sm"
          disabled={cur >= pc}
          onClick={() => (onNext ? onNext() : onPageChange?.(cur + 1))}
          title="Next page"
        >
          Next ›
        </button>
      </div>
    </div>
  );
}

/** Convenience: DataTable + TableShell + separate TablePager */
export function PagedDataTable({
  rows,
  columns,
  empty = "No rows yet",
  onRowClick,
  className = "",
  resetKey = "",
  pageSize = TABLE_PAGE_SIZE,
}) {
  const pager = useClientPager(rows, { resetKey, pageSize });
  if (!rows?.length) {
    return (
      <div className="empty">
        {typeof empty === "string" ? (
          <>
            <b>Nothing here yet</b>
            {empty}
          </>
        ) : (
          empty
        )}
      </div>
    );
  }
  return (
    <div className="paged-table-stack">
      <TableShell rowCount={pager.pageRows.length} className={className}>
        <DataTable rows={pager.pageRows} columns={columns} onRowClick={onRowClick} bare />
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
  );
}

export function DataTable({ rows, columns, empty = "No rows yet", onRowClick, className = "", bare = false }) {
  if (!rows?.length) {
    return (
      <div className="empty">
        {typeof empty === "string" ? (
          <>
            <b>Nothing here yet</b>
            {empty}
          </>
        ) : (
          empty
        )}
      </div>
    );
  }
  const cols =
    columns ||
    Object.keys(rows[0]).map((k) => ({
      key: k,
      label: k,
      render: (r) => fmt(r[k]),
    }));
  const table = (
    <table className="data">
      <thead>
        <tr>
          {cols.map((c) => (
            <th key={c.key}>{c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr
            key={r.id || `${i}`}
            className={onRowClick ? "clickable" : ""}
            onClick={() => onRowClick?.(r)}
          >
            {cols.map((c) => (
              <td key={c.key} className={c.mono ? "mono" : ""}>
                {c.render ? c.render(r) : fmt(r[c.key])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
  if (bare) return table;
  return <div className={`table-wrap ${className}`.trim()}>{table}</div>;
}

/** Simple horizontal bar chart */
export function BarChart({ items = [], valueKey = "n", labelKey = "label", color = "#2476f3" }) {
  const max = Math.max(1, ...items.map((x) => Number(x[valueKey] || 0)));
  if (!items.length) return <div className="empty">No chart data yet</div>;
  return (
    <div className="bar-chart">
      {items.map((it, i) => {
        const v = Number(it[valueKey] || 0);
        const pct = Math.round((v / max) * 100);
        return (
          <div className="bar-row" key={i}>
            <span className="bar-label">{it[labelKey] ?? it.stream ?? it.status ?? it.level ?? it.role ?? it.name}</span>
            <div className="bar-track">
              <i style={{ width: `${pct}%`, background: color }} />
            </div>
            <b className="bar-val">{v.toLocaleString()}</b>
          </div>
        );
      })}
    </div>
  );
}

/** 7-day activity columns */
export function ActivityChart({ days = [] }) {
  if (!days.length) return <div className="empty">No activity window</div>;
  const max = Math.max(1, ...days.map((d) => Number(d.messages || 0) + Number(d.audits || 0)));
  return (
    <div className="act-chart">
      {days.map((d, i) => {
        const m = Number(d.messages || 0);
        const a = Number(d.audits || 0);
        const label = d.day ? String(d.day).slice(5, 10) : `D${i + 1}`;
        return (
          <div className="act-col" key={i} title={`${label}: ${m} messages, ${a} audits`}>
            <div className="act-stack">
              <i className="msg" style={{ height: `${(m / max) * 100}%` }} />
              <i className="aud" style={{ height: `${(a / max) * 100}%` }} />
            </div>
            <span>{label}</span>
          </div>
        );
      })}
    </div>
  );
}

export function Donut({ segments = [], size = 120 }) {
  const total = Math.max(1, segments.reduce((s, x) => s + Number(x.value || 0), 0));
  let acc = 0;
  const stops = segments.map((seg) => {
    const start = (acc / total) * 100;
    acc += Number(seg.value || 0);
    const end = (acc / total) * 100;
    return `${seg.color} ${start}% ${end}%`;
  });
  const bg = stops.length ? `conic-gradient(${stops.join(", ")})` : "#e8eef6";
  return (
    <div className="donut-wrap">
      <div className="donut" style={{ width: size, height: size, background: bg }}>
        <div className="donut-hole">
          <b>{total === 1 && !segments.some((s) => s.value) ? "0" : total.toLocaleString()}</b>
          <small>total</small>
        </div>
      </div>
      <div className="donut-legend">
        {segments.map((s) => (
          <div key={s.label}>
            <i style={{ background: s.color }} />
            <span>{s.label}</span>
            <b>{Number(s.value || 0).toLocaleString()}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Field({ label, children, full }) {
  return (
    <label className={full ? "full" : undefined}>
      <span className="lbl">{label}</span>
      {children}
    </label>
  );
}

export function Modal({ title, children, onClose, wide }) {
  const host = typeof document !== "undefined" ? getAppHost() : null;

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!host) return null;

  return createPortal(
    <div className="app-overlay modal" role="dialog" aria-modal="true">
      <button className="app-overlay-backdrop modal-backdrop" type="button" aria-label="Close" onClick={onClose} />
      <div className={`app-overlay-card modal-card ${wide ? "wide" : ""}`}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button type="button" className="btn ghost" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>,
    host
  );
}

export { fmt, fmtTime };
