import { describe, test, expect } from 'bun:test'
import type { ParsedResult } from '../../../application/ports'
import { CodebaseParser } from '../../../infrastructure/parsers/codebase.parser'

function extractStack(result: ParsedResult) {
  if (result.type !== 'codebase') throw new Error('Expected codebase result')
  return result.data
}

const TYPICAL_PACKAGE_JSON = JSON.stringify({
  name: 'my-app',
  version: '1.0.0',
  type: 'module',
  dependencies: {
    express: '^4.18.0',
    react: '^18.2.0',
    'react-dom': '^18.2.0',
    pg: '^8.11.0',
  },
  devDependencies: {
    typescript: '^5.3.0',
    vitest: '^1.0.0',
    eslint: '^8.50.0',
    prettier: '^3.1.0',
    '@types/node': '^20.0.0',
  },
})

const BUN_PACKAGE_JSON = JSON.stringify({
  name: 'dve',
  version: '0.1.0',
  type: 'module',
  dependencies: {
    '@cliffy/command': '^1.0.0',
    zod: '^3.22.0',
    yaml: '^2.3.0',
  },
  devDependencies: {
    typescript: '^5.4.0',
    bun: '^1.1.0',
  },
})

const JS_ONLY_PACKAGE_JSON = JSON.stringify({
  name: 'legacy-app',
  version: '2.0.0',
  dependencies: {
    express: '^4.18.0',
    lodash: '^4.17.0',
  },
})

const CARGO_TOML = `[package]
name = "my-rust-app"
version = "0.1.0"
edition = "2021"

[dependencies]
tokio = { version = "1", features = ["full"] }
axum = "0.7"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tracing = "0.1"
`

const GO_MOD = `module github.com/example/my-go-app

go 1.22

require (
\tgithub.com/gin-gonic/gin v1.9.1
\tgithub.com/go-sql-driver/mysql v1.7.1
\tgithub.com/redis/go-redis/v9 v9.3.0
)
`

const PYPROJECT_TOML = `[project]
name = "my-python-app"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "django>=4.2",
    "celery>=5.3",
    "psycopg2-binary>=2.9",
    "redis>=5.0",
]

[build-system]
requires = ["setuptools>=68.0"]
build-backend = "setuptools.backends._legacy:_Backend"
`

const POETRY_PYPROJECT = `[tool.poetry]
name = "poetry-app"
version = "0.1.0"

[tool.poetry.dependencies]
python = "^3.11"
fastapi = "^0.108.0"
uvicorn = "^0.25.0"
pydantic = "^2.5.0"

[build-system]
requires = ["poetry-core"]
build-backend = "poetry.core.masonry.api"
`

const REQUIREMENTS_TXT = `# Core dependencies
django>=4.2
djangorestframework>=3.14
psycopg2-binary>=2.9
celery>=5.3
redis>=5.0
gunicorn>=21.2
`

const POM_XML = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId>
  <artifactId>my-java-app</artifactId>
  <version>1.0.0</version>

  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
      <version>3.2.0</version>
    </dependency>
    <dependency>
      <groupId>org.postgresql</groupId>
      <artifactId>postgresql</artifactId>
      <version>42.7.0</version>
    </dependency>
  </dependencies>
</project>
`

const BUILD_GRADLE = `plugins {
    id 'java'
    id 'org.springframework.boot' version '3.2.0'
}

