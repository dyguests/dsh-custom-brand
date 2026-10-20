/**
 * dsh-custom-brand — host half.
 *
 * The sidebar brand row is two slots (`sidebar.brand.mark` and
 * `sidebar.brand.name`) currently occupied by the official DeepSeek Harness
 * package. This plugin shadows both with a configurable mark and wordmark, and
 * serves the mark image straight off disk so swapping it never needs a rebuild.
 *
 * Configuration is two layers, later wins:
 *   1. the `config:` block of this plugin's row in the profile patch;
 *   2. `$DSH_HOME/dsh-custom-brand.json`, created on first run and editable at
 *      any time — a page refresh is enough to pick up changes.
 *
 * Routes:
 *   GET  /api/dsh-custom-brand/config   the effective, sanitized config
 *   PUT  /api/dsh-custom-brand/config   partial update, written to the JSON file
 *   GET  /api/dsh-custom-brand/mark     the configured image (or the bundled one)
 *
 * The config is also stamped into the served HTML as `window.DshBrandSlot`,
 * so the browser half needs no round-trip before the first paint.
 *
 * @module dsh-custom-brand
 */
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Loader row id and module name. */
export const name = 'dsh-custom-brand'

/** The only host service this plugin needs. */
export const inject = ['webServer']

/** Bundled mark, used when `mark` is empty or points at a missing file. */
const DEFAULT_MARK = fileURLToPath(new URL('../assets/default-mark.png', import.meta.url))

/** Bundled silhouette served when `markMode` is `glyph` and `mark` is empty. */
const DEFAULT_GLYPH = fileURLToPath(new URL('../assets/fat-fish-glyph.png', import.meta.url))

/** Route prefix and JSON override file name under $DSH_HOME. */
const ROUTE = '/api/dsh-custom-brand'
const CONFIG_FILE = 'dsh-custom-brand.json'

/** Pre-rename route/file names, kept so an open page and old config keep working. */
const LEGACY_ROUTE = '/api/dsh-brand-slot'
const LEGACY_CONFIG_FILE = 'dsh-brand-slot.json'

/** Content types the mark route may serve. */
const TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
}

/** Stock look: the fat fish glyph with a `大肥鱼 / DSH` wordmark. */
const DEFAULTS = {
  name: '大肥鱼',
  badge: 'DSH',
  mark: '',
  markMode: 'glyph',
  markColor: 'currentColor',
  markSize: 24,
  markRadius: '50%',
  showName: true,
  nameSize: '17px',
  badgeBg: '#1b1f27',
  badgeFg: '#ffffff',
}

/** Per-field string caps; everything is clamped, never trusted. */
const STRING_CAPS = {
  name: 60,
  badge: 24,
  mark: 2048,
  markMode: 12,
  markColor: 40,
  markRadius: 24,
  nameSize: 40,
  badgeBg: 40,
  badgeFg: 40,
}

/** True for a value the browser can use as an image source unchanged. */
function isRemote(mark) {
  return /^(https?:|data:|blob:)/i.test(mark)
}

/** $DSH_HOME, defaulting to ~/.dsh. */
function dshHome() {
  const env = process.env.DSH_HOME
  return typeof env === 'string' && env.trim() !== '' ? env.trim() : join(homedir(), '.dsh')
}

/** Absolute path of the JSON override. */
function configPath() {
  return join(dshHome(), CONFIG_FILE)
}

/**
 * Normalize any candidate config into the shape the browser expects.
 *
 * @param input - merged raw values from the profile patch and the JSON file.
 * @returns a complete, safe config object.
 */
function sanitize(input) {
  const src = input !== null && typeof input === 'object' ? input : {}
  const out = { ...DEFAULTS }
  for (const [key, cap] of Object.entries(STRING_CAPS)) {
    if (typeof src[key] === 'string') out[key] = src[key].slice(0, cap)
  }
  if (typeof src.showName === 'boolean') out.showName = src.showName
  else if (src.showName === 'false') out.showName = false
  else if (src.showName === 'true') out.showName = true
  out.markMode = src.markMode === 'image' ? 'image' : 'glyph'
  const size = Number(src.markSize)
  out.markSize = Number.isFinite(size) ? Math.min(48, Math.max(12, Math.round(size))) : DEFAULTS.markSize
  return out
}

/** Read the JSON override; a missing or malformed file contributes nothing. */
function readStored() {
  for (const name of [CONFIG_FILE, LEGACY_CONFIG_FILE]) {
    try {
      const path = join(dshHome(), name)
      if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'))
    } catch {
      /* keep looking; a malformed file must not break the defaults */
    }
  }
  return {}
}

/** Persist the JSON override, creating $DSH_HOME when needed. */
function writeStored(value) {
  const path = configPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8')
}

/**
 * Resolve `mark` to a file on disk. Relative paths resolve against $DSH_HOME so
 * a short value like `brand.png` next to the JSON file just works.
 *
 * @returns the path to serve, or null when the mark is a remote/data URL.
 */
