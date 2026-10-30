# OmniRoute (ex-9Router) — ai.workofekajaya.com (PUBLIC, optional tailnet bind)
# ============================================================
# DNS: A record ai.workofekajaya.com -> the host's public address (proxied OFF).
#      It once pointed at the tailnet address, which has no public route, so any
#      off-tailnet client (and every config using this as its API base) hung
#      until ERR_CONNECTION_TIMED_OUT.
#      It now resolves to the public address, so in-box callers (omp, opencode,
#      pen, jev-router, genoffice) also resolve it to the public address and
#      reach the public listener. A tailnet-bound listener is not a short-circuit
#      for them: with no /etc/hosts pin, they hairpin through the internet like
#      everyone else. A tailnet bind only helps a client explicitly configured to
#      dial the tailnet address.
# TLS: Let's Encrypt via certbot DNS-01 (auto-renews). No browser warnings.
#
# Host-specific listeners (a tailnet address, a LAN address) are NOT tracked
# here: an address that resolves on one box is noise on every other. Add them
# per machine in /etc/nginx/snippets/ai-tailnet-*.conf, which the include at the
# bottom picks up — see 9router/etc/nginx/snippets/ai-tailnet.conf.example.
#
# Exposure is unchanged in kind: this proxies to the same 127.0.0.1:20128 that
# 9router.workofekajaya.com already serves publicly, and the app's own
# REQUIRE_API_KEY/JWT guard is the auth boundary here too.

server {
    # Public ingress — this is the listener every off-tailnet caller uses now
    # that the A record points here. A tailnet listener, if this host has one,
    # comes from the machine-local snippet included at the bottom.
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name ai.workofekajaya.com;

    ssl_certificate     /etc/letsencrypt/live/ai.workofekajaya.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ai.workofekajaya.com/privkey.pem;

    client_max_body_size 50M;

    location = /healthz {
        access_log off;
        return 200 "ok\n";
    }

    location / {
        # --- CORS preflight terminator -------------------------------------
        # OmniRoute's dashboardGuard answers 401 to any /v1/* request that has
        # no Authorization header, before the route's own OPTIONS handler runs.
        # A browser CORS preflight never carries credentials, so browser
        # clients (OpenPencil at pen.workofekajaya.com) were blocked here.
        # Answer the preflight locally; the real request still passes the same
        # auth guard, so this is not an open relay.
        if ($request_method = OPTIONS) {
            add_header Access-Control-Allow-Origin  "*" always;
            add_header Access-Control-Allow-Methods "GET, POST, OPTIONS" always;
            add_header Access-Control-Allow-Headers "*" always;
            add_header Access-Control-Max-Age       "86400" always;
            add_header Content-Type                 "text/plain" always;
            return 204;
        }
        # -------------------------------------------------------------------

        proxy_pass http://127.0.0.1:20128;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Accept-Language en;   # force OmniRoute dashboard to English
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;   # SSE streaming for chat completions
    }
}

# HTTP -> HTTPS redirect
server {
    listen 80;
    listen [::]:80;
    server_name ai.workofekajaya.com;
    return 301 https://$host$request_uri;
}

# ----------------------------------------------- host-specific listeners
# A tailnet / LAN listener per machine, so no address that resolves on one box
# is committed. See 9router/etc/nginx/snippets/ai-tailnet.conf.example. The glob
# matches nothing on a host that has none, which is not an error.
include /etc/nginx/snippets/ai-tailnet-*.conf;
