import type { GlobalSettings } from '../../../../shared/types'
import { Label } from '../ui/label'
import { translate } from '@/i18n/i18n'
import { SearchableSetting } from './SearchableSetting'
import { matchesSettingsSearch } from './settings-search'

export const COMPARE_AGAINST_UPSTREAM_KEYWORDS = [
  'compare base',
  'current branch',
  'upstream',
  'local changes',
  'origin/master',
  'committed changes',
  'diff base',
  'source control'
]

function getCompareAgainstUpstreamTitle(): string {
  return translate(
    'auto.components.settings.GitPane.compareAgainstUpstreamTitle',
    'Compare Against Current Branch'
  )
}

function getCompareAgainstUpstreamDescription(): string {
  return translate(
    'auto.components.settings.GitPane.compareAgainstUpstreamDescription',
    "Default the Source Control compare base to the current branch's upstream so it prioritizes local changes, instead of the repository default branch. Only affects the compare view, not the Pull Request or rebase target."
  )
}

export function compareAgainstUpstreamMatchesSearch(searchQuery: string): boolean {
  return matchesSettingsSearch(searchQuery, {
    title: getCompareAgainstUpstreamTitle(),
    description: getCompareAgainstUpstreamDescription(),
    keywords: COMPARE_AGAINST_UPSTREAM_KEYWORDS
  })
}

export function CompareAgainstUpstreamSetting({
  settings,
  updateSettings
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void | Promise<void>
}): React.JSX.Element {
  const title = getCompareAgainstUpstreamTitle()
  const description = getCompareAgainstUpstreamDescription()

  return (
    <SearchableSetting
      title={title}
      description={description}
      keywords={COMPARE_AGAINST_UPSTREAM_KEYWORDS}
      className="flex items-center justify-between gap-4 py-2"
    >
      <div className="space-y-0.5">
        <Label>{title}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <button
        role="switch"
        aria-checked={settings.sourceControlCompareAgainstUpstream}
        onClick={() =>
          updateSettings({
            sourceControlCompareAgainstUpstream: !settings.sourceControlCompareAgainstUpstream
          })
        }
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors ${
          settings.sourceControlCompareAgainstUpstream ? 'bg-foreground' : 'bg-muted-foreground/30'
        }`}
      >
        <span
          className={`pointer-events-none block size-3.5 rounded-full bg-background shadow-sm transition-transform ${
            settings.sourceControlCompareAgainstUpstream ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </button>
    </SearchableSetting>
  )
}
