# dsh-pwa

Progressive Web App support for the **DSH Web GUI** — installable, app-window,
offline-aware — delivered as a local cordis plugin instead of a patch to the
shipped frontend build.

Nothing under the frontend dist is touched. The plugin claims a handful of
routes on the host web server and rewrites the index `<head>` on the way out.

## What it adds

| Piece | Where | Why |
| --- | --- | --- |
| Rich web app manifest | `GET /manifest.webmanifest` | replaces the shipped 255-byte one: `display: standalone`, `theme_color`, `background_color`, `id`, five PNG icons |
| Service worker | `GET /sw.js` | caches the ~1.4 MB hashed JS/CSS bundle (the static server sends **no** `cache-control`, so every reload re-downloaded it) |
| PNG icon set | `GET /pwa/icons/*.png` | 192/512 `any`, 192/512 `maskable`, 512 `monochrome`, 180 `apple-touch`, 32 favicon |
| Offline document | `GET /pwa/offline.html` | honest "you're offline" page instead of a dead network error; brand glyph inlined so it needs zero requests |
| Index tap | every index render | absolute manifest link, iOS metas, PNG icon links, install/update chips |
| Mobile pass | inlined `<style>` + client script | overlay drawer with a real scrim, 16px editables (no iOS focus zoom), 44px touch targets |

Installing is then the normal browser flow: the address-bar install icon in
Chrome/Edge, **Share → Add to Home Screen** in Safari, **Install** in the
Chromium app menu — plus an "Install app" chip the plugin offers itself.

## Caching policy

The rules are deliberately conservative, because this is a live harness rather
than a content site:

- `/assets/*` — **cache-only**. The frontend build content-hashes these names, so
  a cached copy can never be stale; a new build produces new names that miss and
  refill. Trimmed at 96 entries.
- `/plugins/*` — **stale-while-revalidate**. These carry `?rev=`, so serving the
  cached copy and refreshing behind it means a plugin upgrade self-heals on the
  next load instead of pinning an old build. Trimmed at 32 entries.
- `/pwa/*`, `/manifest.webmanifest`, `favicon*.svg` — **cache-first with
  background revalidate** (stable URLs whose content can change).
- Navigations — **network-only**. The served index carries a per-boot payload and
  an auth fence; a cached shell would boot into a half-dead app. Offline → the
  offline document.
- Everything else, including `/api/*` — **untouched**. Nothing that carries
  session state goes anywhere near a cache.

The cache version is a SHA-256 over every byte this plugin serves (manifest,
worker source, client script, offline page, glyph, icons, per-file media types).
It is stable across restarts and unchanged content, so a reload never loops on a
"new version" chip, and changes exactly when an asset here changes.

## Mobile

The upstream layout is a desktop grid that assumes a mouse and a wide window. On
a phone it is usable but unpleasant in three specific ways, so the plugin fixes
those three and nothing else — no restyling, no theming, no layout redesign.

**1. The sidebar was a grid column, not a drawer.** Below ~1000px the app
collapses to a 56px icon rail, which is correct. But opening it re-assigns the
frame's first grid track from `56px` to `280px`, and the track list is written as
an *inline style* on the frame — so the conversation column collapsed to 110px
behind the drawer instead of staying full width. There was also no scrim: the
only way back was a 28×28 button.

The fix tags the frame and its three column wrappers from the client script
(`data-dsh-pwa-*`, because the runtime class names are hashed and unstable) and
then, under `max-width: 1023px`:

- pins the frame to `grid-template-columns: 56px minmax(0,1fr) 0px !important`,
  which beats the inline style;
- re-pins the centre and rightbar wrappers to tracks 2 and 3, because taking the
  sidebar out of flow would otherwise let them re-flow into the vacated track;
- turns the sidebar column into `position: absolute` — a real overlay drawer at
  `min(280px, 88vw)` with a shadow;
- appends a scrim that is shown only while the drawer is open.

Tapping the scrim closes the drawer, as does Escape. Closing is done by clicking
the app's own collapse button rather than poking at React state, so the app's
collapse state stays authoritative and no internal API is touched.

**2. iOS zoomed the viewport on every tap into the composer.** The composer is a
`contenteditable` div at `14px`, and Mobile Safari zooms the page whenever a
focused editable is under 16px. Raising editables to `16px` under
`(pointer: coarse)` removes the trigger. `maximum-scale=1` / `user-scalable=no`
is the usual shortcut and is deliberately not used here — it also disables
pinch-zoom, which is an accessibility regression for anyone who needs to magnify.
The viewport meta is left exactly as shipped.

**3. Controls were 28–36px.** Under `(pointer: coarse)` the sidebar controls grow
to 44px tall (and 44px wide on the collapsed rail), and the composer's row of
pickers and buttons grows to 44px tall. Two details learned the hard way:

