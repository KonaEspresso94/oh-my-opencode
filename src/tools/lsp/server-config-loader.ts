import { existsSync, readFileSync } from "fs"
import { join } from "path"

import { BUILTIN_SERVERS } from "./constants"
import type { ResolvedServer } from "./types"
import { getOpenCodeConfigDir } from "../../shared"
import { parseJsonc, detectConfigFile, detectPluginConfigFile } from "../../shared/jsonc-parser"

interface LspEntry {
  disabled?: boolean
  command?: string[]
  extensions?: string[]
  priority?: number
  env?: Record<string, string>
  initialization?: Record<string, unknown>
  request_timeout?: number
  init_timeout?: number
  idle_timeout?: number
}

interface ConfigJson {
  lsp?: Record<string, LspEntry>
  lsp_timeouts?: {
    request_timeout?: number
    init_timeout?: number
    idle_timeout?: number
  }
}

type ConfigSource = "project" | "user" | "opencode"

interface ServerWithSource extends ResolvedServer {
  source: ConfigSource
}

function validateTimeout(value: unknown): number | undefined {
  return typeof value === "number" && value > 0 ? value : undefined
}

export function loadJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) return null
  try {
    return parseJsonc(readFileSync(path, "utf-8")) as T
  } catch {
    return null
  }
}

export function getConfigPaths(): { project: string; user: string; opencode: string } {
  const cwd = process.cwd()
  const configDir = getOpenCodeConfigDir({ binary: "opencode" })
  return {
    project: detectPluginConfigFile(join(cwd, ".opencode")).path,
    user: detectPluginConfigFile(configDir).path,
    opencode: detectConfigFile(join(configDir, "opencode")).path,
  }
}

export function loadAllConfigs(): Map<ConfigSource, ConfigJson> {
  const paths = getConfigPaths()
  const configs = new Map<ConfigSource, ConfigJson>()

  const project = loadJsonFile<ConfigJson>(paths.project)
  if (project) configs.set("project", project)

  const user = loadJsonFile<ConfigJson>(paths.user)
  if (user) configs.set("user", user)

  const opencode = loadJsonFile<ConfigJson>(paths.opencode)
  if (opencode) configs.set("opencode", opencode)

  return configs
}

export function getMergedServers(): ServerWithSource[] {
  const configs = loadAllConfigs()
  const servers: ServerWithSource[] = []
  const disabled = new Set<string>()
  const seen = new Set<string>()

  const sources: ConfigSource[] = ["project", "user", "opencode"]

  const globalTimeouts: { request_timeout?: number; init_timeout?: number; idle_timeout?: number } = {}
  for (const source of sources) {
    const config = configs.get(source)
    if (!config?.lsp_timeouts) continue

    if (globalTimeouts.request_timeout === undefined) {
      globalTimeouts.request_timeout = validateTimeout(config.lsp_timeouts.request_timeout)
    }
    if (globalTimeouts.init_timeout === undefined) {
      globalTimeouts.init_timeout = validateTimeout(config.lsp_timeouts.init_timeout)
    }
    if (globalTimeouts.idle_timeout === undefined) {
      globalTimeouts.idle_timeout = validateTimeout(config.lsp_timeouts.idle_timeout)
    }
  }

  for (const source of sources) {
    const config = configs.get(source)
    if (!config?.lsp) continue

    for (const [id, entry] of Object.entries(config.lsp)) {
      if (entry.disabled) {
        disabled.add(id)
        continue
      }

      if (seen.has(id)) continue
      if (!entry.command || !entry.extensions) continue

      servers.push({
        id,
        command: entry.command,
        extensions: entry.extensions,
        priority: entry.priority ?? 0,
        env: entry.env,
        initialization: entry.initialization,
        request_timeout: validateTimeout(entry.request_timeout) ?? globalTimeouts.request_timeout,
        init_timeout: validateTimeout(entry.init_timeout) ?? globalTimeouts.init_timeout,
        idle_timeout: validateTimeout(entry.idle_timeout) ?? globalTimeouts.idle_timeout,
        source,
      })
      seen.add(id)
    }
  }

  for (const [id, config] of Object.entries(BUILTIN_SERVERS)) {
    if (disabled.has(id) || seen.has(id)) continue

      servers.push({
        id,
        command: config.command,
        extensions: config.extensions,
        priority: -100,
        request_timeout: globalTimeouts.request_timeout,
        init_timeout: globalTimeouts.init_timeout,
        idle_timeout: globalTimeouts.idle_timeout,
        source: "opencode",
      })
    }

  return servers.sort((a, b) => {
    if (a.source !== b.source) {
      const order: Record<ConfigSource, number> = { project: 0, user: 1, opencode: 2 }
      return order[a.source] - order[b.source]
    }
    return b.priority - a.priority
  })
}

export function getGlobalLspTimeouts(): {
  request_timeout?: number
  init_timeout?: number
  idle_timeout?: number
} {
  const configs = loadAllConfigs()
  const sources: ConfigSource[] = ["project", "user", "opencode"]
  const result: {
    request_timeout?: number
    init_timeout?: number
    idle_timeout?: number
  } = {}

  for (const source of sources) {
    const config = configs.get(source)
    if (!config?.lsp_timeouts) continue

    if (result.request_timeout === undefined) {
      result.request_timeout = validateTimeout(config.lsp_timeouts.request_timeout)
    }
    if (result.init_timeout === undefined) {
      result.init_timeout = validateTimeout(config.lsp_timeouts.init_timeout)
    }
    if (result.idle_timeout === undefined) {
      result.idle_timeout = validateTimeout(config.lsp_timeouts.idle_timeout)
    }
  }

  return result
}
