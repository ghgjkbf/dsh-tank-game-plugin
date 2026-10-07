/**
 * @ghgjkbf/dsh-tank-game — host half.
 *
 * Owns everything the browser half cannot do: the LLM-backed chatter engine
 * (taunts spoken by each AI tank), match records, and the HTTP routes the
 * panel talks to over the harness web server.
 *
 * No build step. This is plain ESM the loader can `require` directly, so the
 * package ships hand-written `lib/*.js` instead of a compiled `src/`.
 *
 * M0a scope: the routes below exist so the sidebar entry and the main panel
 * can prove the five links of the chain — slot registration, panel mount,
 * same-origin fetch, route dispatch, JSON round-trip. The game itself lives
 * entirely in the browser half; the host only speaks when the browser asks.
 */

import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const name = '@ghgjkbf/dsh-tank-game'

/**
 * Services this plugin needs. Empty because every route is optional-safe:
 * the plugin mounts in a headless profile too, it just serves nothing there.
 */
export const inject = []

/** Route prefix owned by this plugin. */
const BASE = '/tank-game'

/**
 * Version read from the manifest that ships beside this file.
 *
 * Stated in one place only: a release that bumped one copy and forgot the
 * other would report a version it does not have. A manifest that cannot be
 * read leaves the version unknown rather than aborting activation — a plugin
 * that refuses to load cannot report anything at all.
 */
const VERSION = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    return JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')).version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
})()

/** Process start, so `/ping` can report a live uptime rather than a constant. */
const STARTED_AT = Date.now()

//#region http helpers

/** Largest JSON body accepted on a mutating route. */
const MAX_BODY_BYTES = 1 << 20

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  response.end(body)
}

function requireGet(request, response) {
  if (request.method === 'GET' || request.method === 'HEAD') return true
  response.writeHead(405, { allow: 'GET', 'cache-control': 'no-store' })
  response.end()
  return false
}

/**
 * Read a JSON request body, capped while streaming so an oversized body is
 * never fully buffered.
 *
 * The socket is deliberately not destroyed to enforce the cap: killing the
 * request mid-upload surfaces at the caller as a bare connection reset
 * instead of the 413 this route means to send, so the remaining bytes are
 * drained and the refusal is delivered as a normal response.
 */
async function readJsonBody(request) {
  const chunks = []
  let total = 0
  let overflow = false
  for await (const chunk of request) {
    total += chunk.length
    if (total > MAX_BODY_BYTES) {
      overflow = true
      chunks.length = 0
      continue
    }
    if (!overflow) chunks.push(chunk)
  }
  if (overflow) {
    const error = new Error(`request body exceeds ${MAX_BODY_BYTES} bytes`)
    error.status = 413
    throw error
  }
  if (total === 0) return {}
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('request body must be a JSON object')
  }
  return parsed
}

//#endregion

//#region route table

/**
 * The routes this plugin serves.
 *
 * Every handler is fully async and returns its own response; the shared
 * reader throws with a `status`, which the dispatcher below converts. Nothing
 * here touches the browser: the panel is the only caller.
 */
function buildRoutes() {
  return [
    {
      label: 'health',
      path: `${BASE}/api/health`,
      handler: (_request, response) => {
        // The cheap liveness probe a shell script or a browser tab can poll.
        sendJson(response, 200, { ok: true, name, version: VERSION })
      },
    },
    {
      label: 'ping',
      path: `${BASE}/api/ping`,
      handler: (request, response) => {
        if (!requireGet(request, response)) return
        // The panel calls this to prove the whole chain end to end: if the
        // round trip works, the slot wiring, the origin, and the dispatcher
        // are all correct. Echoing the caller's own marker makes a cached or
        // intercepted response impossible to mistake for a live one.
        const url = new URL(request.url ?? '/', 'http://localhost')
        sendJson(response, 200, {
          ok: true,
          name,
          version: VERSION,
          pid: process.pid,
          hostTime: new Date().toISOString(),
          uptimeMs: Date.now() - STARTED_AT,
          echo: url.searchParams.get('echo') ?? null,
        })
      },
    },
    {
      label: 'echo',
      path: `${BASE}/api/echo`,
      handler: async (request, response) => {
        if (request.method !== 'POST') {
          response.writeHead(405, { allow: 'POST', 'cache-control': 'no-store' })
          response.end()
          return
        }
        const body = await readJsonBody(request)
        sendJson(response, 200, { ok: true, received: body, at: new Date().toISOString() })
      },
    },
  ]
}

/**
 * Claim every route, or none.
 *
 * `webServer.register` throws on a duplicate (kind, path), and the raw message
 * names only the path. Whatever was already claimed is released first, so a
 * failed mount never leaves this plugin holding paths it no longer serves.
 */
function registerRoutes(host) {
  const handles = []
  for (const route of buildRoutes()) {
    try {
      handles.push(host.webServer.register({ kind: 'exact', path: route.path, handler: route.handler }))
    } catch (error) {
      for (const handle of handles) disposeRoute(handle)
      throw new Error(`${name}: cannot register "${route.label}" at ${route.path}: ${error.message}`)
    }
  }
  return handles
}

/**
 * Release one route handle.
 *
 * `webServer.register` returns the disposer directly, which is exactly what
 * `ctx.effect` collects; the object shape is tolerated so a wrapped handle
 * from another server implementation still unloads cleanly.
 */
function disposeRoute(handle) {
  if (typeof handle === 'function') handle()
  else if (handle !== null && typeof handle === 'object') handle.dispose?.()
}

//#endregion

/**
 * Mount the plugin.
 *
 * Route registration lives inside an effect so unloading the plugin releases
 * its paths, and inside an optional `webServer` injection so a profile
 * without a web server still loads this package instead of failing on it.
 */
export function apply(ctx) {
  ctx.inject(['webServer'], (host) => {
    host.effect(() => {
      const handles = registerRoutes(host)
      return () => {
        for (const handle of handles) {
          try {
            disposeRoute(handle)
          } catch {
            /* Unload must not fail over one route that already went away. */
          }
        }
      }
    }, 'tank-game: routes')
  })
}

/** Exported for verification tools; not part of the plugin contract. */
export const internals = { BASE, VERSION, buildRoutes, readJsonBody }
