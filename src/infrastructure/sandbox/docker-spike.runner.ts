import Docker from 'dockerode'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SpikeRunnerPort, SpikeResult } from '../../application/ports'
import type { SpikeAnswer } from '../../domain/types'

const TECH_IMAGE_MAP: Record<string, string> = {
  typescript: 'node:20-slim',
  javascript: 'node:20-slim',
  node: 'node:20-slim',
  bun: 'oven/bun:1-slim',
  python: 'python:3.12-slim',
  java: 'eclipse-temurin:21-jdk',
  kotlin: 'eclipse-temurin:21-jdk',
  rust: 'rust:1.77-slim',
  go: 'golang:1.22-alpine',
  ruby: 'ruby:3.3-slim',
  'c#': 'mcr.microsoft.com/dotnet/sdk:8.0',
  'c++': 'gcc:13',
}

export interface DockerSpikeRunnerConfig {
  socketPath?: string
  defaultImage?: string
  artefactsBaseDir?: string
}

export function selectImage(
  technologies: readonly string[],
  fallback: string,
): string {
  for (const tech of technologies) {
    const normalized = tech.toLowerCase()
    if (TECH_IMAGE_MAP[normalized]) return TECH_IMAGE_MAP[normalized]
  }
  return fallback
}

function decodeDockerStream(buffer: Buffer): string {
  let result = ''
  let offset = 0
  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) break
    const size = buffer.readUInt32BE(offset + 4)
    offset += 8
    if (offset + size > buffer.length) {
      result += buffer.subarray(offset).toString('utf-8')
      break
    }
    result += buffer.subarray(offset, offset + size).toString('utf-8')
    offset += size
  }
  return result
}

export function parseSpikeOutput(stdout: string): {
  answer: SpikeAnswer
  finding: string
} {
  const answerPatterns: [SpikeAnswer, RegExp][] = [
    ['yes', /ANSWER:\s*yes\b/i],
    ['no', /ANSWER:\s*no\b/i],
    ['inconclusive', /ANSWER:\s*inconclusive\b/i],
  ]

  let answer: SpikeAnswer = 'inconclusive'
  for (const [value, pattern] of answerPatterns) {
    if (pattern.test(stdout)) {
      answer = value
      break
    }
  }

  const findingMatch = stdout.match(
    /FINDING:\s*([\s\S]*?)(?=\nANSWER:|\n---|\n##|$)/i,
  )
  const finding = findingMatch?.[1]?.trim() ?? stdout.trim()

  return { answer, finding }
}

export class DockerSpikeRunner implements SpikeRunnerPort {
  private readonly docker: Docker
  private readonly defaultImage: string
  private readonly artefactsBaseDir: string

  constructor(config?: DockerSpikeRunnerConfig) {
    this.docker = new Docker({
      socketPath: config?.socketPath,
    })
    this.defaultImage = config?.defaultImage ?? 'ubuntu:22.04'
    this.artefactsBaseDir =
      config?.artefactsBaseDir ?? './decisions/spikes/artefacts'
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.docker.ping()
      return true
    } catch {
      return false
    }
  }

  async execute(
    spikeId: string,
    code: string,
    options: {
      readonly timeboxSeconds: number
      readonly networkAllowed: boolean
      readonly memoryLimitMb: number
      readonly artefactDir: string
    },
  ): Promise<SpikeResult> {
    const containerName = `dve-spike-${spikeId}-${Date.now()}`
    const artefactDir =
      options.artefactDir || join(this.artefactsBaseDir, spikeId)
    let container: Docker.Container | null = null
    let killed = false

    try {
      await mkdir(artefactDir, { recursive: true })

      container = await this.docker.createContainer({
        name: containerName,
        Image: this.defaultImage,
        Cmd: ['sh', '-c', code],
        HostConfig: {
          Memory: options.memoryLimitMb * 1024 * 1024,
          NanoCpus: 1_000_000_000,
          NetworkMode: options.networkAllowed ? 'bridge' : 'none',
        },
        Tty: false,
        OpenStdin: false,
        AttachStdout: true,
        AttachStderr: true,
      })

      await container.start()

      const timeoutPromise = new Promise<void>((resolve) => {
        setTimeout(async () => {
          if (container) {
            killed = true
            await container.kill().catch(() => {})
          }
          resolve()
        }, options.timeboxSeconds * 1000)
      })

      const waitPromise = container.wait()

      const result = await Promise.race([
        waitPromise,
        timeoutPromise.then(
          () =>
            ({
              StatusCode: 137,
            }) as { StatusCode: number },
        ),
      ])

      const exitCode =
        typeof result === 'object' && 'StatusCode' in result
          ? (result.StatusCode ?? 1)
          : 1

      const stdoutRaw = await container
        .logs({ stdout: true, stderr: false })
        .then((stream) => {
          if (Buffer.isBuffer(stream)) return decodeDockerStream(stream)
          return collectStream(stream)
        })
        .catch(() => '')

      const stderrRaw = await container
        .logs({ stdout: false, stderr: true })
        .then((stream) => {
          if (Buffer.isBuffer(stream)) return decodeDockerStream(stream)
          return collectStream(stream)
        })
        .catch(() => '')

      let artefactPath: string | undefined
      try {
        const artefacts = await this.copyArtefacts(container, artefactDir)
        if (artefacts.length > 0) artefactPath = artefactDir
      } catch {
        // artefacts are optional
      }

      const stdout = typeof stdoutRaw === 'string' ? stdoutRaw : ''
      const stderr = typeof stderrRaw === 'string' ? stderrRaw : ''

      const { answer, finding } = parseSpikeOutput(stdout)

      return {
        answer,
        finding,
        artefactPath,
        exitCode: killed ? 137 : exitCode,
        stdout,
        stderr: killed
          ? `${stderr}\n[Spike timed out after ${options.timeboxSeconds}s]`
          : stderr,
      }
    } finally {
      if (container) {
        await container.remove({ force: true }).catch(() => {})
      }
    }
  }

  private async copyArtefacts(
    container: Docker.Container,
    destDir: string,
  ): Promise<string[]> {
    const artefactDir = '/artefacts'
    try {
      const stream = await container.getArchive({ path: artefactDir })
      const content = await collectStream(stream)
      if (content.length > 0) {
        const artefactFile = join(destDir, 'artefacts.tar')
        await writeFile(artefactFile, content)
        return [artefactFile]
      }
    } catch {
      // no artefacts directory in container
    }
    return []
  }
}

async function collectStream(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    stream.on('data', (chunk: Buffer) => chunks.push(chunk))
    stream.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf-8'))
    })
    stream.on('error', () => {
      resolve(Buffer.concat(chunks).toString('utf-8'))
    })
  })
}
