/**
 * Submodule diff routing for the SSH relay.
 *
 * Why: the parent repo lists a submodule as a single gitlink row, and a gitlink
 * path can't be read as a blob (`git show HEAD:<sub>` is a "bad object"). These
 * helpers route a gitlink root to a synthesized pointer diff and resolve the
 * configured submodule paths so inner files recurse into the submodule worktree.
 * Split from git-handler-ops.ts to keep that file under the max-lines budget.
 */
import * as path from 'path'
import { buildDiffResult } from './git-diff-result'
import { parseBranchDiff } from './git-handler-utils'
import { parseNumstat } from '../shared/git-uncommitted-line-stats'
import { readBlobAtOid, type GitBufferExec, type GitExec } from './git-handler-ops'

/**
 * Configured submodule paths (relative, forward-slash) read from `.gitmodules`.
 * Used to route gitlink/inner diffs without an index-wide `ls-files` scan.
 */
export async function listSubmodulePaths(git: GitExec, worktreePath: string): Promise<string[]> {
  try {
    const { stdout } = await git(
      ['config', '--file', '.gitmodules', '--get-regexp', '^submodule\\..*\\.path$'],
      worktreePath
    )
    return stdout
      .split(/\r?\n/)
      .map((line) => {
        const spaceIndex = line.indexOf(' ')
        return spaceIndex === -1
          ? ''
          : line
              .slice(spaceIndex + 1)
              .trim()
              .replace(/\/+$/, '')
      })
      .filter((value) => value.length > 0)
  } catch {
    return []
  }
}

export function findContainingSubmodule(submodulePaths: string[], filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, '/').replace(/\/+$/, '')
  let best: string | null = null
  for (const sub of submodulePaths) {
    if (normalized === sub || normalized.startsWith(`${sub}/`)) {
      if (!best || sub.length > best.length) {
        best = sub
      }
    }
  }
  return best
}

async function readGitlinkOidFromTree(
  git: GitExec,
  worktreePath: string,
  ref: string,
  submodulePath: string
): Promise<string> {
  try {
    const { stdout } = await git(['ls-tree', ref, '--', submodulePath], worktreePath)
    return stdout.match(/^160000 commit ([0-9a-f]+)\t/m)?.[1] ?? ''
  } catch {
    return ''
  }
}

async function readGitlinkOidFromIndex(
  git: GitExec,
  worktreePath: string,
  submodulePath: string
): Promise<string> {
  try {
    const { stdout } = await git(['ls-files', '-s', '--', submodulePath], worktreePath)
    return stdout.match(/^160000 ([0-9a-f]+) /m)?.[1] ?? ''
  } catch {
    return ''
  }
}

async function readWorkingSubmoduleHead(
  git: GitExec,
  submoduleWorktreePath: string
): Promise<string> {
  try {
    const { stdout } = await git(['rev-parse', 'HEAD'], submoduleWorktreePath)
    return stdout.trim()
  } catch {
    return ''
  }
}

/**
 * Resolve the submodule's recorded commit (parent index, falling back to HEAD)
 * and its checked-out worktree commit. When these differ the gitlink moved.
 */
export async function resolveSubmoduleCommitRange(
  git: GitExec,
  worktreePath: string,
  submodulePath: string
): Promise<{ fromOid: string; toOid: string }> {
  const submoduleWorktreePath = path.join(worktreePath, submodulePath)
  const fromOid =
    (await readGitlinkOidFromIndex(git, worktreePath, submodulePath)) ||
    (await readGitlinkOidFromTree(git, worktreePath, 'HEAD', submodulePath))
  const toOid = await readWorkingSubmoduleHead(git, submoduleWorktreePath)
  return { fromOid, toOid }
}

/**
 * List files changed between two submodule commits as status rows (area
 * `unstaged`), so an expanded moved-pointer submodule shows its committed file
 * changes instead of an empty working-tree status.
 */
export async function computeSubmoduleRangeEntries(
  git: GitExec,
  submoduleWorktreePath: string,
  fromOid: string,
  toOid: string
): Promise<Record<string, unknown>[]> {
  let nameStatus = ''
  let numstat = ''
  try {
    const [statusResult, numstatResult] = await Promise.all([
      git(
        ['-c', 'core.quotePath=false', 'diff', '--name-status', '-M', '-C', fromOid, toOid],
        submoduleWorktreePath
      ),
      git(
        ['-c', 'core.quotePath=false', 'diff', '-z', '--numstat', '-M', '-C', fromOid, toOid],
        submoduleWorktreePath
      )
    ])
    nameStatus = statusResult.stdout
    numstat = numstatResult.stdout
  } catch {
    return []
  }
  return parseBranchDiff(nameStatus, parseNumstat(numstat)).map((entry) => ({
    ...entry,
    area: 'unstaged'
  }))
}

/**
 * Diff a file inside a submodule across two of its commits (recorded vs
 * checked-out), mirroring the local handler's commit-range route.
 */
export async function buildSubmoduleInnerCommitRangeDiff(
  gitBuffer: GitBufferExec,
  submoduleWorktreePath: string,
  innerPath: string,
  fromOid: string,
  toOid: string
) {
  const left = await readBlobAtOid(gitBuffer, submoduleWorktreePath, fromOid, innerPath)
  const right = await readBlobAtOid(gitBuffer, submoduleWorktreePath, toOid, innerPath)
  return buildDiffResult(left.content, right.content, left.isBinary, right.isBinary, innerPath)
}

/**
 * Synthesize a gitlink pointer diff (one-line `Subproject commit <oid>` swap),
 * matching git's own rendering of submodule commit changes.
 */
export async function computeSubmodulePointerDiff(
  git: GitExec,
  worktreePath: string,
  submodulePath: string,
  staged: boolean,
  compareAgainstHead = false
) {
  const submoduleWorktreePath = path.join(worktreePath, submodulePath)
  let leftOid = ''
  let rightOid = ''
  if (staged) {
    leftOid = await readGitlinkOidFromTree(git, worktreePath, 'HEAD', submodulePath)
    rightOid = await readGitlinkOidFromIndex(git, worktreePath, submodulePath)
  } else if (compareAgainstHead) {
    leftOid = await readGitlinkOidFromTree(git, worktreePath, 'HEAD', submodulePath)
    rightOid = await readWorkingSubmoduleHead(git, submoduleWorktreePath)
  } else {
    leftOid =
      (await readGitlinkOidFromIndex(git, worktreePath, submodulePath)) ||
      (await readGitlinkOidFromTree(git, worktreePath, 'HEAD', submodulePath))
    rightOid = await readWorkingSubmoduleHead(git, submoduleWorktreePath)
  }
  return buildDiffResult(
    leftOid ? `Subproject commit ${leftOid}\n` : '',
    rightOid ? `Subproject commit ${rightOid}\n` : '',
    false,
    false,
    submodulePath
  )
}
