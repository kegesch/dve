import type { ParserPort, ParsedResult } from '../../application/ports'
import { StackContextSchema } from '../../domain/validation/schemas'
import type { StackContext } from '../../domain/types'

interface DetectedStack {
  languages: string[]
  frameworks: string[]
  buildTools: string[]
  dependencies: string[]
}

function freshStack(): DetectedStack {
  return {
    languages: [],
    frameworks: [],
    buildTools: [],
    dependencies: [],
  }
}

const KNOWN_JS_FRAMEWORKS: Record<string, string> = {
  react: 'React',
  'react-dom': 'React',
  vue: 'Vue.js',
  '@vue/compiler-sfc': 'Vue.js',
  angular: 'Angular',
  '@angular/core': 'Angular',
  svelte: 'Svelte',
  next: 'Next.js',
  nuxt: 'Nuxt',
  express: 'Express',
  fastify: 'Fastify',
  '@hono/node-server': 'Hono',
  hono: 'Hono',
  nestjs: 'NestJS',
  '@nestjs/core': 'NestJS',
  koa: 'Koa',
  '@remix-run/react': 'Remix',
  astro: 'Astro',
  '@sveltejs/kit': 'SvelteKit',
}

const KNOWN_PYTHON_FRAMEWORKS: Record<string, string> = {
  django: 'Django',
  flask: 'Flask',
  fastapi: 'FastAPI',
  pyramid: 'Pyramid',
  sanic: 'Sanic',
  starlette: 'Starlette',
  celery: 'Celery',
  scipy: 'SciPy',
  numpy: 'NumPy',
  pandas: 'Pandas',
  tensorflow: 'TensorFlow',
  torch: 'PyTorch',
  pydantic: 'Pydantic',
}

const KNOWN_JAVA_FRAMEWORKS: Record<string, string> = {
  'spring-boot': 'Spring Boot',
  'spring-boot-starter': 'Spring Boot',
  'org.springframework.boot': 'Spring Boot',
  'spring-framework': 'Spring',
  'org.springframework': 'Spring',
  'io.quarkus': 'Quarkus',
  'io.micronaut': 'Micronaut',
  'io.dropwizard': 'Dropwizard',
  'org.hibernate': 'Hibernate',
}

const KNOWN_RUST_FRAMEWORKS: Record<string, string> = {
  actix: 'Actix',
  actix_web: 'Actix Web',
  axum: 'Axum',
  rocket: 'Rocket',
  warp: 'Warp',
  tokio: 'Tokio',
  serenity: 'Serenity',
  poem: 'Poem',
  tide: 'Tide',
}

const KNOWN_GO_FRAMEWORKS: Record<string, string> = {
  gin: 'Gin',
  echo: 'Echo',
  fiber: 'Fiber',
  chi: 'Chi',
  mux: 'Gorilla Mux',
  gorilla: 'Gorilla',
  beego: 'Beego',
  buffalo: 'Buffalo',
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)]
}

function mergeStacks(stacks: DetectedStack[]): DetectedStack {
  return {
    languages: dedupe(stacks.flatMap((s) => s.languages)),
    frameworks: dedupe(stacks.flatMap((s) => s.frameworks)),
    buildTools: dedupe(stacks.flatMap((s) => s.buildTools)),
    dependencies: dedupe(stacks.flatMap((s) => s.dependencies)),
  }
}

function detectedToContext(stack: DetectedStack): StackContext {
  const technologies = dedupe([
    ...stack.languages,
    ...stack.frameworks,
    ...stack.buildTools,
  ])

  const metadata: Record<string, unknown> = {}
  if (stack.dependencies.length > 0)
    metadata.dependencies = [...stack.dependencies]
  if (stack.languages.length > 0) metadata.languages = [...stack.languages]
  if (stack.frameworks.length > 0) metadata.frameworks = [...stack.frameworks]
  if (stack.buildTools.length > 0) metadata.buildTools = [...stack.buildTools]

  return StackContextSchema.parse({
    technologies,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  })
}

function matchFrameworks(
  depName: string,
  mapping: Record<string, string>,
): string | null {
  const lower = depName.toLowerCase()
  if (mapping[lower]) return mapping[lower]
  let bestMatch: string | null = null
  let bestLength = 0
  for (const [key, value] of Object.entries(mapping)) {
    if (lower.includes(key.toLowerCase()) && key.length > bestLength) {
      bestMatch = value
      bestLength = key.length
    }
  }
  return bestMatch
}

