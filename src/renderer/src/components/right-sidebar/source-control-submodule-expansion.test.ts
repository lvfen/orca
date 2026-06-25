import { describe, expect, it } from 'vitest'
import type { GitStatusEntry } from '../../../../shared/types'
import {
  buildSubmoduleChildNodes,
  injectExpandedSubmoduleEntries,
  injectExpandedSubmoduleRows,
  isExpandableSubmoduleEntry,
  type SubmoduleSectionTreeNode,
  type SubmoduleStatusState
} from './source-control-submodule-expansion'

const LOADING = 'Loading submodule changes…'
const EMPTY = 'No changes in submodule'

function submoduleEntry(partial: Partial<GitStatusEntry> & { path: string }): GitStatusEntry {
  return {
    status: 'modified',
    area: 'unstaged',
    submodule: { commitChanged: false, trackedChanges: true, untrackedChanges: false },
    ...partial
  }
}

function fileNode(entry: GitStatusEntry, depth = 0): SubmoduleSectionTreeNode & { type: 'file' } {
  return {
    type: 'file',
    key: `unstaged::${entry.path}`,
    name: entry.path.split('/').pop() ?? entry.path,
    path: entry.path,
    entry,
    area: 'unstaged',
    depth
  }
}

describe('isExpandableSubmoduleEntry', () => {
  it('is expandable when the submodule has tracked or untracked changes', () => {
    expect(
      isExpandableSubmoduleEntry(
        submoduleEntry({
          path: 'flutter_mine',
          submodule: { commitChanged: false, trackedChanges: true, untrackedChanges: false }
        })
      )
    ).toBe(true)
    expect(
      isExpandableSubmoduleEntry(
        submoduleEntry({
          path: 'flutter_mine',
          submodule: { commitChanged: true, trackedChanges: false, untrackedChanges: true }
        })
      )
    ).toBe(true)
  })

  it('is expandable for a pointer-only (commit) change so its files can be inspected', () => {
    expect(
      isExpandableSubmoduleEntry(
        submoduleEntry({
          path: 'flutter_mine',
          submodule: { commitChanged: true, trackedChanges: false, untrackedChanges: false }
        })
      )
    ).toBe(true)
  })

  it('is not expandable when the submodule has no changes at all', () => {
    expect(
      isExpandableSubmoduleEntry(
        submoduleEntry({
          path: 'flutter_mine',
          submodule: { commitChanged: false, trackedChanges: false, untrackedChanges: false }
        })
      )
    ).toBe(false)
  })

  it('is not expandable for non-submodule entries or already-inner entries', () => {
    expect(
      isExpandableSubmoduleEntry({ path: 'src/a.ts', status: 'modified', area: 'unstaged' })
    ).toBe(false)
    expect(
      isExpandableSubmoduleEntry(
        submoduleEntry({ path: 'flutter_mine/lib/main.dart', submoduleRoot: 'flutter_mine' })
      )
    ).toBe(false)
  })
})

describe('buildSubmoduleChildNodes', () => {
  it('prefixes inner paths, stamps submoduleRoot, and nests one level deeper', () => {
    const parent = fileNode(submoduleEntry({ path: 'flutter_mine' }), 2)
    const inner: GitStatusEntry[] = [
      { path: 'lib/main.dart', status: 'modified', area: 'unstaged' }
    ]

    const [child] = buildSubmoduleChildNodes(parent, inner)

    expect(child.path).toBe('flutter_mine/lib/main.dart')
    expect(child.name).toBe('main.dart')
    expect(child.entry.submoduleRoot).toBe('flutter_mine')
    expect(child.entry.status).toBe('modified')
    expect(child.depth).toBe(3)
    expect(child.area).toBe('unstaged')
  })
})

