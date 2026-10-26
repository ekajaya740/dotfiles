# DeepSeek Harness (dsh) Web UI — dsh.workofekajaya.com (TAILSCALE-ONLY)
# =====================================================================
# DNS: A record dsh.workofekajaya.com -> 100.64.0.10 (tailscale IP, proxied OFF)
#      Public internet cannot route 100.x — reachable only from tailnet devices.
# TLS: Let's Encrypt via certbot DNS-01 (auto-renews). No browser warnings.
# Auth: none at the app layer. The socket binds the tailscale IP only, so
#       tailnet membership IS the authentication boundary. nginx injects the
#       durable dsh browser-session cookie (snippets/dsh-web-cookie.conf,
#       re-minted by dsh-web-cookie-refresh) because dsh itself still requires
#       one; that is what removes the per-boot `?token=` URL.
#
#       Consequence: every device on the tailnet gets full operator access to a
#       shell-capable harness with no prompt. Narrow it with `allow`/`deny` or
#       Tailscale ACLs if that is ever too broad.

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
        proxy_buffering off;   # SSE / WS streaming for the harness UI

        # Supply the dsh browser-session cookie server-side (see header).
        include /etc/nginx/snippets/dsh-web-cookie.conf;
    }
}

# HTTP -> HTTPS redirect
server {
    listen 100.64.0.10:80;
    listen [fd7a:115c:a1e0::1]:80;
    server_name dsh.workofekajaya.com;
    return 301 https://$host$request_uri;
}
