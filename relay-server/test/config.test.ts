import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'

describe('relay access token config', () => {
  it('requires a non-empty access token', () => {
    expect(() => loadConfig({})).toThrow('RELAY_ACCESS_TOKEN is required')
    expect(() => loadConfig({ RELAY_ACCESS_TOKEN: '   ' })).toThrow(
      'RELAY_ACCESS_TOKEN is required'
    )
  })

  it('trims and loads the access token', () => {
    expect(loadConfig({ RELAY_ACCESS_TOKEN: '  known-secret  ' }).accessToken).toBe('known-secret')
  })
})
