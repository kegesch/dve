import { describe, test, expect, mock } from 'bun:test'
import {
  DockerSpikeRunner,
  selectImage,
  parseSpikeOutput,
} from '../../../infrastructure/sandbox/docker-spike.runner'

function mockContainer(events: {
  startResult?: Error | null
  waitResult?: { StatusCode: number }
  stdoutLogs?: string
  stderrLogs?: string
  killError?: Error | null
  removeError?: Error | null
  archiveError?: Error | null
}) {
  const started = { value: false }
  return {
    id: 'container-123',
    start: mock(async () => {
      started.value = true
      if (events.startResult) throw events.startResult
    }),
    wait: mock(async () => {
      return events.waitResult ?? { StatusCode: 0 }
    }),
    kill: mock(async () => {
      if (events.killError) throw events.killError
    }),
    remove: mock(async () => {
      if (events.removeError) throw events.removeError
    }),
    logs: mock(async (opts: { stdout: boolean; stderr: boolean }) => {
      if (opts.stdout && events.stdoutLogs !== undefined) {
        return encodeDockerLogs(1, events.stdoutLogs)
      }
      if (opts.stderr && events.stderrLogs !== undefined) {
        return encodeDockerLogs(2, events.stderrLogs)
      }
      return encodeDockerLogs(opts.stdout ? 1 : 2, '')
    }),
    getArchive: mock(async () => {
      if (events.archiveError) throw events.archiveError
      const { PassThrough } = await import('node:stream')
      const stream = new PassThrough()
      stream.end()
      return stream
    }),
  }
}

function encodeDockerLogs(streamType: number, content: string): Buffer {
  const payload = Buffer.from(content, 'utf-8')
  const header = Buffer.alloc(8)
  header.writeUInt8(streamType, 0)
  header.writeUInt32BE(payload.length, 4)
  return Buffer.concat([header, payload])
}

function mockDocker(container: ReturnType<typeof mockContainer>) {
  return {
    createContainer: mock(async () => container),
    ping: mock(async () => 'OK'),
  }
}

