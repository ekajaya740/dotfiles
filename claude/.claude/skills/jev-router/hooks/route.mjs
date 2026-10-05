#!/usr/bin/env node
/**
 * jev-router — Claude Code PreToolUse hook on Agent/Task calls.
 *
 * Asks TypeSafe Jev (System One), through the 9router gateway, which agent and
 * model a subagent call needs. The hook makes ONE change only: a read-only
 * lookup that Jev is at least 0.8 sure about, on both the agent type and the
 * model, is rewritten to the `Explore` agent on the `haiku` alias. Everything
 * else runs exactly as Claude Code set it up, and any Jev error or timeout
 * leaves the call untouched (fail-open). Downward only: a call already on
 * haiku is never touched, and the model is never raised.
 *
 * Effort is also asked for (report-only) and logged; the hook never applies it,
 * because raising effort made results worse in the original benchmark.
 *
 * Env:
 *   JEV_ROUTER_MODE        apply (default) | advise (never rewrite)
 *   JEV_ROUTER_AGENT_MIN   agent confidence gate (default 0.8)
 *   JEV_ROUTER_MODEL_MIN   model confidence gate (default 0.8)
 *   JEV_ROUTER_DEBUG       1 to log the pick to stderr
 *   JEV_API_BASE_URL       SystemOne endpoint (default 9router)
 *   JEV_MCP_MODEL          Jev model id (default openrouter/typesafe/jev-1.13)
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const MODE = (process.env.JEV_ROUTER_MODE || "apply").toLowerCase();
const AGENT_MIN = num(process.env.JEV_ROUTER_AGENT_MIN, 0.8);
const MODEL_MIN = num(process.env.JEV_ROUTER_MODEL_MIN, 0.8);
const DEBUG = process.env.JEV_ROUTER_DEBUG === "1";
const BASE_URL = process.env.JEV_API_BASE_URL || "https://ai.workofekajaya.com/v1/systemone";
const JEV_MODEL = process.env.JEV_MCP_MODEL || "openrouter/typesafe/jev-1.13";
const KEY = process.env.NINEROUTER_API_KEY || "";
const KEY_HELPER = process.env.JEV_API_KEY_HELPER || "zsh -c 'printenv NINEROUTER_API_KEY'";
const LOG = path.join(os.homedir(), ".claude", "jev-router.jsonl");

const Q_AGENT = "agent";
const Q_MODEL = "model";
const Q_EFFORT = "effort";

// Model strength tiers. A call is only moved if the requested model is absent
// (inherit) or strictly stronger than haiku — never raised, never re-routed.
const TIER = { haiku: 0, sonnet: 1, opus: 2, fable: 3 };
const tierOf = (m) => {
  if (!m || m === "inherit" || m === "best") return -1;
  const s = String(m).toLowerCase();
  for (const [k, v] of Object.entries(TIER)) if (s.includes(k)) return v;
  return -1;
};

function num(v, d) {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : d;
}
const log = (m) => DEBUG && process.stderr.write(`[jev-router] ${m}\n`);

async function resolveKey() {
  if (KEY) return KEY;
  try {
    const { execSync } = await import("node:child_process");
    return execSync(KEY_HELPER, { encoding: "utf8", timeout: 4000, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function record(rec) {
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), ...rec }) + "\n");
  } catch {
    /* best effort */
  }
  try {
    fs.writeFileSync(
      path.join(os.tmpdir(), `jev-router-${rec.session_id || "default"}.json`),
      JSON.stringify(rec),
    );
  } catch {
    /* best effort */
  }
}

/** One SystemOne request: agent type, model, and (report-only) effort. */
async function askJev(prompt, currentAgent, key) {
  const state = { task: prompt, current_agent: currentAgent || "general-purpose" };
  const questions = {
    [Q_AGENT]: {
      type: "choice",
      instructions:
        "Which agent type should run this task? Pick Explore only for a bounded " +
        "read-only lookup a fast cheap model can complete: counting, listing, " +
        "locating a file, or finding where a value is configured. Pick Plan for " +
        "design or architecture, and general-purpose for anything that reasons, " +
        "analyses, edits, or must be right. When unsure, do not pick Explore.",
      criteria: {
        Explore: "Read-only lookup: count, list, locate, or grep-and-read. No analysis, no edits, no multi-step reasoning.",
        Plan: "Design or architecture where the main job is producing a plan.",
        "general-purpose": "Analysis, editing, writing, security, or any multi-step reasoning task.",
      },
    },
    [Q_MODEL]: {
      type: "choice",
      instructions: "Which model is the cheapest that can still do this task correctly?",
      criteria: {
        haiku: "Simple lookups, file counts, grep-style searches.",
        sonnet: "Standard reasoning and multi-step work.",
        opus: "Hardest tasks needing the strongest model.",
        fable: "Open-ended work with no clear path.",
      },
    },
    [Q_EFFORT]: {
      type: "score",
      instructions: "How much reasoning effort does this task need?",
      criteria: ["low", "medium", "high", "xhigh"],
    },
  };
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 4000);
  try {
    const res = await fetch(BASE_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: JEV_MODEL, state, questions }),
      signal: ac.signal,
    });
    if (!res.ok) return null;
    return (await res.json())?.answers ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  let e;
  try {
    e = JSON.parse(raw);
  } catch {
    return;
  }
  if (!/^(task|agent)$/i.test(e.tool_name || "")) return;
  const input = e.tool_input || {};
  const prompt = String(input.prompt || input.description || "").slice(0, 4000);
  if (!prompt) return;

  const requestedModel = input.model;
  const requestedTier = tierOf(requestedModel);

  const key = await resolveKey();
  if (!key) return;

  const answers = await askJev(prompt, input.subagent_type, key);
  if (!answers) return;

  const agent = answers[Q_AGENT] || {};
  const model = answers[Q_MODEL] || {};
  const effort = answers[Q_EFFORT] || {};

  const conf = (a) => (typeof a.confidence === "number" ? a.confidence : 0);
  const ac = conf(agent);
  const mc = conf(model);

  const isLookup =
    agent.choice === "Explore" &&
    ac >= AGENT_MIN &&
    model.choice === "haiku" &&
    mc >= MODEL_MIN &&
    (requestedTier < 0 || requestedTier > TIER.haiku);

  const rec = {
    session_id: e.session_id,
    tool: e.tool_name,
    agent: agent.choice,
    agent_conf: ac,
    model: model.choice,
    model_conf: mc,
    effort: effort.score,
    requested: requestedModel || "inherit",
    action: isLookup && MODE === "apply" ? "explore/haiku" : isLookup ? "advise" : "pass",
  };
  log(JSON.stringify(rec));

  if (MODE === "advise" || !isLookup) {
    record(rec); // advise/pass-through still shows in the status line
    return;
  }

  record(rec);
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: { ...input, subagent_type: "Explore", model: "haiku" },
      },
    }),
  );
}

main().catch(() => process.exit(0));