- An oversized `::after` pseudo-element does **not** work as a hit area. Chrome
  does not hit-test a pseudo-element spilling outside its button, so a 120×120
  `::after` on a 36×36 button still misses taps 20px out. The real box has to
  grow.
- Growing a box only helps if nothing clips it. Several decorative wrappers in
  the rail are sized to the old 36px control and carry `overflow: hidden`, so the
  rules open exactly those ancestors — the scrollable sidebar list is left alone
  and simply grows its own `scrollWidth`/`scrollHeight`.

Drawer width grows horizontally only on the collapsed rail; in the drawer the
icon-only controls sit on a 32px pitch, and widening them there would make
neighbours steal each other's taps. Every mobile rule lives inside a media query,
so desktop is untouched — `test/e2e.mjs` asserts that too.

## Install into a profile

The plugin is already wired into the `web` profile. To wire it into another:

```bash
# 1. declare it as a local dependency
cd ~/.dsh/profiles/<profile>
pnpm add link:/home/personal/dsh-pwa        # or edit package.json dependencies

# 2. list it as a bundle, in package.json → dsh.profile.bundles
#    (the plugin's own cordis.patch.yml inserts its row; do NOT also insert it
#     in the profile's cordis.patch.yml — the duplicate route registration throws)
```

Config is optional; the defaults are what the `web` profile runs:

```yaml
- id: dsh-pwa
  config:
    enabled: true        # false → register nothing at all
    installPrompt: true  # false → keep the worker, drop the "Install app" chip
```

## Layout

```
lib/index.js      host half: routes, manifest, index tap
lib/sw.js         service worker source (VERSION substituted at serve time)
lib/client.js     inlined into <head>: SW registration, install/update chips,
                  mobile drawer tagging + scrim
lib/mobile.css    inlined into <head>: the three mobile fixes, all media-queried
lib/offline.html  offline fallback, glyph inlined
assets/icons/     generated PNGs (committed)
assets/brand-glyph.path  the DSH whale glyph's SVG path data
scripts/build-icons.mjs  regenerates the PNGs from the glyph via ffmpeg/librsvg
test/routes.test.mjs     route contract, unit-level
test/e2e.mjs             real Chrome: installability, SW, caches, true-offline
test/live.mjs            same checks against the live HTTPS origin
```

## Working on it

```bash
node scripts/build-icons.mjs            # rebuild PNGs from the brand glyph
node scripts/build-icons.mjs --check    # verify committed PNGs match the spec
node --test test/routes.test.mjs        # route contract
node test/e2e.mjs                       # full PWA behaviour in a real browser
```

`build-icons.mjs` needs `ffmpeg` with the librsvg decoder — no ImageMagick,
sharp or rsvg-convert required. Every icon spec is measured after rasterizing:
the ink box must sit inside the maskable safe zone (radius ≤ 40 % of the canvas),
and `--check` fails the build if a regenerated PNG drifts.

`e2e.mjs` boots its own throwaway `dsh web` on a scratch port and its own
headless Chrome, so it never disturbs the live instance. It ends by killing that
server and navigating, which is the only way to prove the offline path really
works.

## Deploying a change

The plugin is a plain local package linked into the profile, so there is no build
step and no copy: edit a file here and it is deployed *the next time the web
server boots*. The host half (routes, manifest, worker, index tap) is read at
request time, but the composed profile tree is mounted once at boot, so the
process has to restart to pick up a changed `lib/index.js`:

```bash
systemctl --user restart dsh-web
```

That drops every open browser session for a second or two — it is a live
harness, not a static site. The service worker softens the blow for the *assets*
(they come from cache), but the index is intentionally network-only, so an open
tab needs a reload afterwards.

Confirm what is actually live:

```bash
curl -s https://<origin>/sw.js | grep -o "const VERSION = '[0-9a-f]*'"
node test/live.mjs                       # includes a mobile-state probe
```

The version hash covers every byte the plugin serves, so if it differs from the
local build the restart has not happened yet.

## Caveats

- **Icons are rasterized from the light-mode glyph** on a `#0f1115` tile, so they
  stay legible on both light and dark home screens. `icon-monochrome-512.png` is
  the alpha-only variant Android uses for themed icons.
- **`display: standalone`, not `fullscreen`** (the shipped manifest's choice): a
  chat harness wants the OS status bar — clock, battery, connectivity — visible.
- **No push notifications / background sync.** The harness is a live WebSocket
  client; there is nothing meaningful to do while it is not running.
- **iOS ignores the manifest's SVG icons**, which is why the PNG set and
  `apple-touch-icon` exist at all.
