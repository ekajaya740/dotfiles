// DSH Open Access — keyless browser entry, LAN hostname access, and a
// Tailscale address alias for a DeepSeek Harness web profile.
//
// Three capabilities, one plugin:
//
// 1. noAuth — a first visit to / without a token mints the browser session
//    cookie by itself (HTTP 303 + Set-Cookie) instead of demanding the
//    launch token. Implemented by wrapping the *running* `connection`
//    service's `authorizeIndex`, not by editing node_modules: nothing on
//    disk changes, so an install/update cannot leave a half-patched copy
//    behind, and uninstalling restores the token gate on the next start.
//
// 2. aliases — byte-level TCP forwarders (lib/alias.js) that let 127.0.0.1
//    and the host's Tailscale address answer on the web port even though
//    the harness binds exactly one address. Hostname access on the host
//    itself (http://<machine-name>:<port>/ where DNS maps the machine name
//    to 127.0.0.1) rides the loopback alias.
//
// 3. trustedHosts — every extra Host header the aliases can produce is
//    added to the /api browser-trust fence by appending to the live
//    service's own array: the machine hostname (as DNS resolves it on the
//    host, both ways) and the Tailscale IP. The dsh bind address is always
//    trusted implicitly and is never added here.
//
// Nothing here weakens the fence for strangers: only authorities that name
// this machine are admitted. But with noAuth the browser gate is gone by
// design — anyone who can reach the port owns the harness. Serve it on a
// network you trust.

import { createHash, createHmac } from "node:crypto";
import { hostname } from "node:os";
import { forwardAddress, localAddresses } from "./alias.js";

/** Stable Cordis plugin name. */
export const name = "open-access";

/** Human-facing plugin name; the plugin manager reads the same text from locale/en.json. */
export const title = "DSH Open Access";

/** Services this plugin waits for: the HTTP carrier and the browser transport. */
export const inject = ["webServer", "connection"];

/** Environment variable that arms the no-auth cookie mint for this process. */
export const NOAUTH_ENV = "DSH_OPEN_ACCESS";

const COOKIE_PREFIX = "dsh-auth-";
// Payload shape the installed client-connection verifies (COOKIE_PAYLOAD_VERSION).
const COOKIE_PAYLOAD_VERSION = 1;

/**
 * Resolve and validate the row config without a schema dependency: the
 * profile does not hoist `@deepseek-ai/schemastery` to this link target, so a
 * bare import of it fails at activation. Standard-schema shape, as the
 * loader expects.
 * @param {unknown} input - row config from cordis.patch.yml.
 */
function resolveConfig(input) {
  const raw = input ?? {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new TypeError("config must be an object");
  }
  const bool = (key, fallback) => {
    const value = raw[key];
    if (value === void 0) return fallback;
    if (typeof value !== "boolean") throw new TypeError(`config.${key} must be a boolean`);
    return value;
  };
  const hosts = raw.trustedHosts ?? [];
  if (!Array.isArray(hosts) || hosts.some((host) => typeof host !== "string")) {
    throw new TypeError("config.trustedHosts must be an array of strings");
  }
  return {
    value: {
      /** Mint the session cookie on a plain first visit (no ?token=). */
      noAuth: bool("noAuth", true),
      /** Forward 127.0.0.1:<port> to the bind address (hostname-on-host access). */
      aliasLoopback: bool("aliasLoopback", true),
      /** Forward <tailscale-ip>:<port> to the bind address (tailnet access). */
      aliasTailscale: bool("aliasTailscale", true),
      /** Extra authorities (hosts) to admit besides hostname and Tailscale IP. */
      trustedHosts: hosts,
    },
  };
}

export const Config = { "~standard": { version: 1, vendor: "dsh-open-access", validate: resolveConfig } };

// ── 1. no-auth: wrap the live connection service ─────────────────────────────

const base64url = (value) => Buffer.from(value).toString("base64url");
const sha256 = (value) => createHash("sha256").update(value).digest();

/** The authority a request is bound to: `new URL("http://" + host).host`. */
function requestAuthority(headers) {
  const host = headers.host;
  if (typeof host !== "string" || host === "") return void 0;
  try {
    return new URL(`http://${host}`).host;
  } catch {
    return void 0;
  }
}

/**
 * Mint the same signed, authority-bound cookie the ?token= flow mints, using
 * the running BrowserAuth's own secret and lifetime.
 * @returns {{name: string, value: string, expiresAt: number, maxAgeSeconds: number}}
 */
function mintCookie(auth, authority) {
  const issuedAt = Date.now();
  const expiresAt = issuedAt + auth.maxAgeMilliseconds;
  const body = base64url(JSON.stringify({ version: COOKIE_PAYLOAD_VERSION, authority, issuedAt, expiresAt }));
  const signature = base64url(createHmac("sha256", auth.secret).update(body).digest());
  return {
    name: COOKIE_PREFIX + base64url(sha256(authority)),
    value: `v1.${body}.${signature}`,
    expiresAt,
    maxAgeSeconds: Math.floor(auth.maxAgeMilliseconds / 1e3),
  };
}

/**
 * Wrap `connection.authorizeIndex` so a plain first visit mints its own
 * browser session cookie while the plugin has armed the env flag. The
 * original method keeps serving every other request untouched.
 * @param {object} connection - the running HostConnectionService.
 * @param {(message: string) => void} log - line logger.
 * @returns {() => void} disposer restoring the original method.
 */
