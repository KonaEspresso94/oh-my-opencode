import { describe, it, expect } from "bun:test"
import { writeFileSync, unlinkSync, mkdirSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { loadJsonFile, getMergedServers, getGlobalLspTimeouts } from "./server-config-loader"
import { BUILTIN_SERVERS } from "./constants"
import { findServerForExtension } from "./server-resolution"

describe("loadJsonFile", () => {
  it("parses JSONC config files with comments correctly", () => {
    // given
    const testData = {
      lsp: {
        typescript: {
          command: ["tsserver"],
          extensions: [".ts", ".tsx"]
        }
      }
    }
    const jsoncContent = `{
  // LSP configuration for TypeScript
  "lsp": {
    "typescript": {
      "command": ["tsserver"],
      "extensions": [".ts", ".tsx"] // TypeScript extensions
    }
  }
}`
    const tempPath = join(tmpdir(), "test-config.jsonc")
    writeFileSync(tempPath, jsoncContent, "utf-8")

    // when
    const result = loadJsonFile<typeof testData>(tempPath)

    // then
    expect(result).toEqual(testData)

    // cleanup
    unlinkSync(tempPath)
  })

  it("discovers JSONC-only user config (oh-my-opencode.jsonc)", () => {
    const originalEnv = process.env.OPENCODE_CONFIG_DIR
    const tempBase = join(tmpdir(), `omo-test-user-jsonc-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    try {
      mkdirSync(tempBase, { recursive: true })
      process.env.OPENCODE_CONFIG_DIR = tempBase

      const userJsonc = `{
  // user jsonc config
  "lsp": {
    "user-jsonc": {
      "command": ["user-jsonc-cmd"],
      "extensions": [".ujs"]
    }
  }
}`
      const userPath = join(tempBase, "oh-my-opencode.jsonc")
      writeFileSync(userPath, userJsonc, "utf-8")

      const servers = getMergedServers()
      const found = servers.find(s => s.id === "user-jsonc" && s.source === "user")
      expect(found !== undefined).toBe(true)
    } finally {
      if (originalEnv === undefined) delete process.env.OPENCODE_CONFIG_DIR
      else process.env.OPENCODE_CONFIG_DIR = originalEnv
      rmSync(tempBase, { recursive: true, force: true })
    }
  })

  it("discovers JSONC-only opencode config (opencode.jsonc)", () => {
    const originalEnv = process.env.OPENCODE_CONFIG_DIR
    const tempBase = join(tmpdir(), `omo-test-oc-jsonc-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    try {
      mkdirSync(tempBase, { recursive: true })
      process.env.OPENCODE_CONFIG_DIR = tempBase

      const opencodeJsonc = `{
  // opencode jsonc config
  "lsp": {
    "opencode-jsonc": {
      "command": ["opencode-jsonc-cmd"],
      "extensions": [".ocjs"]
    }
  }
}`
      const opencodePath = join(tempBase, "opencode.jsonc")
      writeFileSync(opencodePath, opencodeJsonc, "utf-8")

      const servers = getMergedServers()
      const found = servers.find(s => s.id === "opencode-jsonc" && s.source === "opencode")
      expect(found !== undefined).toBe(true)
    } finally {
      if (originalEnv === undefined) delete process.env.OPENCODE_CONFIG_DIR
      else process.env.OPENCODE_CONFIG_DIR = originalEnv
      rmSync(tempBase, { recursive: true, force: true })
    }
  })

  it("discovers JSONC-only project config (.opencode/oh-my-opencode.jsonc)", () => {
    const originalCwd = process.cwd()
    const tempProject = join(tmpdir(), `omo-test-project-jsonc-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    try {
      mkdirSync(join(tempProject, ".opencode"), { recursive: true })
      const projectJsonc = `{
  // project jsonc config
  "lsp": {
    "project-jsonc": {
      "command": ["project-jsonc-cmd"],
      "extensions": [".pjs"]
    }
  }
}`
      const projectPath = join(tempProject, ".opencode", "oh-my-opencode.jsonc")
      writeFileSync(projectPath, projectJsonc, "utf-8")

      process.chdir(tempProject)
      const servers = getMergedServers()
      const found = servers.find(s => s.id === "project-jsonc" && s.source === "project")
      expect(found !== undefined).toBe(true)
    } finally {
      process.chdir(originalCwd)
      rmSync(tempProject, { recursive: true, force: true })
    }
  })

  it("prefers .jsonc over .json when both exist for same config id", () => {
    const originalEnv = process.env.OPENCODE_CONFIG_DIR
    const tempBase = join(tmpdir(), `omo-test-precedence-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    try {
      mkdirSync(tempBase, { recursive: true })
      process.env.OPENCODE_CONFIG_DIR = tempBase

      const jsonContent = `{
  "lsp": {
    "conflict": {
      "command": ["from-json"],
      "extensions": [".j"]
    }
  }
}`
      const jsoncContent = `{
  // jsonc should take precedence
  "lsp": {
    "conflict": {
      "command": ["from-jsonc"],
      "extensions": [".jc"]
    }
  }
}`
      writeFileSync(join(tempBase, "oh-my-opencode.json"), jsonContent, "utf-8")
      writeFileSync(join(tempBase, "oh-my-opencode.jsonc"), jsoncContent, "utf-8")

      const servers = getMergedServers()
      const found = servers.find(s => s.id === "conflict" && s.source === "user")
      expect(found?.command && Array.isArray(found.command) && found.command[0] === "from-jsonc").toBe(true)
    } finally {
      if (originalEnv === undefined) delete process.env.OPENCODE_CONFIG_DIR
      else process.env.OPENCODE_CONFIG_DIR = originalEnv
      rmSync(tempBase, { recursive: true, force: true })
    }
  })

  describe("timeout configuration", () => {
    it("returns undefined timeout fields when no timeout config exists", () => {
      const originalCwd = process.cwd()
      const originalEnv = process.env.OPENCODE_CONFIG_DIR
      const tempProject = join(tmpdir(), `omo-test-timeout-undefined-${Date.now()}-${Math.random().toString(36).slice(2)}`)

      try {
        mkdirSync(join(tempProject, ".opencode"), { recursive: true })
        const projectConfig = `{
  "lsp": {
    "no-timeouts": {
      "command": ["no-timeouts-cmd"],
      "extensions": [".nt"]
    }
  }
}`
        writeFileSync(join(tempProject, ".opencode", "oh-my-opencode.jsonc"), projectConfig, "utf-8")

        process.chdir(tempProject)
        const servers = getMergedServers()
        const server = servers.find((entry) => entry.id === "no-timeouts" && entry.source === "project")

        expect(server?.request_timeout).toBeUndefined()
        expect(server?.init_timeout).toBeUndefined()
        expect(server?.idle_timeout).toBeUndefined()
      } finally {
        process.chdir(originalCwd)
        if (originalEnv === undefined) delete process.env.OPENCODE_CONFIG_DIR
        else process.env.OPENCODE_CONFIG_DIR = originalEnv
        rmSync(tempProject, { recursive: true, force: true })
      }
    })

    it("propagates global lsp_timeouts to configured servers", () => {
      const originalCwd = process.cwd()
      const originalEnv = process.env.OPENCODE_CONFIG_DIR
      const tempProject = join(tmpdir(), `omo-test-timeout-global-${Date.now()}-${Math.random().toString(36).slice(2)}`)

      try {
        mkdirSync(join(tempProject, ".opencode"), { recursive: true })
        const projectConfig = `{
  "lsp_timeouts": {
    "request_timeout": 25000
  },
  "lsp": {
    "global-timeout": {
      "command": ["global-timeout-cmd"],
      "extensions": [".gt"]
    }
  }
}`
        writeFileSync(join(tempProject, ".opencode", "oh-my-opencode.jsonc"), projectConfig, "utf-8")

        process.chdir(tempProject)
        const servers = getMergedServers()
        const server = servers.find((entry) => entry.id === "global-timeout" && entry.source === "project")

        expect(server?.request_timeout).toBe(25000)
        expect(server?.init_timeout).toBeUndefined()
        expect(server?.idle_timeout).toBeUndefined()
      } finally {
        process.chdir(originalCwd)
        if (originalEnv === undefined) delete process.env.OPENCODE_CONFIG_DIR
        else process.env.OPENCODE_CONFIG_DIR = originalEnv
        rmSync(tempProject, { recursive: true, force: true })
      }
    })

    it("lets per-server request timeout override global request timeout", () => {
      const originalCwd = process.cwd()
      const originalEnv = process.env.OPENCODE_CONFIG_DIR
      const tempProject = join(tmpdir(), `omo-test-timeout-per-server-${Date.now()}-${Math.random().toString(36).slice(2)}`)

      try {
        mkdirSync(join(tempProject, ".opencode"), { recursive: true })
        const projectConfig = `{
  "lsp_timeouts": {
    "request_timeout": 25000
  },
  "lsp": {
    "custom": {
      "command": ["custom-cmd"],
      "extensions": [".cst"],
      "request_timeout": 50000
    }
  }
}`
        writeFileSync(join(tempProject, ".opencode", "oh-my-opencode.jsonc"), projectConfig, "utf-8")

        process.chdir(tempProject)
        const servers = getMergedServers()
        const server = servers.find((entry) => entry.id === "custom" && entry.source === "project")

        expect(server?.request_timeout).toBe(50000)
      } finally {
        process.chdir(originalCwd)
        if (originalEnv === undefined) delete process.env.OPENCODE_CONFIG_DIR
        else process.env.OPENCODE_CONFIG_DIR = originalEnv
        rmSync(tempProject, { recursive: true, force: true })
      }
    })

    it("keeps partial timeout overrides as specified", () => {
      const originalCwd = process.cwd()
      const originalEnv = process.env.OPENCODE_CONFIG_DIR
      const tempProject = join(tmpdir(), `omo-test-timeout-partial-${Date.now()}-${Math.random().toString(36).slice(2)}`)

      try {
        mkdirSync(join(tempProject, ".opencode"), { recursive: true })
        const projectConfig = `{
  "lsp_timeouts": {
    "request_timeout": 25000,
    "init_timeout": 30000
  },
  "lsp": {
    "partial": {
      "command": ["partial-cmd"],
      "extensions": [".pt"],
      "request_timeout": 50000
    }
  }
}`
        writeFileSync(join(tempProject, ".opencode", "oh-my-opencode.jsonc"), projectConfig, "utf-8")

        process.chdir(tempProject)
        const servers = getMergedServers()
        const server = servers.find((entry) => entry.id === "partial" && entry.source === "project")

        expect(server?.request_timeout).toBe(50000)
        expect(server?.init_timeout).toBe(30000)
        expect(server?.idle_timeout).toBeUndefined()
      } finally {
        process.chdir(originalCwd)
        if (originalEnv === undefined) delete process.env.OPENCODE_CONFIG_DIR
        else process.env.OPENCODE_CONFIG_DIR = originalEnv
        rmSync(tempProject, { recursive: true, force: true })
      }
    })

    it("forwards resolved timeout config through extension lookup", () => {
      const originalCwd = process.cwd()
      const originalEnv = process.env.OPENCODE_CONFIG_DIR
      const tempProject = join(tmpdir(), `omo-test-timeout-lookup-${Date.now()}-${Math.random().toString(36).slice(2)}`)

      try {
        mkdirSync(join(tempProject, ".opencode"), { recursive: true })
        const projectConfig = `{
  "lsp_timeouts": {
    "request_timeout": 15000,
    "init_timeout": 20000,
    "idle_timeout": 25000
  },
  "lsp": {
    "lookup": {
      "command": ["node"],
      "extensions": [".lookup"],
      "request_timeout": 30000
    }
  }
}`
        writeFileSync(join(tempProject, ".opencode", "oh-my-opencode.jsonc"), projectConfig, "utf-8")

        process.chdir(tempProject)
        const result = findServerForExtension(".lookup")

        expect(result.status).toBe("found")
        if (result.status === "found") {
          expect(result.server.id).toBe("lookup")
          expect(result.server.request_timeout).toBe(30000)
          expect(result.server.init_timeout).toBe(20000)
          expect(result.server.idle_timeout).toBe(25000)
        }
      } finally {
        process.chdir(originalCwd)
        if (originalEnv === undefined) delete process.env.OPENCODE_CONFIG_DIR
        else process.env.OPENCODE_CONFIG_DIR = originalEnv
        rmSync(tempProject, { recursive: true, force: true })
      }
    })

    it("treats invalid timeout values as undefined", () => {
      const originalCwd = process.cwd()
      const originalEnv = process.env.OPENCODE_CONFIG_DIR
      const tempProject = join(tmpdir(), `omo-test-timeout-invalid-${Date.now()}-${Math.random().toString(36).slice(2)}`)

      try {
        mkdirSync(join(tempProject, ".opencode"), { recursive: true })
        const projectConfig = `{
  "lsp": {
    "invalid": {
      "command": ["invalid-cmd"],
      "extensions": [".inv"],
      "request_timeout": -1,
      "init_timeout": "banana",
      "idle_timeout": 0
    }
  }
}`
        writeFileSync(join(tempProject, ".opencode", "oh-my-opencode.jsonc"), projectConfig, "utf-8")

        process.chdir(tempProject)
        const servers = getMergedServers()
        const server = servers.find((entry) => entry.id === "invalid" && entry.source === "project")

        expect(server?.request_timeout).toBeUndefined()
        expect(server?.init_timeout).toBeUndefined()
        expect(server?.idle_timeout).toBeUndefined()
      } finally {
        process.chdir(originalCwd)
        if (originalEnv === undefined) delete process.env.OPENCODE_CONFIG_DIR
        else process.env.OPENCODE_CONFIG_DIR = originalEnv
        rmSync(tempProject, { recursive: true, force: true })
      }
    })

    it("respects project > user priority for global timeout config", () => {
      const originalEnv = process.env.OPENCODE_CONFIG_DIR
      const originalCwd = process.cwd()
      const tempBase = join(tmpdir(), `omo-test-timeout-priority-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      const tempProject = join(tempBase, ".opencode")

      try {
        mkdirSync(tempBase, { recursive: true })
        mkdirSync(tempProject, { recursive: true })
        process.env.OPENCODE_CONFIG_DIR = tempBase

        const projectConfig = `{
  "lsp_timeouts": {
    "request_timeout": 20000
  },
  "lsp": {
    "priority": {
      "command": ["priority-cmd"],
      "extensions": [".pr"]
    }
  }
}`

        const userConfig = `{
  "lsp_timeouts": {
    "request_timeout": 30000
  },
  "lsp": {
    "priority": {
      "command": ["user-priority-cmd"],
      "extensions": [".pr"]
    }
  }
}`

        writeFileSync(join(tempProject, "oh-my-opencode.jsonc"), projectConfig, "utf-8")
        writeFileSync(join(tempBase, "oh-my-opencode.jsonc"), userConfig, "utf-8")

        process.chdir(tempBase)

        const servers = getMergedServers()
        const server = servers.find((entry) => entry.id === "priority" && entry.source === "project")

        expect(server?.request_timeout).toBe(20000)
      } finally {
        process.chdir(originalCwd)
        if (originalEnv === undefined) delete process.env.OPENCODE_CONFIG_DIR
        else process.env.OPENCODE_CONFIG_DIR = originalEnv
        rmSync(tempBase, { recursive: true, force: true })
      }
    })

    it("returns merged global timeouts from getGlobalLspTimeouts", () => {
      const originalEnv = process.env.OPENCODE_CONFIG_DIR
      const originalCwd = process.cwd()
      const tempBase = join(tmpdir(), `omo-test-timeout-global-func-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      const tempProject = join(tempBase, "project")

      try {
        mkdirSync(tempBase, { recursive: true })
        mkdirSync(join(tempProject, ".opencode"), { recursive: true })
        process.env.OPENCODE_CONFIG_DIR = tempBase
        process.chdir(tempProject)

        const projectConfig = `{
  "lsp_timeouts": {
    "request_timeout": 20000,
    "init_timeout": 30000
  }
}`
        const userConfig = `{
  "lsp_timeouts": {
    "init_timeout": 10000,
    "idle_timeout": 40000
  }
}`

        writeFileSync(join(tempProject, ".opencode", "oh-my-opencode.jsonc"), projectConfig, "utf-8")
        writeFileSync(join(tempBase, "oh-my-opencode.jsonc"), userConfig, "utf-8")

        const timeouts = getGlobalLspTimeouts()

        expect(timeouts.request_timeout).toBe(20000)
        expect(timeouts.init_timeout).toBe(30000)
        expect(timeouts.idle_timeout).toBe(40000)
      } finally {
        process.chdir(originalCwd)
        if (originalEnv === undefined) delete process.env.OPENCODE_CONFIG_DIR
        else process.env.OPENCODE_CONFIG_DIR = originalEnv
        rmSync(tempBase, { recursive: true, force: true })
      }
    })

    it("applies global timeouts to builtin servers", () => {
      const originalEnv = process.env.OPENCODE_CONFIG_DIR
      const tempBase = join(tmpdir(), `omo-test-timeout-builtin-${Date.now()}-${Math.random().toString(36).slice(2)}`)

      try {
        mkdirSync(tempBase, { recursive: true })
        process.env.OPENCODE_CONFIG_DIR = tempBase

        const opencodeConfig = `{
  "lsp_timeouts": {
    "request_timeout": 25000,
    "init_timeout": 30000
  }
}`
        writeFileSync(join(tempBase, "opencode.jsonc"), opencodeConfig, "utf-8")

        const builtinServerId = Object.keys(BUILTIN_SERVERS)[0]
        const servers = getMergedServers()
        const server = servers.find((entry) => entry.id === builtinServerId && entry.source === "opencode")

        expect(server?.request_timeout).toBe(25000)
        expect(server?.init_timeout).toBe(30000)
      } finally {
        if (originalEnv === undefined) delete process.env.OPENCODE_CONFIG_DIR
        else process.env.OPENCODE_CONFIG_DIR = originalEnv
        rmSync(tempBase, { recursive: true, force: true })
      }
    })
  })
})
