#!/usr/bin/env node
/**
 * jev-router status line — Claude Code's model plus the last Jev routing pick.
 *
 * Claude Code pipes a JSON status object to stdin (session_id, model, cwd, …).
 * The fields are read tolerantly: anything missing is simply omitted, and any
 * error falls back to Claude's own model name so the line never breaks.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

function lastAction() {
  try {
    const lines = fs.readFileSync(path.join(os.homedir(), ".claude", "jev-router.jsonl"), "utf8").trim().split("\n");
    const rec = JSON.parse(lines[lines.length - 1]);
    if (rec.action === "explore/haiku") return "jev→Explore/haiku";
    if (rec.action === "advise") return "jev·advise";
    return null;
  } catch {
    return null;
  }
}

function main(stdin) {
  let data = {};
  try {
    data = JSON.parse(stdin || "{}");
  } catch {
    /* ignore */
  }
  const parts = [];
  if (data?.model?.display_name) parts.push(data.model.display_name);
  const action = lastAction();
  if (action) parts.push(action);
  if (typeof data?.cost?.total_lines_added === "number") parts.push(`+${data.cost.total_lines_added}`);
  return parts.join(" · ") || "claude";
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (buf += c));
process.stdin.on("end", () => {
  try {
    process.stdout.write(main(buf));
  } catch {
    process.stdout.write("claude");
  }
});