function wrapAuthorizeIndex(connection, log) {
  const auth = connection.browserAuth;
  if (auth === void 0 || typeof auth.isAuthenticated !== "function" || auth.secret === void 0) {
    throw new Error(`${title}: the installed dsh-client-connection no longer exposes browserAuth; not installing the keyless entry`);
  }
  const original = connection.authorizeIndex;
  if (typeof original !== "function") {
    throw new Error(`${title}: connection.authorizeIndex is missing; not installing the keyless entry`);
  }
  connection.authorizeIndex = function authorizeIndexWithOpenAccess(req, res) {
    if (process.env[NOAUTH_ENV] === "1" && req.method === "GET") {
      let pathname;
      try {
        pathname = new URL(req.url ?? "/", "http://dsh.invalid").pathname;
      } catch {
        pathname = undefined;
      }
      if (pathname === "/" && !auth.isAuthenticated(req)) {
        const authority = requestAuthority(req.headers);
        if (authority !== void 0) {
          const cookie = mintCookie(auth, authority);
          res.writeHead(303, {
            "cache-control": "no-store",
            "location": "./",
            "referrer-policy": "no-referrer",
            "set-cookie":
              `${cookie.name}=${cookie.value}; Max-Age=${String(cookie.maxAgeSeconds)}; Path=/; ` +
              `Expires=${new Date(cookie.expiresAt).toUTCString()}; HttpOnly; SameSite=Strict`,
          });
          res.end();
          return false;
        }
      }
    }
    return original.call(connection, req, res);
  };
  log(`${title}: browser entry needs no token (uninstall the plugin, or set config noAuth:false, to restore the gate)`);
  return () => {
    connection.authorizeIndex = original;
  };
}

// ── 2+3. aliases and trusted hosts ───────────────────────────────────────────

/** The webserver's listening port, or 3080 before it binds. */
function webPort(ctx) {
  return ctx.webServer?.port ?? 3080;
}

/** The webserver's bind address, or 127.0.0.1 before it binds. */
function webHost(ctx) {
  return ctx.webServer?.host ?? "127.0.0.1";
}

/** DNS names that reach this host from the host itself. */
function hostnameAuthorities() {
  const machine = hostname();
  return machine ? [machine, `${machine}.local`].filter((v, i, a) => a.indexOf(v) === i) : [];
}

/**
 * Append `hosts` to the live connection service's own trustedHosts array,
 * preserving what the bundle's `!!js ctx.webRuntime.trustedHosts` expression
 * already put there. The fence reads this array per request, so no entry
 * restart — and no dropped WebSocket — is involved.
 * @returns {string[]} the authorities this call actually added.
 */
function admitHosts(connection, hosts) {
  const list = connection.trustedHosts;
  if (!Array.isArray(list)) {
    throw new Error(`${title}: connection.trustedHosts is not an array; cannot admit ${JSON.stringify(hosts)}`);
  }
  const added = [];
  for (const host of hosts) {
    if (!host || list.includes(host)) continue;
    list.push(host);
    added.push(host);
  }
  return added;
}

/**
 * Plugin entry. Runs after webServer and connection exist: arms the no-auth
 * entry, patches the trust fence, starts the aliases, and disposes of
 * everything when the profile stops.
 */
export async function apply(ctx, config) {
  const cfg = config ?? {};
  const logs = [];

  const target = { host: webHost(ctx), port: webPort(ctx) };
  const detected = localAddresses();
  const forwarders = [];

  // 1. no-auth: wrap the running service; nothing on disk changes.
  if (cfg.noAuth !== false) {
    process.env[NOAUTH_ENV] = "1";
    ctx.effect(() => wrapAuthorizeIndex(ctx.connection, (m) => logs.push(m)), `${name}: keyless entry`);
  } else {
    process.env[NOAUTH_ENV] = "0";
  }

  // 2. aliases: loopback (hostname-on-host) and the Tailscale address.
  const aliasLoopback = cfg.aliasLoopback !== false;
  const aliasTailscale =
    cfg.aliasTailscale !== false && detected.tailscale !== undefined && detected.tailscale !== target.host;
  if (aliasLoopback && (target.host !== "127.0.0.1" || !aliasTailscale)) {
    forwarders.push(forwardAddress({ host: "127.0.0.1", port: target.port }, target, (m) => logs.push(m)));
  }
  if (aliasTailscale) {
    forwarders.push(forwardAddress({ host: detected.tailscale, port: target.port }, target, (m) => logs.push(m)));
  }
  ctx.effect(
    () => async () => {
      await Promise.allSettled(forwarders.map((f) => f.dispose()));
    },
    `${name}: address aliases`,
  );

  // 3. trusted hosts: every Host the aliases can produce plus the machine
  //    name, admitted by the /api fence. The bind address needs no entry;
  //    the fence already accepts it.
  const wanted = new Set(cfg.trustedHosts ?? []);
  if (aliasLoopback) for (const host of hostnameAuthorities()) wanted.add(host);
  if (aliasTailscale) wanted.add(detected.tailscale);
  wanted.delete(target.host);
  const extra = [...wanted].filter(Boolean);
  const added = extra.length > 0 ? admitHosts(ctx.connection, extra) : [];

  for (const line of logs) console.log(line);
  if (added.length > 0) console.log(`${title}: trusted authorities: ${added.join(", ")}`);
}
