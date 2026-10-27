# DeepSeek Harness (dsh) Web UI — dsh.workofekajaya.com
# =====================================================
# The NAME resolves to the tailnet address, so ordinary access has no prompt:
#
#   DNS        dsh.workofekajaya.com -> 100.64.0.10 (tailnet A, proxied OFF)
#   tailnet    100.64.0.10:443     -> no prompt; tailnet membership IS the boundary
#   public     203.0.113.10:443    -> HTTP Basic; only reachable by IP literal
#
# Why the name points at 100.x: every client that has ever used this vhost is a
# tailnet device. Pointing the name at the public address instead forced all of
# them through the Basic prompt, which is the "login page" this vhost must not
# have. Tailscale is installed on each device, so the name works wherever they
# are; off-tailnet clients simply cannot route 100.x and never reach it.
#
# The public listener is kept only for an explicit IP literal, and it keeps
# auth_basic because it is the one listener the open internet can touch. Do not
# try to relax it with `satisfy any; allow 100.64.0.0/10;`: with AdvertiseRoutes
# null and RouteAll false, nothing routes the public IP into the tailnet, so a
# peer dialing 203.0.113.10 arrives on eth0 with its own public source address
# and the allow-list never matches.
# TLS: Let's Encrypt via certbot DNS-01 (auto-renews). No browser warnings.
# Upstream: dsh web, bound to 127.0.0.1:3080.
#
# Why the split: the harness is shell-capable, so anything arriving from the
# internet needs a password. nginx injects the durable dsh browser-session
# cookie (snippets/dsh-web-cookie.conf) because dsh requires one — that is what
# removes the per-boot `?token=` URL, and it is also why the public block must
# have auth_basic in front: without it the cookie alone would be a full login.
# A third listener serves the SAME upstream on the MagicDNS name, so the tailnet
# has a short, memorizable, passwordless URL:
#
#   https://magicdns.example.ts.net:8444  -> no prompt, tailnet-only bind
#
# `tailscale serve` is NOT a substitute and cannot be made one: dsh answers 401
# to every request without its authority-bound cookie and 403 to every /api
# request whose Host is not in `trustedHosts` (`dsh web --trusted-host`), and
# tailscale's proxy can inject neither. Measured through it: html 401, api 403.
# nginx is the only front that does both.
#
# :8444 rather than :443 because MagicDNS :443 already belongs to the 9router
# vhost (`nine-router-tailscale`); nginx picks a server block by listen address
# and port first, so a second `:443 server_name dsh-host...` would never match.
#
# Host must carry the port (`$http_host`, not `$host`): the browser-trust fence
# compares `new URL(Origin).host` byte-for-byte against the request Host, and a
# browser at :8444 sends `Origin: https://magicdns.example.ts.net:8444`.
# With `$host` (port stripped) every POST /api answers 403.
#
# The cookie snippet is per-authority because the cookie NAME hashes the
# authority, port included (snippets/dsh-web-cookie-tailnet.conf).


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
        # Kept only for explicit IP-literal access (https://203.0.113.10/ with
        # a Host of this name). The NAME does not resolve here — the A record
        # points at the tailnet address below — so this block is not what a
        # normal client reaches, and it must keep auth_basic because it is the
        # one listener an off-tailnet client can touch.
        #
        # Do NOT add `satisfy any; allow 100.64.0.0/10;` here. It was tried and
        # removed: with AdvertiseRoutes null and RouteAll false, nothing routes
        # the public IP into the tailnet, so a peer dialing 203.0.113.10
        # arrives on eth0 with its own public source address and the allow-list
        # never matches. It looked plausible and did nothing.
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

# --------------------------------------------------------------- tailnet
server {
    listen 100.64.0.10:443 ssl;
    listen [fd7a:115c:a1e0::1]:443 ssl;
    server_name dsh.workofekajaya.com;

    ssl_certificate     /etc/letsencrypt/live/dsh.workofekajaya.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dsh.workofekajaya.com/privkey.pem;

    client_max_body_size 50M;

    # No auth_basic: tailnet-only by bind address (see header).
    location / {
        proxy_pass http://127.0.0.1:3080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
        proxy_buffering off;

        include /etc/nginx/snippets/dsh-web-cookie.conf;
    }
}

# ---------------------------------------------------- tailnet, MagicDNS :8444
server {
    listen 100.64.0.10:8444 ssl;
    listen [fd7a:115c:a1e0::1]:8444 ssl;
    server_name magicdns.example.ts.net;

    # The tailnet cert (SAN magicdns.example.ts.net only). Renewed by
    # host-ts-cert-refresh.timer, which also reloads nginx.
    ssl_certificate     /etc/nginx/ssl/host.ts.crt;
    ssl_certificate_key /etc/nginx/ssl/host.ts.key;

    client_max_body_size 50M;

    # No auth_basic and no ?token=: the bind address is tailnet-only and the
    # injected cookie is authority-bound, so a stolen cookie is useless off this
    # host:port. Every tailnet device is a full operator here — same boundary as
    # the named tailnet block above.
    location / {
        proxy_pass http://127.0.0.1:3080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $http_host;   # keep :8444 for the Origin fence
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
        proxy_buffering off;

        include /etc/nginx/snippets/dsh-web-cookie-tailnet.conf;
    }
}

# ------------------------------------------------------------ http -> https
server {
    listen 80;
    listen [::]:80;
    listen 100.64.0.10:80;
    listen [fd7a:115c:a1e0::1]:80;
    server_name dsh.workofekajaya.com;
    return 301 https://$host$request_uri;
}