dependencies {
    implementation 'org.springframework.boot:spring-boot-starter-web'
    implementation 'org.postgresql:postgresql:42.7.0'
    testImplementation 'org.junit.jupiter:junit-jupiter:5.10.0'
}
`

const KOTLIN_BUILD_GRADLE_KTS = `plugins {
    kotlin("jvm") version "1.9.20"
    id("org.springframework.boot") version "3.2.0"
}

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.jetbrains.kotlin:kotlin-reflect")
}
`

describe('CodebaseParser - package.json', () => {
  test('detects TypeScript, React, Express from typical package.json', async () => {
    const files = new Map([['package.json', TYPICAL_PACKAGE_JSON]])
    const result = extractStack(await CodebaseParser.analyze(files))

    expect(result.technologies).toContain('TypeScript')
    expect(result.technologies).toContain('React')
    expect(result.technologies).toContain('Express')
    expect(result.metadata?.languages).toContain('TypeScript')
    expect(result.metadata?.frameworks).toContain('React')
    expect(result.metadata?.frameworks).toContain('Express')
  })

  test('detects Bun and Vitest from DVE-style package.json', async () => {
    const files = new Map([['package.json', BUN_PACKAGE_JSON]])
    const result = extractStack(await CodebaseParser.analyze(files))

    expect(result.technologies).toContain('TypeScript')
    expect(result.metadata?.buildTools).toContain('Bun')
  })

  test('detects JavaScript when no TypeScript present', async () => {
    const files = new Map([['package.json', JS_ONLY_PACKAGE_JSON]])
    const result = extractStack(await CodebaseParser.analyze(files))

    expect(result.metadata?.languages).toContain('JavaScript')
    expect(result.metadata?.languages).not.toContain('TypeScript')
  })

  test('extracts key dependencies', async () => {
    const files = new Map([['package.json', TYPICAL_PACKAGE_JSON]])
    const result = extractStack(await CodebaseParser.analyze(files))

    const deps = result.metadata?.dependencies as string[]
    expect(deps).toContain('pg')
  })

  test('returns valid StackContext schema', async () => {
    const files = new Map([['package.json', TYPICAL_PACKAGE_JSON]])
    const result = extractStack(await CodebaseParser.analyze(files))

    expect(Array.isArray(result.technologies)).toBe(true)
    expect(result.technologies.length).toBeGreaterThan(0)
  })
})

describe('CodebaseParser - Cargo.toml', () => {
  test('detects Rust and Cargo from Cargo.toml', async () => {
    const files = new Map([['Cargo.toml', CARGO_TOML]])
    const result = extractStack(await CodebaseParser.analyze(files))

    expect(result.technologies).toContain('Rust')
    expect(result.technologies).toContain('Cargo')
    expect(result.metadata?.frameworks).toContain('Tokio')
    expect(result.metadata?.frameworks).toContain('Axum')
  })

  test('extracts Rust dependencies', async () => {
    const files = new Map([['Cargo.toml', CARGO_TOML]])
    const result = extractStack(await CodebaseParser.analyze(files))

    const deps = result.metadata?.dependencies as string[]
    expect(deps).toContain('serde')
    expect(deps).toContain('serde_json')
  })
})

describe('CodebaseParser - go.mod', () => {
  test('detects Go and Gin from go.mod', async () => {
    const files = new Map([['go.mod', GO_MOD]])
    const result = extractStack(await CodebaseParser.analyze(files))

    expect(result.technologies).toContain('Go')
    expect(result.technologies).toContain('Go Modules')
    expect(result.metadata?.frameworks).toContain('Gin')
  })

  test('extracts Go module dependencies', async () => {
    const files = new Map([['go.mod', GO_MOD]])
    const result = extractStack(await CodebaseParser.analyze(files))

    const deps = result.metadata?.dependencies as string[]
    expect(deps.some((d: string) => d.includes('gin-gonic'))).toBe(true)
  })
})

describe('CodebaseParser - Python projects', () => {
  test('detects Python and Django from pyproject.toml with setuptools', async () => {
    const files = new Map([['pyproject.toml', PYPROJECT_TOML]])
    const result = extractStack(await CodebaseParser.analyze(files))

    expect(result.technologies).toContain('Python')
    expect(result.metadata?.frameworks).toContain('Django')
    expect(result.metadata?.frameworks).toContain('Celery')
    expect(result.metadata?.buildTools).toContain('setuptools')
  })

  test('detects Poetry from pyproject.toml', async () => {
    const files = new Map([['pyproject.toml', POETRY_PYPROJECT]])
    const result = extractStack(await CodebaseParser.analyze(files))

    expect(result.technologies).toContain('Python')
    expect(result.metadata?.buildTools).toContain('Poetry')
    expect(result.metadata?.frameworks).toContain('FastAPI')
  })

  test('detects Python from requirements.txt', async () => {
    const files = new Map([['requirements.txt', REQUIREMENTS_TXT]])
    const result = extractStack(await CodebaseParser.analyze(files))

    expect(result.technologies).toContain('Python')
    expect(result.metadata?.buildTools).toContain('pip')
    expect(result.metadata?.frameworks).toContain('Django')
  })
})

describe('CodebaseParser - Java projects', () => {
  test('detects Java, Maven, Spring Boot from pom.xml', async () => {
    const files = new Map([['pom.xml', POM_XML]])
    const result = extractStack(await CodebaseParser.analyze(files))

    expect(result.technologies).toContain('Java')
    expect(result.technologies).toContain('Maven')
    expect(result.metadata?.frameworks).toContain('Spring Boot')
  })

  test('detects Java, Gradle, Spring Boot from build.gradle', async () => {
    const files = new Map([['build.gradle', BUILD_GRADLE]])
    const result = extractStack(await CodebaseParser.analyze(files))

    expect(result.technologies).toContain('Java')
    expect(result.technologies).toContain('Gradle')
    expect(result.metadata?.frameworks).toContain('Spring Boot')
  })

  test('detects Kotlin from build.gradle.kts', async () => {
    const files = new Map([['build.gradle.kts', KOTLIN_BUILD_GRADLE_KTS]])
    const result = extractStack(await CodebaseParser.analyze(files))

    expect(result.metadata?.languages).toContain('Kotlin')
    expect(result.metadata?.frameworks).toContain('Spring Boot')
  })
})

describe('CodebaseParser - polyglot projects', () => {
  test('detects multiple languages from polyglot repo', async () => {
    const files = new Map([
      ['package.json', TYPICAL_PACKAGE_JSON],
      ['Cargo.toml', CARGO_TOML],
    ])
    const result = extractStack(await CodebaseParser.analyze(files))

    expect(result.metadata?.languages).toContain('TypeScript')
    expect(result.metadata?.languages).toContain('Rust')
    expect(result.technologies).toContain('React')
    expect(result.technologies).toContain('Axum')
  })

  test('handles frontend + backend in different languages', async () => {
    const files = new Map([
      ['package.json', TYPICAL_PACKAGE_JSON],
      ['go.mod', GO_MOD],
    ])
    const result = extractStack(await CodebaseParser.analyze(files))

    expect(result.metadata?.languages).toContain('TypeScript')
    expect(result.metadata?.languages).toContain('Go')
  })
})

describe('CodebaseParser - fallback detection', () => {
  test('infers language from source file extensions', async () => {
    const files = new Map([
      ['src/index.ts', 'export {}'],
      ['src/utils.ts', 'export {}'],
    ])
    const result = extractStack(await CodebaseParser.analyze(files))

    expect(result.metadata?.languages).toContain('TypeScript')
  })

  test('infers multiple languages from mixed extensions', async () => {
    const files = new Map([
      ['app.py', 'print("hello")'],
      ['main.go', 'package main'],
    ])
    const result = extractStack(await CodebaseParser.analyze(files))

    expect(result.metadata?.languages).toContain('Python')
    expect(result.metadata?.languages).toContain('Go')
  })

  test('returns empty technologies for unrecognized files', async () => {
    const files = new Map([['README.md', '# Hello World']])
    const result = extractStack(await CodebaseParser.analyze(files))

    expect(result.technologies).toEqual([])
  })
})

describe('CodebaseParser - directory structure', () => {
  test('detects monorepo from packages/ and apps/ directories', async () => {
    const files = new Map([
      ['package.json', TYPICAL_PACKAGE_JSON],
      ['apps/web/src/index.ts', 'export {}'],
      ['packages/ui/src/index.ts', 'export {}'],
    ])
    const result = extractStack(await CodebaseParser.analyze(files))

    const deps = result.metadata?.dependencies as string[]
    expect(deps).toContain('monorepo')
  })

  test('detects Go project structure from cmd/ directory', async () => {
    const files = new Map([
      ['go.mod', GO_MOD],
      ['cmd/server/main.go', 'package main'],
      ['internal/handler.go', 'package handler'],
    ])
    const result = extractStack(await CodebaseParser.analyze(files))

    const deps = result.metadata?.dependencies as string[]
    expect(deps).toContain('cmd/')
    expect(deps).toContain('internal/')
  })
})

describe('CodebaseParser.parse (ParserPort interface)', () => {
  test('accepts JSON map of files', async () => {
    const parser = new CodebaseParser()
    const source = JSON.stringify({ 'package.json': TYPICAL_PACKAGE_JSON })
    const result = extractStack(await parser.parse(source))

    expect(result.technologies).toContain('TypeScript')
  })

  test('returns codebase result type', async () => {
    const parser = new CodebaseParser()
    const source = JSON.stringify({ 'package.json': TYPICAL_PACKAGE_JSON })
    const result = await parser.parse(source)

    expect(result.type).toBe('codebase')
  })

  test('handles single package.json content as fallback', async () => {
    const parser = new CodebaseParser()
    const result = await parser.parse(TYPICAL_PACKAGE_JSON)

    expect(result.type).toBe('codebase')
  })
})

describe('CodebaseParser - edge cases', () => {
  test('handles empty file map', async () => {
    const files = new Map<string, string>()
    const result = extractStack(await CodebaseParser.analyze(files))

    expect(result.technologies).toEqual([])
  })

  test('handles malformed JSON in package.json', async () => {
    const files = new Map([['package.json', 'not valid json{{{']])
    const result = extractStack(await CodebaseParser.analyze(files))

    expect(result).toBeDefined()
  })

  test('handles empty string content', async () => {
    const files = new Map([['package.json', '']])
    const result = extractStack(await CodebaseParser.analyze(files))

    expect(result).toBeDefined()
  })

  test('finds config files in subdirectories', async () => {
    const files = new Map([['project/package.json', TYPICAL_PACKAGE_JSON]])
    const result = extractStack(await CodebaseParser.analyze(files))

    expect(result.technologies).toContain('TypeScript')
  })
})