describe('DockerSpikeRunner', () => {
  test('selectImage returns correct image for known technologies', () => {
    expect(selectImage(['TypeScript'], 'ubuntu:22.04')).toBe('node:20-slim')
    expect(selectImage(['Python'], 'ubuntu:22.04')).toBe('python:3.12-slim')
    expect(selectImage(['Rust'], 'ubuntu:22.04')).toBe('rust:1.77-slim')
    expect(selectImage(['Go'], 'ubuntu:22.04')).toBe('golang:1.22-alpine')
    expect(selectImage(['Java'], 'ubuntu:22.04')).toBe('eclipse-temurin:21-jdk')
    expect(selectImage(['Ruby'], 'ubuntu:22.04')).toBe('ruby:3.3-slim')
  })

  test('selectImage returns fallback for unknown technologies', () => {
    expect(selectImage(['Unknown'], 'ubuntu:22.04')).toBe('ubuntu:22.04')
    expect(selectImage([], 'my-image:latest')).toBe('my-image:latest')
  })

  test('selectImage is case-insensitive', () => {
    expect(selectImage(['typescript'], 'fallback')).toBe('node:20-slim')
    expect(selectImage(['TYPESCRIPT'], 'fallback')).toBe('node:20-slim')
    expect(selectImage(['Python'], 'fallback')).toBe('python:3.12-slim')
  })

  test('selectImage picks first matching technology', () => {
    expect(selectImage(['Unknown', 'Rust', 'Python'], 'fallback')).toBe(
      'rust:1.77-slim',
    )
  })

  test('parseSpikeOutput extracts answer and finding', () => {
    const stdout = `FINDING: The API responds in 50ms average
ANSWER: yes
`
    const result = parseSpikeOutput(stdout)
    expect(result.answer).toBe('yes')
    expect(result.finding).toContain('The API responds in 50ms average')
  })

  test('parseSpikeOutput handles no answer', () => {
    const stdout = 'Some output without structured answer'
    const result = parseSpikeOutput(stdout)
    expect(result.answer).toBe('inconclusive')
    expect(result.finding).toBe('Some output without structured answer')
  })

  test('parseSpikeOutput handles all answer types', () => {
    expect(parseSpikeOutput('ANSWER: yes').answer).toBe('yes')
    expect(parseSpikeOutput('ANSWER: no').answer).toBe('no')
    expect(parseSpikeOutput('ANSWER: inconclusive').answer).toBe('inconclusive')
  })

  test('execute runs spike and returns result', async () => {
    const container = mockContainer({
      waitResult: { StatusCode: 0 },
      stdoutLogs: 'FINDING: Test passed\nANSWER: yes\n',
      stderrLogs: '',
    })
    const docker = mockDocker(container)

    const runner = new DockerSpikeRunner({ defaultImage: 'node:20-slim' })
    ;(runner as unknown as { docker: unknown }).docker = docker

    const result = await runner.execute('SPK-2026-001', 'echo hello', {
      timeboxSeconds: 60,
      networkAllowed: false,
      memoryLimitMb: 512,
      artefactDir: '',
    })

    expect(result.answer).toBe('yes')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Test passed')
    expect(result.stderr).toBe('')
    expect(docker.createContainer).toHaveBeenCalled()
    expect(container.start).toHaveBeenCalled()
    expect(container.remove).toHaveBeenCalledWith({ force: true })
  })

  test('execute captures stderr', async () => {
    const container = mockContainer({
      waitResult: { StatusCode: 1 },
      stdoutLogs: '',
      stderrLogs: 'Error: something failed',
    })
    const docker = mockDocker(container)

    const runner = new DockerSpikeRunner({ defaultImage: 'node:20-slim' })
    ;(runner as unknown as { docker: unknown }).docker = docker

    const result = await runner.execute('SPK-2026-002', 'exit 1', {
      timeboxSeconds: 60,
      networkAllowed: false,
      memoryLimitMb: 512,
      artefactDir: '',
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('something failed')
  })

  test('execute creates container with correct resource limits', async () => {
    const container = mockContainer({
      waitResult: { StatusCode: 0 },
      stdoutLogs: 'ANSWER: no',
      stderrLogs: '',
    })
    const docker = mockDocker(container)

    const runner = new DockerSpikeRunner({ defaultImage: 'node:20-slim' })
    ;(runner as unknown as { docker: unknown }).docker = docker

    await runner.execute('SPK-2026-003', 'test', {
      timeboxSeconds: 120,
      networkAllowed: true,
      memoryLimitMb: 256,
      artefactDir: '',
    })

    expect(docker.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        HostConfig: expect.objectContaining({
          Memory: 256 * 1024 * 1024,
          NanoCpus: 1_000_000_000,
          NetworkMode: 'bridge',
        }),
      }),
    )
  })

  test('execute uses network none when networkAllowed is false', async () => {
    const container = mockContainer({
      waitResult: { StatusCode: 0 },
      stdoutLogs: 'ANSWER: yes',
      stderrLogs: '',
    })
    const docker = mockDocker(container)

    const runner = new DockerSpikeRunner({ defaultImage: 'node:20-slim' })
    ;(runner as unknown as { docker: unknown }).docker = docker

    await runner.execute('SPK-2026-004', 'test', {
      timeboxSeconds: 60,
      networkAllowed: false,
      memoryLimitMb: 512,
      artefactDir: '',
    })

    expect(docker.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        HostConfig: expect.objectContaining({
          NetworkMode: 'none',
        }),
      }),
    )
  })

  test('execute cleans up container on error', async () => {
    const container = mockContainer({
      startResult: new Error('Docker error'),
      waitResult: { StatusCode: 0 },
      stdoutLogs: '',
      stderrLogs: '',
    })
    const docker = mockDocker(container)

    const runner = new DockerSpikeRunner({ defaultImage: 'node:20-slim' })
    ;(runner as unknown as { docker: unknown }).docker = docker

    expect(
      runner.execute('SPK-2026-005', 'test', {
        timeboxSeconds: 60,
        networkAllowed: false,
        memoryLimitMb: 512,
        artefactDir: '',
      }),
    ).rejects.toThrow()

    expect(container.remove).toHaveBeenCalledWith({ force: true })
  })

  test('execute cleans up container even if remove fails', async () => {
    const container = mockContainer({
      waitResult: { StatusCode: 0 },
      stdoutLogs: '',
      stderrLogs: '',
      removeError: new Error('Already removed'),
    })
    const docker = mockDocker(container)

    const runner = new DockerSpikeRunner({ defaultImage: 'node:20-slim' })
    ;(runner as unknown as { docker: unknown }).docker = docker

    const result = await runner.execute('SPK-2026-006', 'test', {
      timeboxSeconds: 60,
      networkAllowed: false,
      memoryLimitMb: 512,
      artefactDir: '',
    })

    expect(result).toBeDefined()
    expect(container.remove).toHaveBeenCalledWith({ force: true })
  })

  test('healthCheck returns true when Docker is available', async () => {
    const runner = new DockerSpikeRunner({ defaultImage: 'node:20-slim' })
    const docker = {
      ping: mock(async () => 'OK'),
    }
    ;(runner as unknown as { docker: unknown }).docker = docker

    const result = await runner.healthCheck()
    expect(result).toBe(true)
  })

  test('healthCheck returns false when Docker is unavailable', async () => {
    const runner = new DockerSpikeRunner({ defaultImage: 'node:20-slim' })
    const docker = {
      ping: mock(async () => {
        throw new Error('Cannot connect')
      }),
    }
    ;(runner as unknown as { docker: unknown }).docker = docker

    const result = await runner.healthCheck()
    expect(result).toBe(false)
  })

  test('execute passes spike code as shell command', async () => {
    const container = mockContainer({
      waitResult: { StatusCode: 0 },
      stdoutLogs: 'ANSWER: yes',
      stderrLogs: '',
    })
    const docker = mockDocker(container)

    const runner = new DockerSpikeRunner({ defaultImage: 'node:20-slim' })
    ;(runner as unknown as { docker: unknown }).docker = docker

    await runner.execute('SPK-2026-007', 'node -e "console.log(1+1)"', {
      timeboxSeconds: 60,
      networkAllowed: false,
      memoryLimitMb: 512,
      artefactDir: '',
    })

    expect(docker.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        Cmd: ['sh', '-c', 'node -e "console.log(1+1)"'],
      }),
    )
  })

  test('execute generates unique container names', async () => {
    const container = mockContainer({
      waitResult: { StatusCode: 0 },
      stdoutLogs: 'ANSWER: yes',
      stderrLogs: '',
    })
    const docker = mockDocker(container)

    const runner = new DockerSpikeRunner({ defaultImage: 'node:20-slim' })
    ;(runner as unknown as { docker: unknown }).docker = docker

    await runner.execute('SPK-2026-008', 'test', {
      timeboxSeconds: 60,
      networkAllowed: false,
      memoryLimitMb: 512,
      artefactDir: '',
    })

    expect(docker.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        name: expect.stringMatching(/^dve-spike-SPK-2026-008-\d+$/),
      }),
    )
  })

  test('execute handles inconclusive answer gracefully', async () => {
    const container = mockContainer({
      waitResult: { StatusCode: 0 },
      stdoutLogs: 'Some output without clear answer',
      stderrLogs: '',
    })
    const docker = mockDocker(container)

    const runner = new DockerSpikeRunner({ defaultImage: 'node:20-slim' })
    ;(runner as unknown as { docker: unknown }).docker = docker

    const result = await runner.execute('SPK-2026-009', 'test', {
      timeboxSeconds: 60,
      networkAllowed: false,
      memoryLimitMb: 512,
      artefactDir: '',
    })

    expect(result.answer).toBe('inconclusive')
    expect(result.finding).toContain('Some output without clear answer')
  })

  test('execute handles log read errors gracefully', async () => {
    const container = mockContainer({
      waitResult: { StatusCode: 0 },
      stdoutLogs: undefined as unknown as string,
      stderrLogs: undefined as unknown as string,
    })
    container.logs = mock(async () => {
      throw new Error('Container already removed')
    })
    const docker = mockDocker(container)

    const runner = new DockerSpikeRunner({ defaultImage: 'node:20-slim' })
    ;(runner as unknown as { docker: unknown }).docker = docker

    const result = await runner.execute('SPK-2026-010', 'test', {
      timeboxSeconds: 60,
      networkAllowed: false,
      memoryLimitMb: 512,
      artefactDir: '',
    })

    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')
    expect(result.answer).toBe('inconclusive')
  })
})

describe('DockerSpikeRunner config', () => {
  test('uses custom defaultImage from config', async () => {
    const container = mockContainer({
      waitResult: { StatusCode: 0 },
      stdoutLogs: 'ANSWER: yes',
      stderrLogs: '',
    })
    const docker = mockDocker(container)

    const runner = new DockerSpikeRunner({ defaultImage: 'python:3.12-slim' })
    ;(runner as unknown as { docker: unknown }).docker = docker

    await runner.execute('SPK-2026-011', 'python -c "print(1)"', {
      timeboxSeconds: 60,
      networkAllowed: false,
      memoryLimitMb: 512,
      artefactDir: '',
    })

    expect(docker.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        Image: 'python:3.12-slim',
      }),
    )
  })
})
