# DeepSeek Harness (dsh) Web UI — dsh.workofekajaya.com
# =====================================================
# Tracked, host-agnostic copy. Everything in this file is the same on every
# machine that serves the harness: the public listener, its TLS pair, and the
# redirect. Anything that names a *host* — a tailnet address, a MagicDNS name,
# a per-machine cert path — lives in a machine-local snippet that this file
# includes, so the repo never records an address that only resolves on one box:
#
#   /etc/nginx/snippets/dsh-tailnet-<host>.conf
#
# Install one per host from dsh/etc/nginx/snippets/dsh-tailnet.conf.example (the
# include below is a glob, so a host with no tailnet listener simply has no
# matching file and nginx is happy).
#
# Upstream: dsh web, bound to 127.0.0.1:3080. TLS: Let's Encrypt via certbot
# DNS-01 (auto-renews). No browser warnings.
#
# Why the split: the harness is shell-capable, so anything arriving from the
# internet needs a password. nginx injects the durable dsh browser-session
# cookie (snippets/dsh-web-cookie.conf) because dsh requires one — that is what
# removes the per-boot `?token=` URL, and it is also why the public block must
# have auth_basic in front: without it the cookie alone would be a full login.
#
# The public listener is kept for an explicit IP literal, and it keeps auth_basic
# because it is the one listener the open internet can touch. Do not try to
# relax it with `satisfy any; allow 100.64.0.0/10;`: with AdvertiseRoutes null
# and RouteAll false, nothing routes the public IP into the tailnet, so a peer
# dialing the public address arrives on eth0 with its own public source address
# and the allow-list never matches.
#
# `tailscale serve` is NOT a substitute for a tailnet listener and cannot be
# made one: dsh answers 401 to every request without its authority-bound cookie
# and 403 to every /api request whose Host is not in `trustedHosts`
# (`dsh web --trusted-host`), and tailscale's proxy can inject neither.
# Measured through it: html 401, api 403. nginx is the only front that does both.

# ---------------------------------------------------------------- public
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name dsh.workofekajaya.com;

    ssl_certificate     /etc/letsencrypt/live/dsh.workofekajaya.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dsh.workofekajaya.com/privkey.pem;

    client_max_body_size 50M;

    location = /healthz {
        access_log off;
        return 200 "ok\n";
    }

    location / {
        # Kept only for explicit IP-literal access (https://<public-ip>/ with a
        # Host of this name). The NAME may resolve to a tailnet listener on
        # hosts that add one, so this block is not what a normal client reaches,
        # and it must keep auth_basic because it is the one listener an
        # off-tailnet client can touch.
        auth_basic           "dsh";
        auth_basic_user_file /etc/nginx/.htpasswd-public;

        proxy_pass http://127.0.0.1:3080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
        proxy_buffering off;   # SSE / WS streaming for the harness UI

        include /etc/nginx/snippets/dsh-web-cookie.conf;
    }
}

# ------------------------------------------------------------ http -> https
server {
    listen 80;
    listen [::]:80;
    server_name dsh.workofekajaya.com;
    return 301 https://$host$request_uri;
}

# ----------------------------------------------- host-specific listeners
# A tailnet / LAN / second-authority listener per machine. See
# dsh/etc/nginx/snippets/dsh-tailnet.conf.example. The glob matches nothing on a
# host that has none, which is not an error.
include /etc/nginx/snippets/dsh-tailnet-*.conf;
