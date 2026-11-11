/**
 * dsh-hevy-training — client half.
 *
 * Hand-written bundle in the shell's ModuleLoader wrapper (no build step: the
 * profile ships no React/TS toolchain and the shell seeds react/react-dom as
 * static modules).
 *
 * One contribution:
 *   `main` + `sidebar.panellist` — a "Training" panel over the host route
 *   `/dsh-hevy-training/overview`. The host holds the Hevy API key and does
 *   the aggregation; this half only renders, so the panel opens without an
 *   agent turn and never sees the credential.
 *
 * Charts are inline SVG built from the payload — no chart dependency, no
 * canvas, and every series stays legible in both themes because colours come
 * from the `--dsw-alias-*` tokens.
 */
window.__ModuleLoader__.load({
  id: "dsh-hevy-training",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const react = require("react");
    const h = react.createElement;
    const { useState, useEffect, useCallback } = react;

    /** Locale namespace owned by this plugin. */
    const NS = "hevy-training";
    /** Main-panel key, shared with the sidebar.panellist entry id. */
    const PANEL_ID = "dsh-hevy-training";
    /** Host route prefix. */
    const PREFIX = "/dsh-hevy-training";

    const zh = {
      panel: "训练",
      title: "训练",
      subtitle: "来自 Hevy 的训练量、肌群平衡与力量进展",
      refresh: "刷新",
      loading: "正在读取 Hevy…",
      loadFailed: "读取失败：{error}",
      noKey: "未设置 HEVY_API_KEY。请在宿主环境中设置后重启 DSH。",
      cached: "缓存",
      live: "实时",
      tabOverview: "概览",
      tabMuscles: "肌群",
      tabLifts: "力量",
      tabWeight: "体重",
      tabSessions: "训练记录",
      thisWeek: "本周",
      sessions: "次训练",
      volume: "训练量",
      sets: "组数",
      minutes: "分钟",
      streak: "连续周",
      week: "周",
      volumeUnit: "kg",
      weeksTitle: "每周训练量",
      weeksHint: "最近 {weeks} 周",
      musclesTitle: "肌群平衡",
      musclesHint: "最近 {days} 天，主肌群记 1 组，次要肌群记 0.5 组",
      musclesEmpty: "该时间段内没有训练记录。",
      stale: "超过 {days} 天未练：{groups}",
      liftsTitle: "主要动作进展",
      liftsHint: "按估算 1RM 排序",
      prsTitle: "近期个人纪录",
      prsEmpty: "最近 30 天内没有新的个人纪录。",
      pr: "PR",
      previous: "此前",
      sessionsTitle: "最近训练",
      sessionsEmpty: "没有训练记录。",
      weightTitle: "体重趋势",
      weightHint: "共 {count} 次记录",
      weightEmpty: "没有体重记录。",
      weightLatest: "当前",
      weightDelta: "较上次",
      detail: "详情",
      back: "返回",
      noSets: "无组数据",
      bodyweight: "自重",
      failure: "力竭",
      dropset: "递减",
      warmup: "热身",
      setCount: "{count} 组",
      exerciseCount: "{count} 个动作",
      notFound: "该训练无法读取。",
      lapsed: "最近 {weeks} 周没有训练记录，上次训练是 {date}。",
      neverTrained: "还没有任何训练记录。请在 Hevy 里记录第一次训练。",
      unitKg: "kg",
      unitLb: "lb",
      unitMin: "分钟",
      avgSessions: "周均 {value} 次",
      qualityTitle: "训练质量",
      qualityHint: "最近 {days} 天，按组内最好的一组到最后一组的落差计算",
      qualityDropoff: "最大掉幅",
      qualityDropoffSub: "{exercise} · {date}",
      qualityRpe: "RPE 记录率",
      qualityRpeSub: "{logged} / {total} 组",
      qualityFailure: "力竭组",
      qualityFailureNever: "近期没有力竭组",
      qualityFailureAgo: "{days} 天前",
      qualityCollapse: "⚠ 有 {count} 次训练出现组内掉幅超过 {pct}%：按训练日志的规则，应在掉幅出现时结束该动作。",
      qualityNoDropoff: "没有可比较的组（每个动作至少需要两组）。",
      notesTitle: "训练备注",
      notesHint: "来自 Hevy 的训练说明与动作备注",
      notesEmpty: "最近没有写下任何备注。",
      weightStale: "已有 {days} 天没有记录体重，趋势无法反映当前状态。",
    };

    const en = {
      panel: "Training",
      title: "Training",
      subtitle: "Volume, muscle balance and strength progression from Hevy",
      refresh: "Refresh",
      loading: "Reading Hevy…",
      loadFailed: "Load failed: {error}",
      noKey: "HEVY_API_KEY is not set. Set it in the host environment and restart DSH.",
      cached: "cached",
      live: "live",
      tabOverview: "Overview",
      tabMuscles: "Muscles",
      tabLifts: "Strength",
      tabWeight: "Weight",
      tabSessions: "Sessions",
      thisWeek: "This week",
      sessions: "sessions",
      volume: "Volume",
      sets: "sets",
      minutes: "min",
      streak: "week streak",
      week: "week",
      volumeUnit: "kg",
      weeksTitle: "Weekly volume",
      weeksHint: "Last {weeks} weeks",
      musclesTitle: "Muscle balance",
      musclesHint: "Last {days} days; primary group counts a full set, secondary groups half",
      musclesEmpty: "No training in this window.",
      stale: "Untouched for over {days} days: {groups}",
      liftsTitle: "Top lifts",
      liftsHint: "Ranked by estimated 1RM",
      prsTitle: "Recent personal records",
      prsEmpty: "No new personal records in the last 30 days.",
      pr: "PR",
      previous: "previous",
      sessionsTitle: "Recent sessions",
      sessionsEmpty: "No sessions yet.",
      weightTitle: "Body weight",
      weightHint: "{count} measurements",
      weightEmpty: "No body-weight measurements.",
      weightLatest: "Latest",
      weightDelta: "vs previous",
      detail: "Detail",
      back: "Back",
      noSets: "No set data",
      bodyweight: "bodyweight",
      failure: "failure",
      dropset: "dropset",
      warmup: "warmup",
      setCount: "{count} sets",
      exerciseCount: "{count} exercises",
      notFound: "That session could not be read.",
      lapsed: "No sessions in the last {weeks} weeks. Last one was {date}.",
      neverTrained: "No sessions recorded yet. Log the first one in Hevy.",
      unitKg: "kg",
      unitLb: "lb",
      unitMin: "min",
      avgSessions: "{value} sessions/week",
      qualityTitle: "Session quality",
      qualityHint: "Last {days} days; drop-off is best set → last set within one exercise",
      qualityDropoff: "Worst drop-off",
      qualityDropoffSub: "{exercise} · {date}",
      qualityRpe: "RPE coverage",
      qualityRpeSub: "{logged} of {total} sets",
      qualityFailure: "Failure sets",
      qualityFailureNever: "No failure sets recently",
      qualityFailureAgo: "{days} days ago",
      qualityCollapse: "⚠ {count} session(s) dropped more than {pct}% within an exercise — the training journal's rule is to end the exercise at that point.",
      qualityNoDropoff: "No comparable sets (an exercise needs at least two).",
      notesTitle: "Session notes",
      notesHint: "Workout descriptions and exercise notes from Hevy",
      notesEmpty: "No notes written recently.",
      weightStale: "No body-weight reading for {days} days, so the trend no longer describes the present.",
    };

    /** Fenced host URL for one route. */
    const url = (route, query) => {
      const suffix = query ? `?${query}` : "";
      return `${PREFIX}/${route}${suffix}`;
    };

    const CSS = `
.dht-page{display:flex;flex-direction:column;height:100%;min-height:0;gap:0;box-sizing:border-box;overflow:hidden}
.dht-head{display:flex;align-items:flex-start;gap:10px;padding:16px 16px 0;flex-wrap:wrap}
.dht-head-main{flex:1 1 auto;min-width:0}
.dht-title{font-size:15px;line-height:22px;font-weight:600;margin:0}
.dht-sub{margin:2px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,inherit)}
.dht-badge{font-size:11px;line-height:16px;padding:2px 6px;border-radius:var(--dsw-radius-sm,6px);border:.5px solid var(--dsw-alias-border-l1,currentColor);color:var(--dsw-alias-label-caption,inherit);flex:none}
.dht-btn{appearance:none;border:.5px solid var(--dsw-alias-border-l2,currentColor);background:transparent;color:inherit;border-radius:var(--dsw-radius-md,8px);height:28px;padding:0 10px;font-size:12px;cursor:pointer;flex:none}
.dht-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.dht-btn[disabled]{opacity:.4;cursor:default}
.dht-btn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,#4c8dff);outline-offset:2px}
.dht-tabs{display:flex;gap:2px;padding:12px 16px 0;border-bottom:.5px solid var(--dsw-alias-border-l1,currentColor);flex-wrap:wrap}
.dht-tab{appearance:none;background:transparent;border:0;border-bottom:2px solid transparent;color:var(--dsw-alias-label-tertiary,inherit);font-size:12px;line-height:18px;padding:6px 10px;cursor:pointer;border-radius:0}
.dht-tab[data-active=true]{color:var(--dsw-alias-label-primary,inherit);border-bottom-color:var(--dsw-alias-brand-primary,#4c8dff)}
.dht-tab:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,#4c8dff);outline-offset:-2px}
.dht-body{flex:1 1 auto;min-height:0;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:16px}
.dht-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(112px,1fr));gap:8px}
.dht-card{border:.5px solid var(--dsw-alias-border-l1,currentColor);border-radius:var(--dsw-radius-md,8px);padding:8px 10px;background:var(--dsw-alias-bg-layer-1,transparent)}
.dht-card-label{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,inherit)}
.dht-card-value{font-size:18px;line-height:26px;font-weight:600;font-variant-numeric:tabular-nums}
.dht-card-unit{font-size:11px;font-weight:400;color:var(--dsw-alias-label-tertiary,inherit);margin-left:2px}
.dht-section{border:.5px solid var(--dsw-alias-border-l1,currentColor);border-radius:var(--dsw-radius-lg,10px);background:var(--dsw-alias-bg-layer-1,transparent);padding:12px}
.dht-section-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:8px}
.dht-section-title{font-size:13px;line-height:20px;font-weight:600;margin:0}
.dht-section-hint{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,inherit)}
.dht-note{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,inherit)}
.dht-note[role=alert]{color:var(--dsw-alias-state-error-primary,#e5484d)}
.dht-svg{display:block;width:100%;height:auto;overflow:visible}
.dht-bar{fill:var(--dsw-alias-brand-primary,#4c8dff);opacity:.85}
.dht-bar[data-empty=true]{opacity:.16}
.dht-bar-label{font-size:8px;fill:var(--dsw-alias-label-tertiary,currentColor)}
.dht-line{fill:none;stroke:var(--dsw-alias-brand-primary,#4c8dff);stroke-width:1.6;stroke-linejoin:round;stroke-linecap:round}
.dht-area{fill:var(--dsw-alias-brand-primary,#4c8dff);opacity:.12;stroke:none}
.dht-dot{fill:var(--dsw-alias-brand-primary,#4c8dff)}
.dht-axis{stroke:var(--dsw-alias-border-l1,currentColor);stroke-width:.5}
.dht-muscles{display:flex;flex-direction:column;gap:6px}
.dht-muscle{display:grid;grid-template-columns:96px 1fr 64px;align-items:center;gap:8px;font-size:12px;line-height:18px}
.dht-muscle-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary,inherit)}
.dht-muscle-track{height:8px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));overflow:hidden}
.dht-muscle-fill{height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary,#4c8dff)}
.dht-muscle-value{text-align:right;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary,inherit);font-size:11px}
.dht-list{display:flex;flex-direction:column;gap:0}
.dht-row{display:flex;align-items:center;gap:8px;padding:7px 0;border-top:.5px solid var(--dsw-alias-border-l1,currentColor);font-size:12px;line-height:18px}
.dht-row:first-child{border-top:0}
.dht-row-main{flex:1 1 auto;min-width:0}
.dht-row-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dht-row-sub{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,inherit);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dht-row-value{font-variant-numeric:tabular-nums;flex:none;text-align:right}
.dht-pr{font-size:10px;line-height:14px;padding:0 5px;border-radius:999px;background:var(--dsw-alias-state-success-primary,#30a46c);color:#fff;flex:none}
.dht-session{appearance:none;background:transparent;border:0;color:inherit;text-align:left;cursor:pointer;width:100%;padding:8px 0;border-top:.5px solid var(--dsw-alias-border-l1,currentColor);display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;font-size:12px}
.dht-session:first-child{border-top:0}
.dht-session:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.08))}
.dht-session:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,#4c8dff);outline-offset:-2px}
.dht-session-sub{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,inherit)}
.dht-session-value{font-variant-numeric:tabular-nums;text-align:right;color:var(--dsw-alias-label-secondary,inherit);font-size:11px}
.dht-ex{border-top:.5px solid var(--dsw-alias-border-l1,currentColor);padding-top:8px;margin-top:8px}
.dht-ex:first-child{border-top:0;padding-top:0;margin-top:0}
.dht-ex-head{display:flex;align-items:baseline;gap:8px;font-size:12px;line-height:18px}
.dht-ex-title{font-weight:600;flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dht-ex-note{font-size:11px;color:var(--dsw-alias-label-tertiary,inherit);font-style:italic}
.dht-sets{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.dht-set{font-size:11px;line-height:16px;padding:1px 6px;border-radius:var(--dsw-radius-sm,6px);border:.5px solid var(--dsw-alias-border-l1,currentColor);font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary,inherit)}
.dht-set[data-warmup=true]{opacity:.55;border-style:dashed}
.dht-set[data-type=failure]{border-color:var(--dsw-alias-state-warn-primary,#f5a524)}
.dht-set[data-type=dropset]{border-style:dotted}
.dht-empty{padding:12px 0}
.dht-warn{padding:8px 10px;margin-top:8px;border:1px solid var(--dsw-alias-border-l1,currentColor);border-left:3px solid var(--dsw-alias-state-warn-primary,#f5a524);border-radius:8px;color:var(--dsw-alias-label-secondary,inherit)}
.dht-warn[data-inline=true]{margin-top:8px}
.dht-note-row{display:flex;flex-direction:column;gap:2px;padding:7px 0;border-top:.5px solid var(--dsw-alias-border-l1,currentColor);font-size:12px;line-height:18px}
.dht-note-row:first-child{border-top:0}
.dht-note-text{color:var(--dsw-alias-label-secondary,inherit);white-space:pre-wrap;overflow-wrap:anywhere}
.dht-note-ex{display:flex;gap:6px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,inherit);overflow-wrap:anywhere}
.dht-note-ex-title{font-weight:600;flex:none;max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dht-lapsed{padding:10px 12px;margin-bottom:12px;border:1px solid var(--dsw-alias-border-l1);border-left:3px solid var(--dsw-alias-state-warn-primary,#f5a524);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary,inherit)}
.dht-icon{display:grid;place-items:center;width:100%;height:100%}
.dht-icon svg{width:18px;height:18px;display:block}
`;

    /** Inject the stylesheet once (idempotent; safe across HMR reloads). */
    function installStyles() {
      if (typeof document === "undefined") return;
      const tagId = "dsh-hevy-training/client.css";
      if (document.querySelector(`style[data-plugin-css="${tagId}"]`) !== null) return;
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-hevy-training";
      tag.dataset.pluginCss = tagId;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    /** Sidebar glyph: a dumbbell. */
    function PanelIcon() {
      return h(
        "span",
        { className: "dht-icon", "aria-hidden": "true" },
        h(
          "svg",
          { viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" },
          h("path", { d: "M3 6v4M5.5 4.5v7M10.5 4.5v7M13 6v4M5.5 8h5" }),
        ),
      );
    }

    /**
     * Fetch one host route and unwrap its envelope.
     * @param {string} path - same-origin route.
     * @returns {Promise<any>} `value` field.
     */
    async function fetchValue(path) {
      const response = await fetch(path, { headers: { accept: "application/json" } });
      let body = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      if (!response.ok || body === null || body.ok !== true) {
        throw new Error(body?.error ?? `HTTP ${response.status}`);
      }
      return body.value;
    }

    /** Compact integer formatting. */
    function formatInt(value) {
      const number = Number(value);
      if (!Number.isFinite(number)) return "–";
      return number.toLocaleString(undefined, { maximumFractionDigits: 0 });
    }

    /** Compact one-decimal formatting. */
    function formatOne(value) {
      const number = Number(value);
      if (!Number.isFinite(number)) return "–";
      return number.toLocaleString(undefined, { maximumFractionDigits: 1 });
    }

    /** `MM-DD` from a `YYYY-MM-DD` key. */
    function shortDate(key) {
      return typeof key === "string" && key.length >= 10 ? key.slice(5) : "–";
    }

    /** Human label for one muscle-group key. */
    function muscleLabel(group) {
      return String(group ?? "other").replace(/_/g, " ");
    }

    /**
     * Weekly-volume bar chart.
     * @param {{weeks: object[], t: Function}} props - series and translator.
     * @returns {import('react').ReactElement} chart.
     */
    function WeeksChart({ weeks, t }) {
      const width = 640;
      const height = 132;
      const padBottom = 18;
      const padTop = 8;
      const max = Math.max(1, ...weeks.map((week) => week.volumeKg));
      const slot = weeks.length === 0 ? width : width / weeks.length;
      const barWidth = Math.max(3, Math.min(28, slot * 0.62));
      const plot = height - padBottom - padTop;

      return h(
        "svg",
        { className: "dht-svg", viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": t("weeksTitle") },
        h("line", { className: "dht-axis", x1: 0, y1: height - padBottom, x2: width, y2: height - padBottom }),
        weeks.map((week, index) => {
          const value = week.volumeKg;
          const barHeight = max === 0 ? 0 : Math.max(value > 0 ? 1.5 : 0, (value / max) * plot);
          const x = index * slot + (slot - barWidth) / 2;
          const y = height - padBottom - barHeight;
          return h("rect", {
            key: week.weekStart,
            className: "dht-bar",
            "data-empty": value <= 0 ? "true" : "false",
            x,
            y,
            width: barWidth,
            height: Math.max(barHeight, value > 0 ? 1.5 : 2),
            rx: Math.min(2, barWidth / 2),
          });
        }),
        weeks.map((week, index) =>
          index % Math.max(1, Math.ceil(weeks.length / 6)) === 0
            ? h(
                "text",
                {
                  key: `label-${week.weekStart}`,
                  className: "dht-bar-label",
                  x: index * slot + slot / 2,
                  y: height - 5,
                  textAnchor: "middle",
                },
                shortDate(week.weekStart),
              )
            : null,
        ),
      );
    }

    /**
     * Body-weight line chart.
     * @param {{series: object[], t: Function}} props - measurements and translator.
     * @returns {import('react').ReactElement} chart.
     */
    function WeightChart({ series, t }) {
      const width = 640;
      const height = 140;
      const padX = 6;
      const padY = 14;
      const weights = series.map((point) => point.weightKg);
      const min = Math.min(...weights);
      const max = Math.max(...weights);
      const span = max - min < 0.5 ? 1 : max - min;
      const stepX = series.length <= 1 ? 0 : (width - padX * 2) / (series.length - 1);
      const pointAt = (value, index) => {
        const x = series.length <= 1 ? width / 2 : padX + index * stepX;
        const y = padY + (1 - (value - min) / span) * (height - padY * 2);
        return [x, y];
      };
      const points = series.map((point, index) => pointAt(point.weightKg, index));
      const line = points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
      const area = `${line} L${(points.at(-1) ?? [width, height])[0].toFixed(1)} ${height - padY} L${(points[0] ?? [0, height])[0].toFixed(1)} ${height - padY} Z`;

      return h(
        "svg",
        { className: "dht-svg", viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": t("weightTitle") },
        h("line", { className: "dht-axis", x1: 0, y1: height - padY, x2: width, y2: height - padY }),
        series.length > 1 ? h("path", { className: "dht-area", d: area }) : null,
        series.length > 1 ? h("path", { className: "dht-line", d: line }) : null,
        points.map(([x, y], index) =>
          h("circle", { key: `dot-${series[index].date}`, className: "dht-dot", cx: x, cy: y, r: index === points.length - 1 ? 3.4 : 2 }),
        ),
      );
    }

    /**
     * One labelled statistic.
     * @param {{label: string, value: string, unit?: string}} props - card content.
     * @returns {import('react').ReactElement} card.
     */
    function StatCard({ label, value, unit }) {
      return h(
        "div",
        { className: "dht-card" },
        h("div", { className: "dht-card-label" }, label),
        h("div", { className: "dht-card-value" }, value, unit ? h("span", { className: "dht-card-unit" }, unit) : null),
      );
    }

    /**
     * One titled section.
     * @param {{title: string, hint?: string, children: any}} props - section content.
     * @returns {import('react').ReactElement} section.
     */
    function Section({ title, hint, children }) {
      return h(
        "section",
        { className: "dht-section" },
        h(
          "div",
          { className: "dht-section-head" },
          h("h3", { className: "dht-section-title" }, title),
          hint ? h("span", { className: "dht-section-hint" }, hint) : null,
        ),
        children,
      );
    }

    /**
     * Session quality: drop-off, failure sets and RPE coverage.
     *
     * Every number here answers a rule from the training journal rather than a
     * load question, so the section reads as a verdict, not a chart: how far the
     * last set fell below the best set (the collapse that ends an exercise), how
     * much work was taken to failure, and whether enough sets carry an RPE to
     * apply the journal's "six weeks without failure, then RPE 7 → 8" rule.
     *
     * @param {{quality: object|null, t: Function}} props - quality facts and translator.
     * @returns {import('react').ReactElement} section.
     */
    function QualitySection({ quality, t }) {
      if (quality === null || quality === undefined) return null;

      const hasDropoff = quality.worstDropoffPct !== null;
      const failureSub =
        quality.lastFailureAt === null
          ? t("qualityFailureNever")
          : t("qualityFailureAgo", { days: String(quality.daysSinceFailure ?? 0) });

      return h(
        Section,
        { title: t("qualityTitle"), hint: t("qualityHint", { days: String(quality.windowDays) }) },
        h(
          "div",
          { className: "dht-cards" },
          h(StatCard, {
            label: t("qualityDropoff"),
            value: hasDropoff ? formatOne(quality.worstDropoffPct) : "—",
            unit: hasDropoff ? "%" : undefined,
          }),
          h(StatCard, {
            label: t("qualityRpe"),
            value: formatInt(Math.round(quality.rpeCoverage * 100)),
            unit: "%",
          }),
          h(StatCard, {
            label: t("qualityFailure"),
            value: formatInt(quality.failureSets),
            unit: t("sets"),
          }),
        ),
        hasDropoff
          ? h(
              "div",
              { className: "dht-row-sub" },
              `${t("qualityDropoffSub", {
                exercise: quality.worstDropoffExercise ?? "—",
                date: quality.worstDropoffDate ?? "—",
              })} · ${t("qualityRpeSub", {
                logged: String(quality.rpeSets),
                total: String(quality.workingSets),
              })} · ${failureSub}`,
            )
          : h("div", { className: "dht-note" }, t("qualityNoDropoff")),
        quality.collapsedSessions > 0
          ? h(
              "div",
              { className: "dht-note dht-warn" },
              t("qualityCollapse", {
                count: String(quality.collapsedSessions),
                pct: String(quality.collapseAlertPct),
              }),
            )
          : null,
      );
    }

    /**
     * Notes written against sessions and exercises, newest first.
     *
     * This is the only quantitative-free section in the panel on purpose: the
     * journal's "don't substitute silently" rule is satisfied by *reading* what
     * was written, and the notes were previously unreachable without opening
     * each session one at a time.
     *
     * @param {{notes: object[], t: Function}} props - annotated sessions.
     * @returns {import('react').ReactElement} section.
     */
    function NotesSection({ notes, t }) {
      const rows = notes ?? [];
      return h(
        Section,
        { title: t("notesTitle"), hint: t("notesHint") },
        rows.length === 0
          ? h("div", { className: "dht-note dht-empty" }, t("notesEmpty"))
          : h(
              "div",
              { className: "dht-list" },
              rows.map((entry) =>
                h(
                  "div",
                  { key: entry.id ?? `${entry.date}:${entry.title}`, className: "dht-note-row" },
                  h(
                    "div",
                    { className: "dht-row-sub" },
                    `${entry.date ?? "—"} · ${entry.title || "—"}`,
                  ),
                  entry.note === ""
                    ? null
                    : h("div", { className: "dht-note-text" }, entry.note),
                  entry.exerciseNotes.map((line) =>
                    h(
                      "div",
                      { key: line.title, className: "dht-note-ex" },
                      h("span", { className: "dht-note-ex-title" }, line.title),
                      h("span", null, line.notes),
                    ),
                  ),
                ),
              ),
            ),
      );
    }

    /**
     * Muscle-group balance bars.
     * @param {{rows: object[], t: Function}} props - balance rows.
     * @returns {import('react').ReactElement} bars.
     */
    function MuscleBars({ rows, t }) {
      if (rows.length === 0) return h("div", { className: "dht-note dht-empty" }, t("musclesEmpty"));
      const max = Math.max(1, ...rows.map((row) => row.sets));
      return h(
        "div",
        { className: "dht-muscles" },
        rows.map((row) =>
          h(
            "div",
            { key: row.group, className: "dht-muscle" },
            h("span", { className: "dht-muscle-name", title: muscleLabel(row.group) }, muscleLabel(row.group)),
            h(
              "span",
              { className: "dht-muscle-track" },
              h("span", {
                className: "dht-muscle-fill",
                style: { width: `${Math.max(2, (row.sets / max) * 100).toFixed(1)}%` },
              }),
            ),
            h(
              "span",
              { className: "dht-muscle-value" },
              `${formatOne(row.sets)} · ${formatInt(row.volumeKg)} ${t("unitKg")}`,
            ),
          ),
        ),
      );
    }

    /**
     * Expanded detail for one session.
     * @param {{title: string, detail: object|null, loading: boolean, error: string, onBack: Function, t: Function}} props - detail state.
     * @returns {import('react').ReactElement} detail view.
     */
    function SessionDetail({ title, detail, loading, error, onBack, t }) {
      const exercises = detail?.exercises ?? [];
      return h(
        "div",
        { className: "dht-body" },
        h(
          "div",
          { className: "dht-section-head" },
          h("button", { type: "button", className: "dht-btn", onClick: onBack }, `← ${t("back")}`),
          h("h3", { className: "dht-section-title" }, title),
        ),
        loading ? h("div", { className: "dht-note" }, t("loading")) : null,
        error ? h("div", { className: "dht-note", role: "alert" }, t("notFound")) : null,
        detail === null
          ? null
          : h(
              "section",
              { className: "dht-section" },
              h(
                "div",
                { className: "dht-section-head" },
                h("span", { className: "dht-section-hint" }, `${detail.start_time ?? ""}`),
                h("span", { className: "dht-section-hint" }, t("exerciseCount", { count: String(exercises.length) })),
              ),
              /* The workout description is the session's own note; show it before the sets. */
              typeof detail.description === "string" && detail.description.trim() !== ""
                ? h("div", { className: "dht-note-text" }, detail.description)
                : null,
              exercises.map((exercise, index) =>
                h(
                  "div",
                  { key: `${exercise.exercise_template_id ?? index}`, className: "dht-ex" },
                  h(
                    "div",
                    { className: "dht-ex-head" },
                    h("span", { className: "dht-ex-title" }, exercise.title ?? ""),
                    exercise.notes ? h("span", { className: "dht-ex-note" }, exercise.notes) : null,
                  ),
                  h(
                    "div",
                    { className: "dht-sets" },
                    (exercise.sets ?? []).map((set, setIndex) =>
                      h(
                        "span",
                        {
                          key: `set-${setIndex}`,
                          className: "dht-set",
                          "data-warmup": set.type === "warmup" ? "true" : "false",
                          "data-type": set.type ?? "normal",
                          title: set.type === "failure" ? t("failure") : set.type === "dropset" ? t("dropset") : undefined,
                        },
                        h(
                          "span",
                          null,
                          set.weight_kg === null || set.weight_kg === undefined
                            ? t("bodyweight")
                            : `${formatOne(set.weight_kg)} ${t("unitKg")}`,
                          set.reps === null || set.reps === undefined ? "" : ` × ${formatInt(set.reps)}`,
                          set.duration_seconds ? ` ${formatInt(set.duration_seconds)}s` : "",
                          set.rpe ? ` RPE ${set.rpe}` : "",
                          set.type === "failure" ? ` ${t("failure")}` : set.type === "dropset" ? ` ${t("dropset")}` : "",
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
      );
    }

    /**
     * The Training panel.
     * @param {{t: Function}} props - translator provided by the locale slot.
     * @returns {import('react').ReactElement} panel.
     */
    function TrainingPage({ t }) {
      const [status, setStatus] = useState("loading");
      const [overview, setOverview] = useState(null);
      const [error, setError] = useState("");
      const [tab, setTab] = useState("overview");
      const [openSession, setOpenSession] = useState(null);
      const [sessionDetail, setSessionDetail] = useState(null);
      const [sessionState, setSessionState] = useState("idle");
      const [sessionError, setSessionError] = useState("");

      const load = useCallback(async () => {
        setStatus("loading");
        setError("");
        try {
          const value = await fetchValue(url("overview"));
          setOverview(value);
          setStatus("ready");
        } catch (cause) {
          setOverview(null);
          setError(String(cause?.message ?? cause));
          setStatus("error");
        }
      }, []);

      useEffect(() => {
        void load();
      }, [load]);

      const openDetail = useCallback(
        async (session) => {
          setOpenSession(session);
          setSessionDetail(null);
          setSessionError("");
          setSessionState("loading");
          try {
            const value = await fetchValue(url("session", `id=${encodeURIComponent(String(session.id))}`));
            setSessionDetail(value);
            setSessionState("ready");
          } catch (cause) {
            setSessionError(String(cause?.message ?? cause));
            setSessionState("error");
          }
        },
        [],
      );

      const weeks = overview?.weeksSeries ?? [];
      const currentWeek = weeks.at(-1) ?? null;
      /* A lapsed athlete's window is all zeros; say so instead of showing zeros. */
      const lastSession = overview?.lastSession ?? null;
      const lapsed = (overview?.totals?.sessions ?? 0) === 0;
      const consistent = overview?.consistency ?? null;
      const units = overview?.user?.weightUnit === "lbs" ? t("unitLb") : t("unitKg");

      const header = h(
        "div",
        { className: "dht-head" },
        h(
          "div",
          { className: "dht-head-main" },
          h("h2", { className: "dht-title" }, t("title")),
          h("p", { className: "dht-sub" }, overview?.user?.name ? `${t("subtitle")} · ${overview.user.name}` : t("subtitle")),
        ),
        overview === null
          ? null
          : h("span", { className: "dht-badge" }, overview.cached === true ? t("cached") : t("live")),
        h(
          "button",
          { type: "button", className: "dht-btn", onClick: () => void load(), disabled: status === "loading" },
          t("refresh"),
        ),
      );

      if (openSession !== null) {
        return h(
          "div",
          { className: "dht-page" },
          header,
          h(SessionDetail, {
            title: openSession.title ?? "",
            detail: sessionDetail,
            loading: sessionState === "loading",
            error: sessionError,
            onBack: () => {
              setOpenSession(null);
              setSessionDetail(null);
            },
            t,
          }),
        );
      }

      const tabs = [
        ["overview", t("tabOverview")],
        ["muscles", t("tabMuscles")],
        ["lifts", t("tabLifts")],
        ["weight", t("tabWeight")],
        ["sessions", t("tabSessions")],
      ];

      return h(
        "div",
        { className: "dht-page" },
        header,
        h(
          "div",
          { className: "dht-tabs", role: "tablist" },
          tabs.map(([key, label]) =>
            h(
              "button",
              {
                key,
                type: "button",
                role: "tab",
                className: "dht-tab",
                "data-active": tab === key ? "true" : "false",
                "aria-selected": tab === key ? "true" : "false",
                onClick: () => setTab(key),
              },
              label,
            ),
          ),
        ),
        status === "loading" ? h("div", { className: "dht-body" }, h("div", { className: "dht-note" }, t("loading"))) : null,
        status === "error"
          ? h(
              "div",
              { className: "dht-body" },
              h("div", { className: "dht-note", role: "alert" }, t("loadFailed", { error })),
            )
          : null,
        status === "ready"
          ? h(
              "div",
              { className: "dht-body" },
              tab === "overview"
                ? h(
                    react.Fragment,
                    null,
                    lapsed
                      ? h(
                          "div",
                          { className: "dht-note dht-lapsed" },
                          lastSession === null
                            ? t("neverTrained")
                            : t("lapsed", { weeks: String(overview.weeks), date: lastSession.date }),
                        )
                      : null,
                    h(
                      "div",
                      { className: "dht-cards" },
                      h(StatCard, {
                        label: t("thisWeek"),
                        value: formatInt(currentWeek?.sessions ?? 0),
                        unit: t("sessions"),
                      }),
                      h(StatCard, { label: t("volume"), value: formatInt(currentWeek?.volumeKg ?? 0), unit: units }),
                      h(StatCard, { label: t("sets"), value: formatInt(currentWeek?.sets ?? 0) }),
                      h(StatCard, { label: t("minutes"), value: formatInt(currentWeek?.minutes ?? 0) }),
                      h(StatCard, {
                        label: t("streak"),
                        value: formatInt(consistent?.streak ?? 0),
                        unit: t("week"),
                      }),
                    ),
                    h(
                      Section,
                      {
                        title: t("weeksTitle"),
                        hint: consistent === null ? undefined : t("avgSessions", { value: formatOne(consistent.averageSessions) }),
                      },
                      h(WeeksChart, { weeks, t }),
                    ),
                    h(QualitySection, { quality: overview.quality, t }),
                    overview.prs.length > 0
                      ? h(
                          Section,
                          { title: t("prsTitle") },
                          h(
                            "div",
                            { className: "dht-list" },
                            overview.prs.slice(0, 6).map((pr) =>
                              h(
                                "div",
                                { key: pr.templateId, className: "dht-row" },
                                h(
                                  "div",
                                  { className: "dht-row-main" },
                                  h("div", { className: "dht-row-title" }, pr.title),
                                  h(
                                    "div",
                                    { className: "dht-row-sub" },
                                    `${pr.date} · ${t("previous")} ${formatOne(pr.previousE1rm)} ${t("unitKg")}`,
                                  ),
                                ),
                                h("span", { className: "dht-pr" }, t("pr")),
                                h(
                                  "span",
                                  { className: "dht-row-value" },
                                  `${formatOne(pr.e1rm)} ${t("unitKg")}`,
                                ),
                              ),
                            ),
                          ),
                        )
                      : h(Section, { title: t("prsTitle") }, h("div", { className: "dht-note dht-empty" }, t("prsEmpty"))),
                  )
                : null,
              tab === "muscles"
                ? h(
                    Section,
                    {
                      title: t("musclesTitle"),
                      hint: t("musclesHint", { days: String(overview.muscleWindowDays) }),
                    },
                    h(MuscleBars, { rows: overview.muscles, t }),
                    overview.staleMuscles.length > 0
                      ? h(
                          "div",
                          { className: "dht-note" },
                          `⚠ ${t("stale", {
                            days: "14",
                            groups: overview.staleMuscles.map((row) => muscleLabel(row.group)).join(", "),
                          })}`,
                        )
                      : null,
                  )
                : null,
              tab === "lifts"
                ? h(
                    Section,
                    { title: t("liftsTitle"), hint: t("liftsHint") },
                    overview.lifts.length === 0
                      ? h("div", { className: "dht-note dht-empty" }, t("musclesEmpty"))
                      : h(
                          "div",
                          { className: "dht-list" },
                          overview.lifts.map((lift) =>
                            h(
                              "div",
                              { key: lift.templateId, className: "dht-row" },
                              h(
                                "div",
                                { className: "dht-row-main" },
                                h("div", { className: "dht-row-title" }, lift.title),
                                h(
                                  "div",
                                  { className: "dht-row-sub" },
                                  `${lift.bestWeightKg} ${t("unitKg")} × ${lift.bestReps} · ${lift.bestAt} · ${t("setCount", { count: String(lift.sessions) })}`,
                                ),
                              ),
                              h("span", { className: "dht-row-value" }, `${formatOne(lift.bestE1rm)} ${t("unitKg")}`),
                            ),
                          ),
                        ),
                  )
                : null,
              tab === "weight"
                ? h(
                    Section,
                    {
                      title: t("weightTitle"),
                      hint:
                        overview.weight.latest === null
                          ? undefined
                          : t("weightHint", { count: String(overview.weight.series.length) }),
                    },
                    overview.weight.series.length === 0
                      ? h("div", { className: "dht-note dht-empty" }, t("weightEmpty"))
                      : h(
                          react.Fragment,
                          null,
                          h(
                            "div",
                            { className: "dht-cards" },
                            h(StatCard, {
                              label: t("weightLatest"),
                              value: formatOne(overview.weight.latest.weightKg),
                              unit: units,
                            }),
                            overview.weight.deltaKg === null
                              ? null
                              : h(StatCard, {
                                  label: t("weightDelta"),
                                  value: `${overview.weight.deltaKg > 0 ? "+" : ""}${formatOne(overview.weight.deltaKg)}`,
                                  unit: units,
                                }),
                          ),
                          h(WeightChart, { series: overview.weight.series, t }),
                          overview.weightFreshness?.stale === true
                            ? h(
                                "div",
                                { className: "dht-warn" },
                                t("weightStale", { days: String(overview.weightFreshness.daysSince) }),
                              )
                            : null,
                        ),
                  )
                : null,
              tab === "sessions"
                ? h(
                    react.Fragment,
                    null,
                    h(
                      Section,
                      { title: t("sessionsTitle") },
                      overview.recent.length === 0
                        ? h("div", { className: "dht-note dht-empty" }, t("sessionsEmpty"))
                        : h(
                            "div",
                            null,
                            overview.recent.map((session) =>
                              h(
                                "button",
                                {
                                  key: session.id ?? `${session.date}:${session.title}`,
                                  type: "button",
                                  className: "dht-session",
                                  onClick: () => void openDetail(session),
                                },
                                h(
                                  "span",
                                  null,
                                  h("span", { className: "dht-row-title" }, session.title || "—"),
                                  h(
                                    "span",
                                    { className: "dht-session-sub" },
                                    `${session.date ?? "—"} · ${t("setCount", { count: String(session.sets) })} · ${t("exerciseCount", { count: String(session.exercises.length) })}`,
                                  ),
                                ),
                                h(
                                  "span",
                                  { className: "dht-session-value" },
                                  `${formatInt(session.volumeKg)} ${units} · ${formatInt(session.minutes)} ${t("unitMin")}`,
                                ),
                              ),
                            ),
                          ),
                    ),
                    h(NotesSection, { notes: overview.notes, t }),
                  )
                : null,
            )
          : null,
      );
    }

    /** Client services this half reaches for. */
    const inject = ["slots", "locale"];

    /**
     * Register the panel.
     * @param {import('@deepseek-ai/cordis').Context} ctx - client plugin context.
     * @returns {void}
     */
    function apply(ctx) {
      installStyles();
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-hevy-training: dictionaries");
      const t = ctx.locale.bind(NS);

      ctx.slots.inject("main", () =>
        ctx.slots.register({ name: "main", key: PANEL_ID, locale: NS }, TrainingPage),
      );
      ctx.slots.inject("sidebar.panellist", () =>
        ctx.slots.register(
          { name: "sidebar.panellist", id: PANEL_ID, order: 34, locale: NS, label: () => t("panel") },
          PanelIcon,
        ),
      );
    }

    /* Diagnostics: lets an out-of-band harness render the components directly.
       The shell only reads `name`/`inject`/`apply`. */
    exports.__parts = { TrainingPage, SessionDetail, WeeksChart, WeightChart, MuscleBars, QualitySection, NotesSection };

    exports.name = "dsh-hevy-training";
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});