function markFile(config) {
  const fallback = config.markMode === 'glyph' ? DEFAULT_GLYPH : DEFAULT_MARK
  const mark = String(config.mark || '').trim()
  if (mark === '') return fallback
  if (isRemote(mark)) return null
  const expanded = mark.startsWith('~') ? join(homedir(), mark.slice(1)) : mark
  const full = isAbsolute(expanded) ? expanded : resolve(dshHome(), expanded)
  try {
    return existsSync(full) && statSync(full).isFile() ? full : fallback
  } catch {
    return fallback
  }
}

/**
 * The URL the browser should load for the mark. The mtime doubles as a cache
 * buster, so replacing the file and refreshing shows the new image.
 */
function markUrl(config) {
  const mark = String(config.mark || '').trim()
  if (mark !== '' && isRemote(mark)) return mark
  const file = markFile(config)
  let revision = 0
  try {
    revision = Math.floor(statSync(file).mtimeMs)
  } catch {
    /* the bundled mark always exists; a race here only drops the cache buster */
  }
  return ROUTE + '/mark?v=' + String(revision)
}

/** The object the browser boots from: config plus the resolved image URL. */
function payload(config) {
  return { ...config, markUrl: markUrl(config) }
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

/** Collect a JSON body with a small ceiling. */
function readBody(req) {
  return new Promise((resolveBody, reject) => {
    let text = ''
    req.on('data', (chunk) => {
      text += chunk
      if (text.length > 64 * 1024) {
        reject(new Error('request body too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        resolveBody(text === '' ? {} : JSON.parse(text))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

/** A cross-site Origin must not mutate local configuration. */
function sameOrigin(req) {
  const origin = req.headers?.origin
  if (typeof origin !== 'string' || origin === '') return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

/** GET the effective config, PUT a partial update into the JSON file. */
async function handleConfig(req, res, getConfig) {
  try {
    if (req.method === 'GET' || req.method === 'HEAD') {
      sendJson(res, 200, payload(getConfig()))
      return
    }
    if (req.method === 'PUT' || req.method === 'POST') {
      if (!sameOrigin(req)) {
        sendJson(res, 403, { error: 'untrusted origin' })
        return
      }
      const body = await readBody(req)
      const merged = sanitize({ ...getConfig(), ...(body !== null && typeof body === 'object' ? body : {}) })
      writeStored(merged)
      sendJson(res, 200, payload(merged))
      return
    }
    res.writeHead(405, { allow: 'GET, HEAD, PUT, POST' })
    res.end()
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
  }
}

/** Stream the configured mark (or the bundled default) with a no-cache policy. */
async function handleMark(req, res, getConfig) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' })
    res.end()
    return
  }
  try {
    const file = markFile(getConfig())
    if (file === null) {
      res.writeHead(404)
      res.end()
      return
    }
    const info = statSync(file)
    res.writeHead(200, {
      'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'content-length': String(info.size),
      'cache-control': 'no-cache',
    })
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    createReadStream(file).pipe(res)
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
  }
}

/** Stamp the config into the served document; `<` is escaped so text cannot break out. */
function stampIndex(html, getConfig) {
  const json = JSON.stringify(payload(getConfig())).replace(/</g, '\\u003c')
  const tag = '<script>window.DshBrandSlot=' + json + ';</' + 'script>'
  const at = html.indexOf('</head>')
  return at === -1 ? html + tag : html.slice(0, at) + tag + html.slice(at)
}

export function apply(ctx, config) {
  const seed = sanitize({ ...DEFAULTS, ...(config !== null && typeof config === 'object' ? config : {}) })

  // Give the user a file to edit on first run; never overwrite their values.
  try {
    if (!existsSync(configPath())) writeStored(sanitize({ ...seed, ...readStored() }))
  } catch {
    /* a read-only $DSH_HOME only costs the convenience file */
  }

  const getConfig = () => sanitize({ ...seed, ...readStored() })

  for (const prefix of [ROUTE, LEGACY_ROUTE]) {
    ctx.effect(
      () => ctx.webServer.register({ kind: 'exact', path: prefix + '/config', handler: (req, res) => handleConfig(req, res, getConfig) }),
      'dsh-custom-brand: config route ' + prefix,
    )
    ctx.effect(
      () => ctx.webServer.register({ kind: 'exact', path: prefix + '/mark', handler: (req, res) => handleMark(req, res, getConfig) }),
      'dsh-custom-brand: mark route ' + prefix,
    )
  }
  ctx.effect(
    () => ctx.webServer.tapIndex((html) => stampIndex(html, getConfig)),
    'dsh-custom-brand: index stamp',
  )

  try {
    const log = typeof ctx.logger === 'function' ? ctx.logger('dsh-custom-brand') : ctx.logger
    log?.debug?.('[brand-slot] active', payload(getConfig()))
  } catch {
    /* logging must never fail the mount */
  }
}
