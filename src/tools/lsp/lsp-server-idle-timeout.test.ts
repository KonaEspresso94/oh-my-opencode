import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"

import { LSPClient, lspManager } from "./client"
import type { ResolvedServer } from "./types"

describe("LSPServerManager idle timeout configuration", () => {
  beforeEach(async () => {
    await lspManager.stopAll()
  })

  afterEach(async () => {
    await lspManager.stopAll()
  })

  it("uses configured global idle_timeout when cleaning stale clients", async () => {
    const originalCwd = process.cwd()
    const originalEnv = process.env.OPENCODE_CONFIG_DIR
    const tempBase = mkdtempSync(join(tmpdir(), "lsp-manager-idle-timeout-config-"))
    const projectDir = join(tempBase, "project")

    const nowSpy = spyOn(Date, "now")
    const startSpy = spyOn(LSPClient.prototype, "start")
    const initializeSpy = spyOn(LSPClient.prototype, "initialize")
    const isAliveSpy = spyOn(LSPClient.prototype, "isAlive")
    const stopSpy = spyOn(LSPClient.prototype, "stop")

    startSpy.mockResolvedValue(undefined)
    initializeSpy.mockResolvedValue(undefined)
    isAliveSpy.mockReturnValue(true)
    stopSpy.mockResolvedValue(undefined)

    const server: ResolvedServer = {
      id: "typescript",
      command: ["typescript-language-server", "--stdio"],
      extensions: [".ts"],
      priority: 0,
    }

    try {
      mkdirSync(projectDir, { recursive: true })
      mkdirSync(join(projectDir, ".opencode"), { recursive: true })
      writeFileSync(
        join(projectDir, ".opencode", "oh-my-opencode.jsonc"),
        `{
  "lsp_timeouts": {
    "idle_timeout": 600000
  }
}`,
        "utf-8"
      )

      process.env.OPENCODE_CONFIG_DIR = tempBase
      process.chdir(projectDir)

      nowSpy.mockReturnValue(1_000)
      const firstClient = await lspManager.getClient(projectDir, server)
      lspManager.releaseClient(projectDir, server.id)

      nowSpy.mockReturnValue(602_001)
      ;(lspManager as { cleanupIdleClients: () => void })["cleanupIdleClients"]()

      const secondClient = await lspManager.getClient(projectDir, server)

      expect(startSpy).toHaveBeenCalledTimes(2)
      expect(stopSpy).toHaveBeenCalledTimes(1)
      expect(firstClient).not.toBe(secondClient)
    } finally {
      nowSpy.mockRestore()
      startSpy.mockRestore()
      initializeSpy.mockRestore()
      isAliveSpy.mockRestore()
      stopSpy.mockRestore()

      process.chdir(originalCwd)
      if (originalEnv === undefined) {
        delete process.env.OPENCODE_CONFIG_DIR
      } else {
        process.env.OPENCODE_CONFIG_DIR = originalEnv
      }
      rmSync(tempBase, { recursive: true, force: true })
    }
  })

  it("falls back to 300000 ms when global idle_timeout is not configured", async () => {
    const originalCwd = process.cwd()
    const originalEnv = process.env.OPENCODE_CONFIG_DIR
    const tempBase = mkdtempSync(join(tmpdir(), "lsp-manager-idle-timeout-default-"))
    const projectDir = join(tempBase, "project")

    const nowSpy = spyOn(Date, "now")
    const startSpy = spyOn(LSPClient.prototype, "start")
    const initializeSpy = spyOn(LSPClient.prototype, "initialize")
    const isAliveSpy = spyOn(LSPClient.prototype, "isAlive")
    const stopSpy = spyOn(LSPClient.prototype, "stop")

    startSpy.mockResolvedValue(undefined)
    initializeSpy.mockResolvedValue(undefined)
    isAliveSpy.mockReturnValue(true)
    stopSpy.mockResolvedValue(undefined)

    const server: ResolvedServer = {
      id: "typescript",
      command: ["typescript-language-server", "--stdio"],
      extensions: [".ts"],
      priority: 0,
    }

    try {
      mkdirSync(projectDir, { recursive: true })
      mkdirSync(join(projectDir, ".opencode"), { recursive: true })
      writeFileSync(
        join(projectDir, ".opencode", "oh-my-opencode.jsonc"),
        `{
  "lsp": {
    "typescript": {
      "command": ["typescript-language-server", "--stdio"],
      "extensions": [".ts"]
    }
  }
}`,
        "utf-8"
      )

      process.env.OPENCODE_CONFIG_DIR = tempBase
      process.chdir(projectDir)

      nowSpy.mockReturnValue(1_000)
      await lspManager.getClient(projectDir, server)
      lspManager.releaseClient(projectDir, server.id)

      nowSpy.mockReturnValue(350_000)
      ;(lspManager as { cleanupIdleClients: () => void })["cleanupIdleClients"]()

      await lspManager.getClient(projectDir, server)

      expect(startSpy).toHaveBeenCalledTimes(2)
      expect(stopSpy).toHaveBeenCalledTimes(1)
    } finally {
      nowSpy.mockRestore()
      startSpy.mockRestore()
      initializeSpy.mockRestore()
      isAliveSpy.mockRestore()
      stopSpy.mockRestore()

      process.chdir(originalCwd)
      if (originalEnv === undefined) {
        delete process.env.OPENCODE_CONFIG_DIR
      } else {
        process.env.OPENCODE_CONFIG_DIR = originalEnv
      }
      rmSync(tempBase, { recursive: true, force: true })
    }
  })
})
