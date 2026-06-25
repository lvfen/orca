// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getRuntimeGitSubmoduleStatus: vi.fn() }))

vi.mock('@/runtime/runtime-git-client', () => ({
  getRuntimeGitSubmoduleStatus: mocks.getRuntimeGitSubmoduleStatus
}))
vi.mock('@/lib/connection-context', () => ({ getConnectionId: () => undefined }))

import {
  useSourceControlSubmoduleStatus,
  type UseSourceControlSubmoduleStatusResult
} from './useSourceControlSubmoduleStatus'
import type { GitStatusEntry } from '../../../../shared/types'

const roots: Root[] = []

function deferred<T>(): {
  promise: Promise<T>
  resolve: (v: T) => void
  reject: (e: unknown) => void
} {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

let latest: UseSourceControlSubmoduleStatusResult | null = null

function Probe({
  worktreeId,
  worktreePath,
  entries
}: {
  worktreeId: string
  worktreePath: string
  entries: GitStatusEntry[]
}): null {
  latest = useSourceControlSubmoduleStatus({
    activeWorktreeId: worktreeId,
    worktreePath,
    activeRepoSettings: null,
    entries
  })
  return null
}

function innerEntry(path: string): GitStatusEntry {
  return { path, status: 'modified', area: 'unstaged' } as GitStatusEntry
}

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })
  mocks.getRuntimeGitSubmoduleStatus.mockReset()
  latest = null
})

describe('useSourceControlSubmoduleStatus', () => {
  it('drops a late response from a previous worktree when the active worktree changed', async () => {
    const a = deferred<{ entries: GitStatusEntry[] }>()
    const b = deferred<{ entries: GitStatusEntry[] }>()
    mocks.getRuntimeGitSubmoduleStatus.mockImplementation((ctx: { worktreeId?: string | null }) =>
      ctx.worktreeId === 'A' ? a.promise : b.promise
    )

    const container = document.createElement('div')
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<Probe worktreeId="A" worktreePath="/a" entries={[]} />)
    })
    // Expand a submodule in worktree A -> issues the (slow) A request.
    await act(async () => {
      latest?.toggleSubmodule('sub')
    })
    await flush()

    // Switch to worktree B (same submodule path) and expand it there.
    await act(async () => {
      root.render(<Probe worktreeId="B" worktreePath="/b" entries={[]} />)
    })
    await act(async () => {
      latest?.toggleSubmodule('sub')
    })
    await flush()

    // B resolves first, then the stale A response arrives late.
    await act(async () => {
      b.resolve({ entries: [innerEntry('from-b.ts')] })
    })
    await flush()
    await act(async () => {
      a.resolve({ entries: [innerEntry('from-a.ts')] })
    })
    await flush()

    expect(latest?.submoduleStatusByPath.sub).toEqual({
      status: 'loaded',
      entries: [innerEntry('from-b.ts')]
    })
  })

  it('does not let a late error from a previous worktree overwrite the current status', async () => {
    const a = deferred<{ entries: GitStatusEntry[] }>()
    const b = deferred<{ entries: GitStatusEntry[] }>()
    mocks.getRuntimeGitSubmoduleStatus.mockImplementation((ctx: { worktreeId?: string | null }) =>
      ctx.worktreeId === 'A' ? a.promise : b.promise
    )

    const container = document.createElement('div')
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<Probe worktreeId="A" worktreePath="/a" entries={[]} />)
    })
    await act(async () => {
      latest?.toggleSubmodule('sub')
    })
    await flush()

    await act(async () => {
      root.render(<Probe worktreeId="B" worktreePath="/b" entries={[]} />)
    })
    await act(async () => {
      latest?.toggleSubmodule('sub')
    })
    await flush()

    await act(async () => {
      b.resolve({ entries: [innerEntry('from-b.ts')] })
    })
    await flush()
    await act(async () => {
      a.reject(new Error('stale worktree failed'))
    })
    await flush()

    expect(latest?.submoduleStatusByPath.sub).toEqual({
      status: 'loaded',
      entries: [innerEntry('from-b.ts')]
    })
  })
})