describe('injectExpandedSubmoduleRows', () => {
  it('passes through unexpanded nodes untouched', () => {
    const node = fileNode(submoduleEntry({ path: 'flutter_mine' }))
    const result = injectExpandedSubmoduleRows([node], new Set(), {}, LOADING, EMPTY)
    expect(result).toEqual([node])
  })

  it('emits a loading placeholder when status is missing or loading', () => {
    const node = fileNode(submoduleEntry({ path: 'flutter_mine' }))
    const result = injectExpandedSubmoduleRows(
      [node],
      new Set(['flutter_mine']),
      {},
      LOADING,
      EMPTY
    )
    expect(result).toHaveLength(2)
    expect(result[1]).toMatchObject({
      type: 'submodule-placeholder',
      state: 'loading',
      message: LOADING,
      submodulePath: 'flutter_mine'
    })
  })

  it('emits an error placeholder carrying the error message', () => {
    const node = fileNode(submoduleEntry({ path: 'flutter_mine' }))
    const statuses: Record<string, SubmoduleStatusState> = {
      flutter_mine: { status: 'error', error: 'boom' }
    }
    const result = injectExpandedSubmoduleRows(
      [node],
      new Set(['flutter_mine']),
      statuses,
      LOADING,
      EMPTY
    )
    expect(result[1]).toMatchObject({
      type: 'submodule-placeholder',
      state: 'error',
      message: 'boom'
    })
  })

  it('emits an empty placeholder when the submodule has no inner entries', () => {
    const node = fileNode(submoduleEntry({ path: 'flutter_mine' }))
    const statuses: Record<string, SubmoduleStatusState> = {
      flutter_mine: { status: 'loaded', entries: [] }
    }
    const result = injectExpandedSubmoduleRows(
      [node],
      new Set(['flutter_mine']),
      statuses,
      LOADING,
      EMPTY
    )
    expect(result[1]).toMatchObject({
      type: 'submodule-placeholder',
      state: 'empty',
      message: EMPTY
    })
  })

  it('injects child file rows when inner status is loaded', () => {
    const node = fileNode(submoduleEntry({ path: 'flutter_mine' }))
    const statuses: Record<string, SubmoduleStatusState> = {
      flutter_mine: {
        status: 'loaded',
        entries: [{ path: 'lib/main.dart', status: 'modified', area: 'unstaged' }]
      }
    }
    const result = injectExpandedSubmoduleRows(
      [node],
      new Set(['flutter_mine']),
      statuses,
      LOADING,
      EMPTY
    )
    expect(result).toHaveLength(2)
    expect(result[1]).toMatchObject({
      type: 'file',
      path: 'flutter_mine/lib/main.dart'
    })
    const child = result[1] as SubmoduleSectionTreeNode & { type: 'file' }
    expect(child.entry.submoduleRoot).toBe('flutter_mine')
  })

  it('expands a pointer-only (commit) submodule into its commit-range files', () => {
    const node = fileNode(
      submoduleEntry({
        path: 'flutter_mine',
        submodule: { commitChanged: true, trackedChanges: false, untrackedChanges: false }
      })
    )
    const statuses: Record<string, SubmoduleStatusState> = {
      flutter_mine: {
        status: 'loaded',
        entries: [{ path: 'lib/main.dart', status: 'modified', area: 'unstaged' }]
      }
    }
    const result = injectExpandedSubmoduleRows(
      [node],
      new Set(['flutter_mine']),
      statuses,
      LOADING,
      EMPTY
    )
    expect(result).toHaveLength(2)
    expect(result[1]).toMatchObject({ type: 'file', path: 'flutter_mine/lib/main.dart' })
  })

  it('never expands a non-submodule entry that is in the expanded set', () => {
    const node = fileNode({ path: 'src/a.ts', status: 'modified', area: 'unstaged' })
    const result = injectExpandedSubmoduleRows([node], new Set(['src/a.ts']), {}, LOADING, EMPTY)
    expect(result).toEqual([node])
  })
})

describe('injectExpandedSubmoduleEntries (list view)', () => {
  it('passes through unexpanded entries untouched', () => {
    const entry = submoduleEntry({ path: 'flutter_mine' })
    const result = injectExpandedSubmoduleEntries([entry], new Set(), {}, LOADING, EMPTY)
    expect(result).toEqual([{ type: 'entry', entry }])
  })

  it('emits a loading placeholder when status is missing', () => {
    const entry = submoduleEntry({ path: 'flutter_mine' })
    const result = injectExpandedSubmoduleEntries(
      [entry],
      new Set(['flutter_mine']),
      {},
      LOADING,
      EMPTY
    )
    expect(result).toHaveLength(2)
    expect(result[1]).toMatchObject({
      type: 'submodule-placeholder',
      state: 'loading',
      submodulePath: 'flutter_mine',
      depth: 1
    })
  })

  it('injects child entries (with submoduleRoot) for a pointer-only commit change', () => {
    const entry = submoduleEntry({
      path: 'flutter_mine',
      submodule: { commitChanged: true, trackedChanges: false, untrackedChanges: false }
    })
    const statuses: Record<string, SubmoduleStatusState> = {
      flutter_mine: {
        status: 'loaded',
        entries: [{ path: 'lib/main.dart', status: 'modified', area: 'unstaged' }]
      }
    }
    const result = injectExpandedSubmoduleEntries(
      [entry],
      new Set(['flutter_mine']),
      statuses,
      LOADING,
      EMPTY
    )
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ type: 'entry', entry })
    expect(result[1]).toMatchObject({
      type: 'entry',
      entry: { path: 'flutter_mine/lib/main.dart', submoduleRoot: 'flutter_mine' }
    })
  })

  it('emits an empty placeholder when loaded with no inner entries', () => {
    const entry = submoduleEntry({ path: 'flutter_mine' })
    const statuses: Record<string, SubmoduleStatusState> = {
      flutter_mine: { status: 'loaded', entries: [] }
    }
    const result = injectExpandedSubmoduleEntries(
      [entry],
      new Set(['flutter_mine']),
      statuses,
      LOADING,
      EMPTY
    )
    expect(result[1]).toMatchObject({
      type: 'submodule-placeholder',
      state: 'empty',
      message: EMPTY
    })
  })
})
