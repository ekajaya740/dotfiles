# OmniRoute (ex-9Router) — ai.workofekajaya.com (PUBLIC + tailnet)
# ============================================================
# DNS: A record ai.workofekajaya.com -> 103.59.160.176 (proxied OFF).
#      It previously pointed at 100.102.82.28, which has no public route, so any
#      off-tailnet client (and every config using this as its API base) hung
#      until ERR_CONNECTION_TIMED_OUT.
#      It now resolves to the public address, so in-box callers (omp, opencode,
#      pen, jev-router, genoffice) also resolve it to 103.59.160.176 and reach
#      the public listener. The tailnet-bound block below is not a short-circuit
#      for them: no /etc/hosts entry pins `ai.` locally, so they hairpin through
#      the internet like everyone else. It remains useful only for a client
#      that is explicitly configured to dial 100.102.82.28.
# TLS: Let's Encrypt via certbot DNS-01 (auto-renews). No browser warnings.
#
# Exposure is unchanged in kind: this proxies to the same 127.0.0.1:20128 that
# 9router.workofekajaya.com already serves publicly, and the app's own
# REQUIRE_API_KEY/JWT guard is the auth boundary here too.

server {
    # Public ingress — this is the listener every off-tailnet caller uses now
    # that the A record points here.
    listen 443 ssl;
    listen [::]:443 ssl;
    # Tailnet ingress — NOT a short path for in-box or tailnet clients: they
    # resolve `ai.` to the public A record (no /etc/hosts pin exists), so they
    # arrive on the block above like everyone else. This bind only helps a
    # client explicitly configured to dial 100.102.82.28.
    listen 100.102.82.28:443 ssl;
    listen [fd7a:115c:a1e0::8001:52c8]:443 ssl;
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
    listen 100.102.82.28:80;
    listen [fd7a:115c:a1e0::8001:52c8]:80;
    server_name ai.workofekajaya.com;
    return 301 https://$host$request_uri;
}
