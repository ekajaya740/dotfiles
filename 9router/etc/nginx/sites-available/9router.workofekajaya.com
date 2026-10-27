# 9Router — 9router.workofekajaya.com (PUBLIC front door)
# ======================================================
# DNS: A record 9router.workofekajaya.com -> 103.59.160.176 (proxied OFF, DNS-only).
# TLS: Let's Encrypt via certbot DNS-01 (auto-renews). No browser warnings.
# Upstream: systemd system unit 9router.service (node, 127.0.0.1:20128).
# Auth: the app's own JWT login (REQUIRE_API_KEY=true, AUTH_COOKIE_SECURE=true).
#       A Secure cookie only survives on https, which is what this vhost gives
#       it; the old cleartext :20128 exposure could never hold a session. The
#       port is refused with a TCP reset on eth0 by 9router-firewall.service.
#
# SECURITY: the app binds 0.0.0.0:20128 despite the unit setting
# HOSTNAME=127.0.0.1 — it ignores that variable. So 9router-firewall.service
# (iptables REJECT on eth0) is the ONLY thing keeping :20128 off the internet.
# That unit is enabled; if it is ever disabled or fails, the port is exposed.
# ai.workofekajaya.com serves the same upstream and is also publicly routable
# now; it used to be a tailnet-only alias, which made every client configured
# with that base URL hang until ERR_CONNECTION_TIMED_OUT. Keep the two vhosts
# behaviourally in sync — in particular the CORS preflight terminator below,
# without which browser clients cannot reach /v1 at all.

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name 9router.workofekajaya.com;

    ssl_certificate     /etc/letsencrypt/live/9router.workofekajaya.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/9router.workofekajaya.com/privkey.pem;

    client_max_body_size 50M;

    location = /healthz {
        access_log off;
        return 200 "ok\n";
    }

    location / {
        # --- CORS preflight terminator -------------------------------------
        # dashboardGuard answers 401 to any /v1/* request carrying no
        # Authorization header, before the route's own OPTIONS handler runs.
        # A browser CORS preflight never carries credentials, so without this
        # every browser client is blocked. The real request still passes the
        # same auth guard, so this is not an open relay. Mirrors the internal
        # ai.workofekajaya.com vhost.
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
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;   # SSE streaming for chat completions
    }
}

# HTTP -> HTTPS redirect
server {
    listen 80;
    listen [::]:80;
    server_name 9router.workofekajaya.com;
    return 301 https://$host$request_uri;
}