function parsePackageJson(content: string): DetectedStack | null {
  let pkg: Record<string, unknown>
  try {
    pkg = JSON.parse(content)
  } catch {
    return null
  }

  if (typeof pkg !== 'object' || pkg === null) return null

  const result = freshStack()

  const deps = pkg.dependencies as Record<string, string> | undefined
  const devDeps = pkg.devDependencies as Record<string, string> | undefined
  const allDeps = { ...deps, ...devDeps }

  const depNames = Object.keys(allDeps)

  if (depNames.includes('typescript')) {
    result.languages.push('TypeScript')
  } else if (pkg.type === 'module') {
    result.languages.push('TypeScript')
  } else {
    result.languages.push('JavaScript')
  }

  if (depNames.includes('@bunchn/bun') || depNames.includes('bun')) {
    result.buildTools.push('Bun')
  } else if (depNames.includes('webpack')) {
    result.buildTools.push('Webpack')
  } else if (depNames.includes('vite')) {
    result.buildTools.push('Vite')
  } else if (depNames.includes('esbuild')) {
    result.buildTools.push('esbuild')
  } else if (depNames.includes('rollup')) {
    result.buildTools.push('Rollup')
  } else if (depNames.includes('turbo') || depNames.includes('turbo-scripts')) {
    result.buildTools.push('Turborepo')
  }

  if (depNames.includes('jest')) {
    result.buildTools.push('Jest')
  } else if (
    depNames.includes('vitest') ||
    depNames.includes('@vitest/runner')
  ) {
    result.buildTools.push('Vitest')
  }

  for (const depName of depNames) {
    const framework = matchFrameworks(depName, KNOWN_JS_FRAMEWORKS)
    if (framework && !result.frameworks.includes(framework)) {
      result.frameworks.push(framework)
    }
    if (
      !framework &&
      !depName.startsWith('@types/') &&
      !depName.startsWith('@bunchn/')
    ) {
      result.dependencies.push(depName)
    }
  }

  if (depNames.includes('eslint')) result.buildTools.push('ESLint')
  if (depNames.includes('prettier')) result.buildTools.push('Prettier')

  return result
}

function parseCargoToml(content: string): DetectedStack | null {
  if (!content.includes('[package]') && !content.includes('[dependencies]'))
    return null

  const result: DetectedStack = {
    languages: ['Rust'],
    frameworks: [],
    buildTools: ['Cargo'],
    dependencies: [],
  }

  const depMatch = content.match(/\[dependencies\]([\s\S]*?)(?=\n\[|$)/)
  if (depMatch) {
    const depSection = depMatch[1]
    const depLines = depSection.split('\n').filter((l) => l.trim().length > 0)
    for (const line of depLines) {
      const depName = line.split('=')[0]?.trim()
      if (!depName || depName.startsWith('#') || depName.startsWith('['))
        continue

      const framework = matchFrameworks(depName, KNOWN_RUST_FRAMEWORKS)
      if (framework) {
        result.frameworks.push(framework)
      }
      result.dependencies.push(depName)
    }
  }

  return result
}

function parseGoMod(content: string): DetectedStack | null {
  if (!content.includes('module ') && !content.includes('go ')) return null

  const result: DetectedStack = {
    languages: ['Go'],
    frameworks: [],
    buildTools: ['Go Modules'],
    dependencies: [],
  }

  const lines = content.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('require (')) continue
    if (trimmed.startsWith(')')) continue
    if (trimmed.startsWith('//')) continue
    if (!trimmed || trimmed.startsWith('module ') || trimmed.startsWith('go '))
      continue

    const parts = trimmed.split(/\s+/)
    const depPath = parts[0]
    if (!depPath || depPath.startsWith('require')) continue

    const depName = depPath.split('/').pop() ?? depPath
    const framework = matchFrameworks(depName, KNOWN_GO_FRAMEWORKS)
    if (framework) {
      result.frameworks.push(framework)
    }
    result.dependencies.push(depPath)
  }

  return result
}

function extractPythonDeps(text: string, result: DetectedStack): void {
  const depPattern = /"([^"]+)"/g
  let depMatch: RegExpExecArray | null
  while ((depMatch = depPattern.exec(text)) !== null) {
    const raw = depMatch[1]
    const cleaned = raw.split(/[><=!~[]/)[0].trim()
    if (!cleaned) continue
    const framework = matchFrameworks(cleaned, KNOWN_PYTHON_FRAMEWORKS)
    if (framework && !result.frameworks.includes(framework)) {
      result.frameworks.push(framework)
    }
    result.dependencies.push(cleaned)
  }
}

