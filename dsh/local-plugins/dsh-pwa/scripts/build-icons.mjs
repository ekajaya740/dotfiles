#!/usr/bin/env node
/**
 * dsh-pwa icon builder.
 *
 * Rasterizes the DSH brand glyph (`assets/brand-glyph.path`, copied from the
 * shipped `favicon.svg`) into the PNG icon set a PWA wants:
 *
 *   icon-192.png / icon-512.png              purpose "any"      rounded tile
 *   icon-maskable-192/512.png                purpose "maskable" full-bleed tile
 *   icon-monochrome-512.png                  purpose "monochrome"
 *   apple-touch-icon-180.png                 iOS home screen (full-bleed)
 *   favicon-32.png                           PNG favicon fallback
 *
 * Everything is emitted as an SVG at the *exact* target pixel size and then
 * rasterized with ffmpeg's librsvg decoder — no sharp/PIL/ImageMagick needed.
 *
 * Usage: node scripts/build-icons.mjs [--check]
 *   --check  only verify the committed PNGs exist and are non-empty
 */
import { execFile } from 'node:child_process'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const ASSETS = join(ROOT, 'assets')
const ICONS = join(ASSETS, 'icons')

/** Brand palette, sampled from the shipped frontend CSS + boot style. */
const TILE_BG = '#0f1115' // --dsh-boot-brand (light theme)
const GLYPH_FG = '#f9fafb' // --dsh-boot-label-primary (dark theme)

/**
 * Glyph ink box inside the source viewBox (0 0 50 50), measured by rasterizing
 * the glyph at 1024px and scanning the alpha channel: ink spans
 * x 0.977..49.366, y 6.982..43.310. The mark is a wide landscape shape, so
 * square tiles need horizontal padding to keep it off the edges.
 */
const GLYPH_BOX = { x: 0.977, y: 6.982, w: 48.389, h: 36.328 }
const GLYPH_CENTER = { x: GLYPH_BOX.x + GLYPH_BOX.w / 2, y: GLYPH_BOX.y + GLYPH_BOX.h / 2 }

/**
 * An icon spec: pixel size, whether the background tile is drawn, its corner
 * radius as a fraction of the size, the fraction of the tile width the glyph
 * should span, and the glyph fill.
 *
 * Maskable icons must keep ink inside the safe zone (a circle of diameter 80%
 * of the icon), and the glyph is a wide mark, so it is scaled down further.
 */
const SPECS = [
  { file: 'icon-192.png', size: 192, tile: true, radius: 0.22, glyphWidth: 0.62, fill: GLYPH_FG },
  { file: 'icon-512.png', size: 512, tile: true, radius: 0.22, glyphWidth: 0.62, fill: GLYPH_FG },
  { file: 'icon-maskable-192.png', size: 192, tile: true, radius: 0, glyphWidth: 0.5, fill: GLYPH_FG },
  { file: 'icon-maskable-512.png', size: 512, tile: true, radius: 0, glyphWidth: 0.5, fill: GLYPH_FG },
  { file: 'icon-monochrome-512.png', size: 512, tile: false, radius: 0, glyphWidth: 0.82, fill: '#000000' },
  { file: 'apple-touch-icon-180.png', size: 180, tile: true, radius: 0, glyphWidth: 0.6, fill: GLYPH_FG },
  { file: 'favicon-32.png', size: 32, tile: true, radius: 0.22, glyphWidth: 0.7, fill: GLYPH_FG },
]

/** Compose one icon as an SVG document at its native pixel size. */
function renderSvg(spec, glyphPath) {
  const { size } = spec
  // Scale factor in viewBox units: the ink box must end up `glyphWidth` of the
  // tile wide once the 50-unit viewBox is painted at `size` pixels.
  const scale = (spec.glyphWidth * 50) / GLYPH_BOX.w
  const tile = spec.tile
    ? `<rect x="0" y="0" width="${size}" height="${size}" rx="${(spec.radius * size).toFixed(2)}" fill="${TILE_BG}"/>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 50 50" fill="none">
${tile}<g transform="translate(25 25) scale(${scale.toFixed(5)}) translate(${-GLYPH_CENTER.x.toFixed(3)} ${-GLYPH_CENTER.y.toFixed(3)})"><path d="${glyphPath}" fill="${spec.fill}"/></g>
</svg>
`
}

async function main() {
  const check = process.argv.includes('--check')
  const glyphPath = (await readFile(join(ASSETS, 'brand-glyph.path'), 'utf8')).trim()

  if (check) {
    let bad = 0
    for (const spec of SPECS) {
      const file = join(ICONS, spec.file)
      try {
        const info = await stat(file)
        if (info.size < 500) throw new Error(`suspiciously small: ${info.size} bytes`)
        console.log(`ok   ${spec.file} (${info.size} bytes)`)
      } catch (error) {
        bad += 1
        console.error(`FAIL ${spec.file}: ${error.message}`)
      }
    }
    process.exit(bad === 0 ? 0 : 1)
  }

  await mkdir(ICONS, { recursive: true })
  const workDir = join(ROOT, '.icon-build')
  await mkdir(workDir, { recursive: true })

  for (const spec of SPECS) {
    const svgPath = join(workDir, `${spec.file}.svg`)
    await writeFile(svgPath, renderSvg(spec, glyphPath), 'utf8')
    await run('ffmpeg', [
      '-y', '-v', 'error',
      '-i', svgPath,
      '-frames:v', '1',
      '-pix_fmt', 'rgba',
      join(ICONS, spec.file),
    ])
    const info = await stat(join(ICONS, spec.file))
    console.log(`built ${spec.file} (${spec.size}px, ${info.size} bytes)`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
