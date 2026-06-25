import { useCallback, useEffect, useRef, useState } from 'react'
import type { GitStatusEntry } from '../../../../shared/types'
import { getConnectionId } from '@/lib/connection-context'
import { getRuntimeGitSubmoduleStatus, type RuntimeGitContext } from '@/runtime/runtime-git-client'
import type { SubmoduleStatusState } from './source-control-submodule-expansion'

export type UseSourceControlSubmoduleStatusInput = {
  activeWorktreeId: string | null | undefined
  worktreePath: string | null
  activeRepoSettings: RuntimeGitContext['settings']
  // Why: re-fetch expanded children whenever the parent status poll refreshes
  // its entries, so an expanded submodule's inner changes stay fresh.
  entries: readonly GitStatusEntry[]
}

export type UseSourceControlSubmoduleStatusResult = {
  expandedSubmodulePaths: Set<string>
  submoduleStatusByPath: Record<string, SubmoduleStatusState>
  toggleSubmodule: (submodulePath: string) => void
}

/**
 * Owns the lazy submodule-expansion state for Source Control: which dirty
 * submodules are expanded and the on-demand inner status for each. Dirty
 * submodules start collapsed and only query their inner `git status` when
 * expanded, so the parent status poll never recurses into (possibly nested)
 * submodules.
 */
export function useSourceControlSubmoduleStatus(
  input: UseSourceControlSubmoduleStatusInput
): UseSourceControlSubmoduleStatusResult {
  const { activeWorktreeId, worktreePath, activeRepoSettings, entries } = input
  const [expandedSubmodulePaths, setExpandedSubmodulePaths] = useState<Set<string>>(() => new Set())
  const [submoduleStatusByPath, setSubmoduleStatusByPath] = useState<
    Record<string, SubmoduleStatusState>
  >({})

  // Why: a monotonically increasing generation invalidates in-flight requests
  // when the active worktree/path changes, so a slow response from a previous
  // worktree (common over SSH) can't write stale submodule status into the
  // current panel — even when both worktrees share the same submodule path.
  const generationRef = useRef(0)

  useEffect(() => {
    generationRef.current += 1
    setExpandedSubmodulePaths(new Set())
    setSubmoduleStatusByPath({})
  }, [activeWorktreeId, worktreePath])

  const fetchSubmoduleStatus = useCallback(
    async (submodulePath: string): Promise<void> => {
      if (!worktreePath) {
        return
      }
      const generation = generationRef.current
      // Why: keep any already-loaded children visible during a poll-driven
      // refetch so expanding then refreshing doesn't flash a loading row.
      setSubmoduleStatusByPath((prev) =>
        prev[submodulePath] ? prev : { ...prev, [submodulePath]: { status: 'loading' } }
      )
      try {
        const connectionId = getConnectionId(activeWorktreeId ?? null) ?? undefined
        const result = await getRuntimeGitSubmoduleStatus(
          {
            // Why: route by the repo OWNER host, matching the rest of this panel.
            settings: activeRepoSettings,
            worktreeId: activeWorktreeId,
            worktreePath,
            connectionId
          },
          submodulePath
        )
        if (generationRef.current !== generation) {
          return
        }
        setSubmoduleStatusByPath((prev) => ({
          ...prev,
          [submodulePath]: { status: 'loaded', entries: result.entries }
        }))
      } catch (error) {
        if (generationRef.current !== generation) {
          return
        }
        setSubmoduleStatusByPath((prev) => ({
          ...prev,
          [submodulePath]: {
            status: 'error',
            error: error instanceof Error ? error.message : String(error)
          }
        }))
      }
    },
    [activeRepoSettings, activeWorktreeId, worktreePath]
  )

  const toggleSubmodule = useCallback((submodulePath: string) => {
    setExpandedSubmodulePaths((prev) => {
      const next = new Set(prev)
      if (next.has(submodulePath)) {
        next.delete(submodulePath)
      } else {
        next.add(submodulePath)
      }
      return next
    })
  }, [])

  // Why: (re)load inner status only for currently-expanded submodules. Re-runs
  // when the parent status poll refreshes `entries` so expanded children stay
  // fresh, while collapsed submodules never trigger any extra git work.
  useEffect(() => {
    for (const submodulePath of expandedSubmodulePaths) {
      void fetchSubmoduleStatus(submodulePath)
    }
  }, [expandedSubmodulePaths, entries, fetchSubmoduleStatus])

  return { expandedSubmodulePaths, submoduleStatusByPath, toggleSubmodule }
}