function parsePyprojectToml(content: string): DetectedStack | null {
  if (
    !content.includes('[project]') &&
    !content.includes('[tool.poetry]') &&
    !content.includes('[build-system]')
  )
    return null

  const result: DetectedStack = {
    languages: ['Python'],
    frameworks: [],
    buildTools: [],
    dependencies: [],
  }

  if (content.includes('[tool.poetry]')) {
    result.buildTools.push('Poetry')
  }
  if (
    content.includes('[tool.setuptools]') ||
    /\[build-system\][\s\S]*setuptools/.test(content)
  ) {
    result.buildTools.push('setuptools')
  }
  if (content.includes('hatchling')) {
    result.buildTools.push('Hatch')
  }
  if (content.includes('flit_core')) {
    result.buildTools.push('Flit')
  }

  if (result.buildTools.length === 0) {
    result.buildTools.push('pip')
  }

  const projectSection = content.match(
    /\[project\]\s*\n([\s\S]*?)(?=\n\[|$)/,
  )?.[1]
  if (projectSection) {
    const depsBlock = projectSection.match(
      /dependencies\s*=\s*\[([\s\S]*?)\]/,
    )?.[1]
    if (depsBlock) {
      extractPythonDeps(depsBlock, result)
    }
  }

  const poetrySection = content.match(
    /\[tool\.poetry\.dependencies\]\s*\n([\s\S]*?)(?=\n\[|$)/,
  )?.[1]
  if (poetrySection) {
    const depLines = poetrySection
      .split('\n')
      .filter((l) => l.trim().length > 0)
    for (const line of depLines) {
      const depName = line.split('=')[0]?.trim()
      if (!depName || depName === 'python' || depName.startsWith('#')) continue
      const framework = matchFrameworks(depName, KNOWN_PYTHON_FRAMEWORKS)
      if (framework && !result.frameworks.includes(framework)) {
        result.frameworks.push(framework)
      }
      result.dependencies.push(depName)
    }
  }

  return result
}

function parseRequirementsTxt(content: string): DetectedStack | null {
  const lines = content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#') && !l.startsWith('-'))

  if (lines.length === 0) return null

  const result: DetectedStack = {
    languages: ['Python'],
    frameworks: [],
    buildTools: ['pip'],
    dependencies: [],
  }

  for (const line of lines) {
    const depName = line.split(/[><=!~[]/)[0].trim()
    if (!depName) continue

    const framework = matchFrameworks(depName, KNOWN_PYTHON_FRAMEWORKS)
    if (framework && !result.frameworks.includes(framework)) {
      result.frameworks.push(framework)
    }
    result.dependencies.push(depName)
  }

  return result
}

function parsePomXml(content: string): DetectedStack | null {
  if (!content.includes('<project') && !content.includes('<dependencies>'))
    return null

  const result: DetectedStack = {
    languages: ['Java'],
    frameworks: [],
    buildTools: ['Maven'],
    dependencies: [],
  }

  const depRegex =
    /<dependency>\s*<groupId>([^<]+)<\/groupId>\s*<artifactId>([^<]+)<\/artifactId>/g
  let match: RegExpExecArray | null
  while ((match = depRegex.exec(content)) !== null) {
    const groupId = match[1]
    const artifactId = match[2]
    const depKey = `${groupId}:${artifactId}`

    const artifactFramework = matchFrameworks(artifactId, KNOWN_JAVA_FRAMEWORKS)
    const groupFramework = matchFrameworks(groupId, KNOWN_JAVA_FRAMEWORKS)
    const framework =
      artifactFramework && groupFramework
        ? artifactFramework.length >= groupFramework.length
          ? artifactFramework
          : groupFramework
        : (artifactFramework ?? groupFramework)
    if (framework && !result.frameworks.includes(framework)) {
      result.frameworks.push(framework)
    }
    result.dependencies.push(depKey)
  }

  return result
}

function parseBuildGradle(content: string): DetectedStack | null {
  if (
    !content.includes('dependencies {') &&
    !content.includes('plugins {') &&
    !content.includes('dependencies{') &&
    !content.includes('plugins{')
  )
    return null

  const result: DetectedStack = {
    languages: [],
    frameworks: [],
    buildTools: ['Gradle'],
    dependencies: [],
  }

  if (content.includes('org.jetbrains.kotlin')) {
    result.languages.push('Kotlin')
  } else {
    result.languages.push('Java')
  }

  if (content.includes('org.springframework.boot')) {
    result.frameworks.push('Spring Boot')
  }

  const implRegex =
    /(?:implementation|api|compileOnly|runtimeOnly)\s+['"]([^'"]+)['"]/g
  let match: RegExpExecArray | null
  while ((match = implRegex.exec(content)) !== null) {
    const dep = match[1]
    const parts = dep.split(':')
    const depKey = parts.length >= 2 ? `${parts[0]}:${parts[1]}` : dep

    if (
      !content.includes('org.springframework.boot') ||
      !dep.includes('spring-boot')
    ) {
      const framework =
        matchFrameworks(parts[0] ?? '', KNOWN_JAVA_FRAMEWORKS) ??
        matchFrameworks(parts[1] ?? '', KNOWN_JAVA_FRAMEWORKS)
      if (framework && !result.frameworks.includes(framework)) {
        result.frameworks.push(framework)
      }
    }
    result.dependencies.push(depKey)
  }

  return result
}

function detectFromFilenames(filenames: string[]): string[] {
  const indicators: string[] = []

  const dirs = new Set<string>()
  for (const f of filenames) {
    const parts = f.split(/[/\\]/)
    if (parts.length > 1) dirs.add(parts[0])
  }

  if (filenames.some((f) => f.startsWith('src/'))) indicators.push('src/')
  if (filenames.some((f) => f.startsWith('test/') || f.startsWith('tests/')))
    indicators.push('test/')
  if (filenames.some((f) => f.startsWith('lib/'))) indicators.push('lib/')
  if (dirs.has('packages')) indicators.push('monorepo')
  if (dirs.has('apps') && dirs.has('packages')) indicators.push('monorepo')
  if (filenames.some((f) => f.startsWith('cmd/'))) indicators.push('cmd/')
  if (filenames.some((f) => f.startsWith('internal/')))
    indicators.push('internal/')
  if (filenames.some((f) => f.startsWith('pkg/'))) indicators.push('pkg/')

  return indicators
}

type ConfigParser = (content: string) => DetectedStack | null

interface ConfigFileMapping {
  filename: string
  parser: ConfigParser
}

const CONFIG_FILE_MAPPINGS: ConfigFileMapping[] = [
  { filename: 'package.json', parser: parsePackageJson },
  { filename: 'Cargo.toml', parser: parseCargoToml },
  { filename: 'go.mod', parser: parseGoMod },
  { filename: 'pyproject.toml', parser: parsePyprojectToml },
  { filename: 'requirements.txt', parser: parseRequirementsTxt },
  { filename: 'pom.xml', parser: parsePomXml },
  { filename: 'build.gradle', parser: parseBuildGradle },
  { filename: 'build.gradle.kts', parser: parseBuildGradle },
]

function basename(filepath: string): string {
  const parts = filepath.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] ?? filepath
}

function findConfigFile(
  filename: string,
  files: ReadonlyMap<string, string>,
): string | null {
  if (files.has(filename)) return filename
  for (const key of files.keys()) {
    if (basename(key) === filename) return key
  }
  return null
}

export class CodebaseParser implements ParserPort {
  async parse(source: string): Promise<ParsedResult> {
    let filesMap: Record<string, string>
    try {
      filesMap = JSON.parse(source)
    } catch {
      filesMap = { 'package.json': source }
    }
    const files = new Map(Object.entries(filesMap))
    return CodebaseParser.analyze(files)
  }

  static async analyze(
    files: ReadonlyMap<string, string>,
  ): Promise<ParsedResult> {
    const stacks: DetectedStack[] = []

    for (const mapping of CONFIG_FILE_MAPPINGS) {
      const key = findConfigFile(mapping.filename, files)
      if (key === null) continue
      const content = files.get(key)
      if (content === undefined) continue
      const detected = mapping.parser(content)
      if (detected) stacks.push(detected)
    }

    if (stacks.length === 0) {
      const fallback = CodebaseParser.detectFallback(files)
      stacks.push(fallback)
    }

    const merged = mergeStacks(stacks)

    const filenames = [...files.keys()]
    const structureIndicators = detectFromFilenames(filenames)
    if (structureIndicators.length > 0) {
      merged.dependencies.push(...structureIndicators)
    }

    const context = detectedToContext(merged)
    return { type: 'codebase', data: context }
  }

  static detectFallback(files: ReadonlyMap<string, string>): DetectedStack {
    const result = freshStack()
    const filenames = [...files.keys()]

    for (const f of filenames) {
      const lower = f.toLowerCase()
      if (
        lower.endsWith('.ts') ||
        lower.endsWith('.tsx') ||
        lower.endsWith('.mts')
      ) {
        result.languages.push('TypeScript')
      } else if (lower.endsWith('.js') || lower.endsWith('.jsx')) {
        result.languages.push('JavaScript')
      } else if (lower.endsWith('.py')) {
        result.languages.push('Python')
      } else if (lower.endsWith('.rs')) {
        result.languages.push('Rust')
      } else if (lower.endsWith('.go')) {
        result.languages.push('Go')
      } else if (lower.endsWith('.java') || lower.endsWith('.kt')) {
        result.languages.push('Java')
      } else if (lower.endsWith('.rb')) {
        result.languages.push('Ruby')
      } else if (lower.endsWith('.cs')) {
        result.languages.push('C#')
      } else if (lower.endsWith('.cpp') || lower.endsWith('.cc')) {
        result.languages.push('C++')
      } else if (lower.endsWith('.c')) {
        result.languages.push('C')
      }
    }

    result.languages = dedupe(result.languages)
    return result
  }
}
