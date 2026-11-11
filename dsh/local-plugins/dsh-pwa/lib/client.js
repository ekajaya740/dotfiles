/**
 * dsh-pwa — client half, inlined into the index head by the host plugin.
 *
 * Kept deliberately tiny and dependency-free: it runs before the app bundle
 * exists, inside the document head, so it must not touch the DOM until the
 * document parses. Four jobs:
 *
 *   1. turn the sidebar into a dismissable overlay drawer on small screens,
 *   2. register the service worker,
 *   3. offer an "Install app" chip when the browser allows it,
 *   4. offer a "Reload to update" chip when a new worker takes over.
 *
 * Every failure path is silent. A PWA affordance is never worth breaking the
 * harness for.
 */
;(() => {
  if (window.__dshPwa) return
  window.__dshPwa = true

  installMobileLayer()

  const swContainer = 'serviceWorker' in navigator ? navigator.serviceWorker : null
  if (!swContainer) return
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return

  /** One chip at a time, bottom-right, above whatever the app renders. */
  const CHIP_CSS = `
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 2147483000;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 999px;
    border: 1px solid rgba(127,127,127,.28);
    background: #ffffff;
    color: #0f1115;
    font: 500 13px/1.2 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    box-shadow: 0 6px 24px rgba(0,0,0,.16);
    cursor: pointer;
    transition: opacity .16s ease, transform .16s ease;
  `
  const CHIP_CSS_DARK = `
    background: #1b1b1f;
    color: #f9fafb;
    border-color: rgba(255,255,255,.16);
    box-shadow: 0 6px 24px rgba(0,0,0,.5);
  `

  // On a touch device the bottom-right corner is the worst place for a floating
  // chip: it lands on the settings button and the bottom-panel row. It also has
  // to be thumb-sized. Move it to the top centre (where it covers the session
  // title, which is decorative) and grow it to 44px.
  //
  // `translate` is used instead of a `transform` offset so the dismiss animation
  // below, which animates `transform`, still composes with the centring.
  const CHIP_CSS_TOUCH = `
    top: calc(8px + env(safe-area-inset-top, 0px));
    bottom: auto;
    left: 50%;
    right: auto;
    translate: -50% 0;
    min-height: 44px;
    max-width: calc(100vw - 24px);
    padding: 10px 16px;
    font-size: 14px;
  `
  const CHIP_CSS_TOUCH_DARK = CHIP_CSS_DARK

  let chip = null

  /** Remove the current chip, if any. */
  function dismissChip() {
    if (chip === null) return
    const node = chip
    chip = null
    node.style.opacity = '0'
    node.style.transform = 'translateY(4px)'
    node.style.pointerEvents = 'none'
    setTimeout(() => node.remove(), 170)
  }

  /**
   * Show a chip. Clicking it runs `onClick` and dismisses the chip unless
   * `onClick` returns false.
   * @param {string} label - chip text.
   * @param {() => (boolean|void)} onClick - click handler.
   */
  function showChip(label, onClick) {
    dismissChip()
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const node = document.createElement('button')
    node.type = 'button'
    node.textContent = label
    const touch = window.matchMedia('(pointer: coarse)').matches
    node.style.cssText = CHIP_CSS
      + (dark ? CHIP_CSS_DARK : '')
      + (touch ? CHIP_CSS_TOUCH + (dark ? CHIP_CSS_TOUCH_DARK : '') : '')
    node.addEventListener('click', () => {
      const keep = onClick() === false
      if (!keep) dismissChip()
    })
    document.body.appendChild(node)
    chip = node
  }

  /** Wire the install prompt, when the browser offers one. */
  const config = window.__dshPwaConfig ?? {}
  let installEvent = null
  if (config.installPrompt !== false) window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    installEvent = event
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true
    if (standalone) return
    showChip('Install app', () => {
      const prompt = installEvent
      if (prompt === null) return
      installEvent = null
      prompt.prompt()
      prompt.userChoice?.finally?.(() => {})
    })
  })

  window.addEventListener('appinstalled', () => {
    installEvent = null
    dismissChip()
  })

  window.addEventListener('load', () => {
    swContainer.register('/sw.js', { scope: '/' }).catch(() => {})
  })

  // A harness tab can stay open for days. Poll for a new worker when the tab
  // regains focus (the moment a user would notice a stale UI), at most hourly.
  const UPDATE_INTERVAL_MS = 60 * 60 * 1000
  let lastUpdateCheck = Date.now()
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    if (Date.now() - lastUpdateCheck < UPDATE_INTERVAL_MS) return
    lastUpdateCheck = Date.now()
    swContainer.getRegistration?.().then((registration) => registration?.update?.()).catch(() => {})
  })

  // A worker that takes over mid-session means new bytes are available. Offer a
  // reload rather than forcing one: a reload would drop a live stream.
  //
  // `controllerchange` also fires on the very first install (the new worker
  // claims the page). Only a change from one worker to another is an update, so
  // remember whether this page was already controlled and ignore the first claim.
  let hadController = Boolean(swContainer.controller)
  swContainer.addEventListener('controllerchange', () => {
    if (!hadController) {
      hadController = true
      return
    }
    if (window.__dshPwaReloading) return
    showChip('Update ready · Reload', () => {
      window.__dshPwaReloading = true
      location.reload()
    })
  })

  /**
   * Mobile drawer. The stylesheet (lib/mobile.css) already knows how to lift the
   * sidebar out of the grid; what CSS cannot do is *tag* the two elements it
   * needs, because the app's column class names are content-hashed per build and
   * nested `:has()` (frame → column → [data-slot=sidebar]) is not expressible.
   * So the two nodes are found once here and marked with attributes the
   * stylesheet can match, and a scrim is inserted to give the drawer the
   * tap-outside-to-dismiss surface it never had.
   *
   * The app is a React tree that re-renders, so a MutationObserver re-tags after
   * any structural change. Tagging is inert above the stylesheet's breakpoint.
   */
  function installMobileLayer() {
    const FRAME_ATTR = 'data-dsh-pwa-frame'
    const COLUMN_ATTR = 'data-dsh-pwa-sidebar-col'
    const CENTER_ATTR = 'data-dsh-pwa-center-col'
    const RIGHTBAR_ATTR = 'data-dsh-pwa-rightbar-col'
    const SCRIM_ATTR = 'data-dsh-pwa-scrim'

    let frame = null
    let scrim = null
    let scheduled = false

    /** Collapse the drawer by pressing the app's own toggle. */
    function closeDrawer() {
      if (frame === null || frame.hasAttribute('data-sidebar-collapsed')) return
      const scope = frame.querySelector(`[${COLUMN_ATTR}]`) ?? document
      const toggle = [...scope.querySelectorAll('button')]
        .find((node) => /^collapse sidebar$/i.test((node.getAttribute('aria-label') ?? '').trim()))
      toggle?.click()
    }

    /** Mark the frame and its sidebar column, and keep the scrim in place. */
    function sync() {
      const sidebar = document.querySelector('[data-slot="sidebar"]')
      const column = sidebar === null ? null : sidebar.parentElement
      if (column === null || column === undefined) return
      column.setAttribute(COLUMN_ATTR, '')

      const parent = column.parentElement
      if (parent === null) return
      parent.setAttribute(FRAME_ATTR, '')
      frame = parent

      // The drawer is about to leave the grid flow, so name the columns that
      // must stay in their tracks (see lib/mobile.css).
      for (const [slot, attribute] of [
        ['main', CENTER_ATTR],
        ['rightbar', RIGHTBAR_ATTR],
      ]) {
        const node = parent.querySelector(`[data-slot="${slot}"]`)
        const wrapper = node === null ? null : node.parentElement
        if (wrapper !== null && wrapper.parentElement === parent) wrapper.setAttribute(attribute, '')
      }

      if (scrim === null || scrim.parentElement !== frame) {
        scrim = frame.querySelector(`[${SCRIM_ATTR}]`)
        if (scrim === null) {
          scrim = document.createElement('div')
          scrim.setAttribute(SCRIM_ATTR, '')
          scrim.setAttribute('aria-hidden', 'true')
          // Out of flow and out of the grid: an unstyled block would otherwise
          // take a track of its own on a wide viewport. The stylesheet's
          // `!important` overrides this only inside the drawer breakpoint.
          scrim.style.display = 'none'
          frame.appendChild(scrim)
        }
      }
    }

    function schedule() {
      if (scheduled) return
      scheduled = true
      requestAnimationFrame(() => {
        scheduled = false
        sync()
      })
    }

    sync()

    // The app mounts after this script runs, so watch for the first frame to
    // appear and for any later replacement of it.
    const observer = new MutationObserver(schedule)
    const start = () => observer.observe(document.documentElement, { childList: true, subtree: true })
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        schedule()
        start()
      }, { once: true })
    } else {
      start()
    }

    document.addEventListener('click', (event) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest(`[${SCRIM_ATTR}]`) !== null) closeDrawer()
    }, true)

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      closeDrawer()
    })

    // A viewport that grows past the drawer breakpoint must not leave a latched
    // overlay behind; collapse is the app's own state, so only the scrim is ours
    // and the stylesheet already hides it above 1024px.
    window.addEventListener('resize', schedule)
  }
})()
