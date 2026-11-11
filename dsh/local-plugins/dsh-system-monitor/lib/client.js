/**
 * dsh-system-monitor — client half.
 *
 * Hand-written bundle in the shell's ModuleLoader wrapper (the profile ships no
 * React/TS toolchain; the shell seeds react/react-dom as static modules).
 *
 * Contributions:
 *   - `main` (key `dsh-system-monitor`) — the live monitor page.
 *   - `sidebar.panellist` — its sidebar entry, ordered above every other
 *     panel icon (`order: -100`, ahead of the shipped 0/10 entries).
 *
 * Data comes from the host half's `/dsh-system-monitor/snapshot` route, polled
 * on an interval and paused while the tab is hidden.
 */
window.__ModuleLoader__.load({
  id: "dsh-system-monitor",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const react = require("react");
    const h = react.createElement;
    const { useState, useEffect, useRef, useCallback } = react;

    /** Locale namespace owned by this plugin. */
    const NS = "system-monitor";
    /** Main-panel key, shared with the sidebar.panellist entry id. */
    const PANEL_ID = "dsh-system-monitor";
    /** Host route prefix. */
    const PREFIX = "/dsh-system-monitor";
    /** Points kept per sparkline (~2 minutes at the 2 s default). */
    const HISTORY = 60;
    /** Poll choices, in milliseconds. */
    const INTERVALS = [1000, 2000, 5000, 10000];

    const zh = {
      panel: "系统监视器",
      title: "系统监视器",
      cpu: "CPU",
      core: "核心",
      cores: "核心",
      load: "负载",
      memory: "内存",
      swap: "交换分区",
      storage: "存储",
      mounts: "挂载点",
      inodes: "inode",
      read: "读",
      write: "写",
      busy: "繁忙",
      net: "网络",
      temperature: "温度",
      processes: "进程",
      uptime: "运行时间",
      used: "已用",
      free: "可用",
      cached: "缓存",
      rx: "接收",
      tx: "发送",
      pause: "暂停",
      resume: "继续",
      topCpu: "CPU 占用最高",
      topMem: "内存占用最高",
      pid: "PID",
      name: "名称",
      rss: "内存",
      empty: "暂无数据。",
      loading: "正在读取系统指标…",
      seconds: "秒",
    };
    const en = {
      panel: "System",
      title: "System monitor",
      cpu: "CPU",
      core: "Core",
      cores: "Cores",
      load: "Load",
      memory: "Memory",
      swap: "Swap",
      storage: "Storage",
      mounts: "Mounts",
      inodes: "inodes",
      read: "Read",
      write: "Write",
      busy: "Busy",
      net: "Network",
      temperature: "Temp",
      processes: "Processes",
      uptime: "Uptime",
      used: "Used",
      free: "Available",
      cached: "Cached",
      rx: "Down",
      tx: "Up",
      pause: "Pause",
      resume: "Resume",
      topCpu: "Top CPU",
      topMem: "Top memory",
      pid: "PID",
      name: "Name",
      rss: "Memory",
      empty: "No data yet.",
      loading: "Reading system metrics…",
      seconds: "s",
    };

    const CSS = `
.sm-page { display: flex; flex-direction: column; gap: 14px; padding: 20px 24px 32px; height: 100%; overflow: auto; }
.sm-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.sm-title { margin: 0; font-size: 17px; font-weight: 600; color: var(--dsw-alias-label-primary, currentColor); }
.sm-sub { font-size: 12px; color: var(--dsw-alias-label-secondary, currentColor); }
.sm-spacer { flex: 1 1 auto; }
.sm-controls { display: flex; align-items: center; gap: 8px; }
.sm-btn { font: inherit; font-size: 12px; padding: 3px 10px; border-radius: 6px; cursor: pointer;
  color: var(--dsw-alias-label-primary, currentColor); background: var(--dsw-alias-bg-layer-1, transparent);
  border: 1px solid var(--dsw-alias-border-l1, currentColor); }
.sm-btn[data-active="true"] { border-color: var(--dsw-alias-brand-primary, currentColor); color: var(--dsw-alias-brand-primary, currentColor); }
.sm-grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
.sm-card { background: var(--dsw-alias-bg-layer-1, transparent); border: 1px solid var(--dsw-alias-border-l1, transparent);
  border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.sm-card-head { display: flex; align-items: baseline; gap: 8px; }
.sm-card-title { font-size: 12px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase;
  color: var(--dsw-alias-label-secondary, currentColor); }
.sm-figure { font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-primary, currentColor); }
.sm-note { font-size: 11px; color: var(--dsw-alias-label-secondary, currentColor); font-variant-numeric: tabular-nums; }
.sm-bar { position: relative; height: 6px; border-radius: 3px; overflow: hidden; background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.18)); }
.sm-bar-fill { position: absolute; inset: 0 auto 0 0; border-radius: 3px; background: var(--dsw-alias-brand-primary, #4d6bfe); transition: width .25s linear; }
.sm-bar-fill[data-tone="warn"] { background: var(--dsw-alias-state-warn-primary, #d98324); }
.sm-bar-fill[data-tone="error"] { background: var(--dsw-alias-state-error-primary, #d9534f); }
.sm-cores { display: grid; gap: 4px 10px; grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); }
.sm-core { display: flex; flex-direction: column; gap: 3px; }
.sm-core-label { font-size: 10px; color: var(--dsw-alias-label-secondary, currentColor); font-variant-numeric: tabular-nums; }
.sm-spark { display: block; width: 100%; height: 34px; }
.sm-spark-line { fill: none; stroke: var(--dsw-alias-brand-primary, #4d6bfe); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.sm-spark-area { fill: var(--dsw-alias-brand-primary, #4d6bfe); opacity: .12; }
.sm-rows { display: flex; flex-direction: column; gap: 6px; }
.sm-row { display: flex; align-items: center; gap: 8px; font-size: 12px; min-width: 0; }
.sm-row-label { flex: 0 0 32%; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--dsw-alias-label-primary, currentColor); font-variant-numeric: tabular-nums; }
.sm-row-bar { flex: 1 1 auto; min-width: 0; }
.sm-row-value { flex: 0 0 auto; font-size: 11px; font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-secondary, currentColor); }
.sm-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.sm-table th { text-align: left; font-weight: 500; font-size: 10px; letter-spacing: .04em; text-transform: uppercase;
  color: var(--dsw-alias-label-secondary, currentColor); padding: 2px 6px 4px 0; }
.sm-table td { padding: 3px 6px 3px 0; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-primary, currentColor); }
.sm-table td.sm-num { text-align: right; }
.sm-table { table-layout: auto; }
.sm-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
.sm-trunc { display: inline-block; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sm-storage-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 10px; margin-top: 2px; }
.sm-storage-cell { display: flex; flex-direction: column; gap: 5px; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l1, currentColor); border-radius: 8px; background: var(--dsw-alias-bg-layer-1, transparent); }
.sm-storage-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.sm-storage-facts { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; color: var(--dsw-alias-label-secondary, currentColor); font-variant-numeric: tabular-nums; }
.sm-storage-totals { display: flex; flex-wrap: wrap; gap: 4px 16px; margin-top: 2px; font-size: 11px; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-secondary, currentColor); }
.sm-icon { display: grid; place-items: center; width: 100%; height: 100%; }
.sm-icon svg { width: 100%; height: 100%; display: block; }
.sm-icon-dial { opacity: .45; }
.sm-icon[data-active="true"] .sm-icon-dial { opacity: .6; }
`;

    /** Install the style tag once. */
    function installStyles() {
      if (typeof document === "undefined") return;
      const tagId = "dsh-system-monitor/client.css";
      if (document.querySelector(`style[data-plugin-css="${tagId}"]`) !== null) return;
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-system-monitor";
      tag.dataset.pluginCss = tagId;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    /**
     * Inline sidebar icon: a gauge face with a needle, drawn at the edge length
     * the sidebar owner asks for. Both strokes inherit the row colour so the
     * entry follows the active theme; the dial is dimmed to keep the needle
     * dominant, and `data-active` lets the CSS react to selection.
     * @param {{size?: number, active?: boolean}} props - owner presentation props.
     * @returns {import('react').ReactElement} icon.
     */
    function PanelIcon({ size, active }) {
      const edge = Number.isFinite(size) && size > 0 ? size : 18;
      return h(
        "span",
        {
          className: "sm-icon",
          "aria-hidden": "true",
          "data-active": active === true ? "true" : "false",
          style: { width: `${edge}px`, height: `${edge}px` },
        },
        h(
          "svg",
          { viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round" },
          h("path", { d: "M2.2 11.4a6.4 6.4 0 1 1 11.6 0", className: "sm-icon-dial" }),
          h("path", { d: "M8 11.6 11.4 6.9", strokeWidth: 1.7 }),
          h("circle", { cx: 8, cy: 11.6, r: 1.1, fill: "currentColor", stroke: "none" }),
        ),
      );
    }

    /**
     * Human byte size.
     * @param {number} bytes - byte count.
     * @returns {string} formatted size.
     */
    function bytes(bytes) {
      if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
      const units = ["B", "KiB", "MiB", "GiB", "TiB"];
      let value = bytes;
      let index = 0;
      while (value >= 1024 && index < units.length - 1) {
        value /= 1024;
        index += 1;
      }
      return `${value >= 100 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
    }

    /**
     * Human rate.
     * @param {number} bytesPerSecond - rate.
     * @returns {string} formatted rate.
     */
    function rate(bytesPerSecond) {
      return `${bytes(bytesPerSecond)}/s`;
    }

    /**
     * Percent string from a fraction.
     * @param {number} fraction - 0..1-ish value.
     * @returns {string} percent text.
     */
    function percent(fraction) {
      if (!Number.isFinite(fraction)) return "—";
      return `${(fraction * 100).toFixed(fraction >= 0.1 ? 0 : 1)}%`;
    }

    /**
     * Human uptime.
     * @param {number} seconds - uptime seconds.
     * @returns {string} formatted duration.
     */
    function duration(seconds) {
      if (!Number.isFinite(seconds) || seconds <= 0) return "—";
      const days = Math.floor(seconds / 86400);
      const hours = Math.floor((seconds % 86400) / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      if (days > 0) return `${days}d ${hours}h ${minutes}m`;
      if (hours > 0) return `${hours}h ${minutes}m`;
      return `${minutes}m`;
    }

    /**
     * Tone for a usage bar.
     * @param {number} fraction - usage fraction.
     * @returns {"normal"|"warn"|"error"} tone.
     */
    function tone(fraction) {
      if (fraction >= 0.9) return "error";
      if (fraction >= 0.75) return "warn";
      return "normal";
    }

    /**
     * One labelled usage bar.
     * @param {{label: string, value: string, fraction: number}} props - row.
     * @returns {import('react').ReactElement} row.
     */
    function UsageRow({ label, value, fraction }) {
      const clamped = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
      return h(
        "div",
        { className: "sm-row" },
        h("span", { className: "sm-row-label", title: label }, label),
        h(
          "span",
          { className: "sm-row-bar" },
          h("span", { className: "sm-bar" }, h("span", { className: "sm-bar-fill", "data-tone": tone(clamped), style: { width: `${clamped * 100}%` } })),
        ),
        h("span", { className: "sm-row-value" }, value),
      );
    }

    /**
     * Sparkline over the recent samples.
     * @param {{points: number[]}} props - history in 0..1.
     * @returns {import('react').ReactElement} svg.
     */
    function Sparkline({ points }) {
      const width = 100;
      const height = 34;
      const series = points.length === 0 ? [0] : points;
      const step = series.length > 1 ? width / (series.length - 1) : width;
      const coords = series.map((value, index) => {
        const clamped = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
        return [index * step, height - clamped * (height - 2) - 1];
      });
      const line = coords.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
      const area = `${line} L${width} ${height} L0 ${height} Z`;
      return h(
        "svg",
        { className: "sm-spark", viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: "none", "aria-hidden": "true" },
        h("path", { className: "sm-spark-area", d: area }),
        h("path", { className: "sm-spark-line", d: line }),
      );
    }

    /**
     * Storage card: totals, one usage bar per mount with inode pressure and
     * live throughput, plus the aggregate of the device rates.
     * @param {{storage: object, history: number[], t: (key: string) => string}} props - card props.
     * @returns {import('react').ReactElement} card body.
     */
    /**
     * Read the storage block from a snapshot.
     *
     * A host half that predates the storage block reports a flat `disks` array
     * instead. Deriving the block here keeps the panel readable during a
     * rolling upgrade, where the client bundle is served from disk but the
     * process still runs the code it booted with.
     * @param {object|null|undefined} snapshot - one snapshot payload.
     * @returns {object|null} storage block, or null before the first sample.
     */
    function storageOf(snapshot) {
      if (snapshot === null || snapshot === undefined) return null;
      if (snapshot.storage !== undefined && snapshot.storage !== null) return snapshot.storage;
      const disks = Array.isArray(snapshot.disks) ? snapshot.disks : [];
      let total = 0;
      let used = 0;
      let available = 0;
      for (const disk of disks) {
        total += disk.size ?? 0;
        used += disk.used ?? 0;
        available += disk.available ?? 0;
      }
      return {
        mounts: disks.map((disk) => ({
          ...disk,
          device: disk.device ?? disk.mount,
          inodesTotal: disk.inodesTotal ?? 0,
          inodesUsed: disk.inodesUsed ?? 0,
          inodesUsage: disk.inodesUsage ?? 0,
          io: disk.io ?? null,
        })),
        total,
        used,
        available,
        usage: total > 0 ? used / total : 0,
        inodesTotal: 0,
        inodesUsed: 0,
        inodesUsage: 0,
        read: null,
        write: null,
        busy: null,
      };
    }

    function StorageCard({ storage, history, t }) {
      const mounts = storage.mounts ?? [];
      const inodeShare = Number.isFinite(storage.inodesUsage) && storage.inodesUsage > 0 ? storage.inodesUsage : 0;
      return h(
        "div",
        { className: "sm-rows" },
        h(UsageRow, {
          label: `${t("used")} · ${mounts.length} ${t("mounts")}`,
          value: `${bytes(storage.used)} / ${bytes(storage.total)}`,
          fraction: storage.usage,
        }),
        h(Sparkline, { points: history }),
        h(
          "div",
          { className: "sm-storage-grid" },
          mounts.map((disk) =>
            h(
              "div",
              { key: disk.mount, className: "sm-storage-cell" },
              h(
                "div",
                { className: "sm-storage-head" },
                h("span", { className: "sm-mono sm-trunc", title: disk.mount }, disk.mount),
                h("span", { className: "sm-note" }, disk.fs),
              ),
              h("span", { className: "sm-bar" }, h("span", { className: "sm-bar-fill", "data-tone": tone(disk.usage), style: { width: `${Math.min(100, Math.max(0, disk.usage * 100))}%` } })),
              h(
                "div",
                { className: "sm-storage-facts" },
                h("span", null, `${bytes(disk.used)} / ${bytes(disk.size)} · ${percent(disk.usage)}`),
                h("span", null, `${t("free")} ${bytes(disk.available)}`),
              ),
              h(
                "div",
                { className: "sm-storage-facts sm-note" },
                h("span", { title: disk.device }, disk.inodesTotal > 0 ? `${t("inodes")} ${percent(disk.inodesUsage)}` : `${t("inodes")} —`),
                h(
                  "span",
                  null,
                  disk.io === null
                    ? `${t("read")} —`
                    : `${t("read")} ${rate(disk.io.read)} · ${t("write")} ${rate(disk.io.write)}`,
                ),
              ),
            ),
          ),
        ),
        h(
          "div",
          { className: "sm-storage-totals" },
          h("span", null, `${t("inodes")} ${storage.inodesTotal > 0 ? `${percent(inodeShare)} · ${storage.inodesUsed} / ${storage.inodesTotal}` : "—"}`),
          h("span", null, `${t("busy")} ${storage.busy === null || storage.busy === undefined ? "—" : percent(storage.busy)}`),
          h(
            "span",
            null,
            storage.read === null || storage.read === undefined
              ? `${t("read")} — · ${t("write")} —`
              : `${t("read")} ${rate(storage.read)} · ${t("write")} ${rate(storage.write)}`,
          ),
        ),
      );
    }

    /**
     * Fetch one snapshot.
     * @returns {Promise<object>} snapshot payload.
     * @throws {Error} when the host refuses or fails the read.
     */
    async function fetchSnapshot() {
      const response = await fetch(`${PREFIX}/snapshot`, { credentials: "same-origin" });
      const body = await response.json().catch(() => null);
      if (!response.ok || body === null || body.ok !== true) {
        throw new Error(body?.error ?? `HTTP ${response.status}`);
      }
      return body.value;
    }

    /**
     * The monitor page.
     * @param {{t: Function}} props - translator.
     * @returns {import('react').ReactElement} page.
     */
    function MonitorPage({ t }) {
      const [snapshot, setSnapshot] = useState(null);
      const [error, setError] = useState("");
      const [status, setStatus] = useState("loading");
      const [intervalMs, setIntervalMs] = useState(2000);
      const [paused, setPaused] = useState(false);
      const [cpuHistory, setCpuHistory] = useState([]);
      const [memHistory, setMemHistory] = useState([]);
      const [netRates, setNetRates] = useState({});
      const [storageHistory, setStorageHistory] = useState([]);
      const netRef = useRef(null);

      const tick = useCallback(async () => {
        try {
          const value = await fetchSnapshot();
          // Network counters are cumulative: a rate needs the previous sample.
          const prior = netRef.current;
          if (prior !== null) {
            const seconds = (value.time - prior.at) / 1000;
            if (seconds > 0.05) {
              /** @type {Record<string, {rx: number, tx: number}>} */
              const rates = {};
              for (const entry of value.net ?? []) {
                const before = prior.map.get(entry.iface);
                if (before === undefined) continue;
                rates[entry.iface] = {
                  rx: Math.max(0, entry.rx - before.rx) / seconds,
                  tx: Math.max(0, entry.tx - before.tx) / seconds,
                };
              }
              setNetRates(rates);
            }
          }
          netRef.current = { at: value.time, map: new Map((value.net ?? []).map((entry) => [entry.iface, entry])) };
          setSnapshot(value);
          setError("");
          setStatus("ready");
          setCpuHistory((history) => [...history, value.cpu.usage].slice(-HISTORY));
          const memShare = value.memory.total > 0 ? value.memory.used / value.memory.total : 0;
          setMemHistory((history) => [...history, memShare].slice(-HISTORY));
          setStorageHistory((history) => [...history, storageOf(value)?.usage ?? 0].slice(-HISTORY));
        } catch (cause) {
          setError(String(cause?.message ?? cause));
          setStatus("error");
        }
      }, []);

      useEffect(() => {
        void tick();
      }, [tick]);

      useEffect(() => {
        if (paused) return undefined;
        const timer = setInterval(() => {
          if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
          void tick();
        }, intervalMs);
        return () => clearInterval(timer);
      }, [paused, intervalMs, tick]);

      const mem = snapshot?.memory ?? null;
      const cpu = snapshot?.cpu ?? null;
      const host = snapshot?.host ?? null;
      const storage = storageOf(snapshot);

      return h(
        "div",
        { className: "sm-page" },
        h(
          "div",
          { className: "sm-head" },
          h("h2", { className: "sm-title" }, t("title")),
          h("span", { className: "sm-sub" }, host === null ? t("loading") : `${host.hostname} · ${host.platform} ${host.release} · ${host.cores} ${t("cores")} · ${t("uptime")} ${duration(host.uptime)}`),
          h("span", { className: "sm-spacer" }),
          h(
            "div",
            { className: "sm-controls" },
            INTERVALS.map((value) =>
              h(
                "button",
                {
                  key: String(value),
                  type: "button",
                  className: "sm-btn",
                  "data-active": value === intervalMs ? "true" : "false",
                  onClick: () => setIntervalMs(value),
                },
                `${value / 1000}${t("seconds")}`,
              ),
            ),
            h(
              "button",
              { type: "button", className: "sm-btn", onClick: () => setPaused((value) => !value) },
              paused ? t("resume") : t("pause"),
            ),
          ),
        ),
        status === "error" ? h("div", { className: "sm-note", role: "alert" }, t("failed", { error })) : null,
        h(
          "div",
          { className: "sm-grid" },
          h(
            "div",
            { className: "sm-card" },
            h("div", { className: "sm-card-head" }, h("span", { className: "sm-card-title" }, t("cpu"))),
            h("div", { className: "sm-figure" }, cpu === null ? "—" : percent(cpu.usage)),
            h(Sparkline, { points: cpuHistory }),
            cpu === null
              ? null
              : h("div", { className: "sm-note" }, `${t("load")} ${cpu.load.map((value) => value.toFixed(2)).join("  ")} · ${cpu.sampleMs} ms`),
            h(
              "div",
              { className: "sm-cores" },
              (cpu?.perCore ?? []).map((value, index) =>
                h(
                  "div",
                  { key: String(index), className: "sm-core" },
                  h("span", { className: "sm-core-label" }, `${t("core")} ${index + 1} · ${percent(value)}`),
                  h("span", { className: "sm-bar" }, h("span", { className: "sm-bar-fill", "data-tone": tone(value), style: { width: `${Math.min(100, value * 100)}%` } })),
                ),
              ),
            ),
          ),
          h(
            "div",
            { className: "sm-card" },
            h("div", { className: "sm-card-head" }, h("span", { className: "sm-card-title" }, t("memory"))),
            h("div", { className: "sm-figure" }, mem === null ? "—" : percent(mem.total > 0 ? mem.used / mem.total : 0)),
            h(Sparkline, { points: memHistory }),
            mem === null
              ? null
              : h(
                  "div",
                  { className: "sm-rows" },
                  h(UsageRow, { label: t("used"), value: `${bytes(mem.used)} / ${bytes(mem.total)}`, fraction: mem.total > 0 ? mem.used / mem.total : 0 }),
                  h(UsageRow, { label: t("free"), value: bytes(mem.available), fraction: mem.total > 0 ? mem.available / mem.total : 0 }),
                  h(UsageRow, { label: t("cached"), value: bytes(mem.cached + mem.buffers), fraction: mem.total > 0 ? (mem.cached + mem.buffers) / mem.total : 0 }),
                  mem.swapTotal > 0
                    ? h(UsageRow, { label: t("swap"), value: `${bytes(mem.swapUsed)} / ${bytes(mem.swapTotal)}`, fraction: mem.swapUsed / mem.swapTotal })
                    : null,
                ),
          ),
          h(
            "div",
            { className: "sm-card", style: { gridColumn: "1 / -1" } },
            h(
              "div",
              { className: "sm-card-head" },
              h("span", { className: "sm-card-title" }, t("storage")),
              h("span", { className: "sm-spacer" }),
              snapshot?.temperature !== null && snapshot?.temperature !== undefined
                ? h("span", { className: "sm-note" }, `${t("temperature")} ${snapshot.temperature.toFixed(0)}°C`)
                : null,
            ),
            (storage?.mounts ?? []).length === 0
              ? h("div", { className: "sm-note" }, t("empty"))
              : h(StorageCard, { storage, history: storageHistory, t }),
          ),
          h(
            "div",
            { className: "sm-card" },
            h("div", { className: "sm-card-head" }, h("span", { className: "sm-card-title" }, t("net"))),
            (snapshot?.net ?? []).length === 0
              ? h("div", { className: "sm-note" }, t("empty"))
              : h(
                  "table",
                  { className: "sm-table" },
                  h(
                    "thead",
                    null,
                    h("tr", null, h("th", null, t("name")), h("th", { className: "sm-num" }, t("rx")), h("th", { className: "sm-num" }, t("tx"))),
                  ),
                  h(
                    "tbody",
                    null,
                    snapshot.net.slice(0, 6).map((entry) => {
                      const speed = netRates[entry.iface];
                      return h(
                        "tr",
                        { key: entry.iface },
                        h("td", { className: "sm-mono" }, entry.iface),
                        h("td", { className: "sm-num" }, speed === undefined ? "—" : rate(speed.rx)),
                        h("td", { className: "sm-num" }, speed === undefined ? "—" : rate(speed.tx)),
                      );
                    }),
                  ),
                ),
          ),
          h(
            "div",
            { className: "sm-card", style: { gridColumn: "1 / -1" } },
            h("div", { className: "sm-card-head" }, h("span", { className: "sm-card-title" }, `${t("processes")} · ${snapshot?.processes.total ?? 0}`)),
            h(
              "div",
              { className: "sm-grid", style: { paddingTop: 4 } },
              h(
                "div",
                null,
                h("div", { className: "sm-note" }, t("topCpu")),
                h(
                  "table",
                  { className: "sm-table" },
                  h("thead", null, h("tr", null, h("th", null, t("pid")), h("th", null, t("name")), h("th", { className: "sm-num" }, t("cpu")))),
                  h("tbody", null, (snapshot?.processes.topCpu ?? []).map((entry) => h("tr", { key: `c${entry.pid}` }, h("td", { className: "sm-mono" }, String(entry.pid)), h("td", null, h("span", { className: "sm-trunc", title: entry.name }, entry.name)), h("td", { className: "sm-num" }, percent(entry.cpu))))),
                ),
              ),
              h(
                "div",
                null,
                h("div", { className: "sm-note" }, t("topMem")),
                h(
                  "table",
                  { className: "sm-table" },
                  h("thead", null, h("tr", null, h("th", null, t("pid")), h("th", null, t("name")), h("th", { className: "sm-num" }, t("rss")))),
                  h("tbody", null, (snapshot?.processes.topMem ?? []).map((entry) => h("tr", { key: `m${entry.pid}` }, h("td", { className: "sm-mono" }, String(entry.pid)), h("td", null, h("span", { className: "sm-trunc", title: entry.name }, entry.name)), h("td", { className: "sm-num" }, bytes(entry.rss))))),
                ),
              ),
            ),
          ),
        ),
      );
    }

    /** Client services this half reaches for. */
    const inject = ["slots", "locale"];

    /**
     * Register every contribution.
     * @param {import('@deepseek-ai/cordis').Context} ctx - client plugin context.
     * @returns {void}
     */
    function apply(ctx) {
      installStyles();
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-system-monitor: dictionaries");
      const t = ctx.locale.bind(NS);

      ctx.slots.inject("main", () =>
        ctx.slots.register(
          {
            name: "main",
            key: PANEL_ID,
            locale: NS,
          },
          MonitorPage,
        ),
      );
      ctx.slots.inject("sidebar.panellist", () =>
        ctx.slots.register(
          {
            name: "sidebar.panellist",
            id: PANEL_ID,
            order: -100,
            locale: NS,
            label: () => t("panel"),
          },
          PanelIcon,
        ),
      );
    }

    exports.__parts = { MonitorPage, StorageCard, Sparkline, UsageRow, PanelIcon };
    exports.name = "dsh-system-monitor";
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});
