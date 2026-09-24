import { existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { staticExport } from '../src/index.ts'
import { project } from './helpers.ts'

const roots: string[] = []

function make(): string {
  const root = project(
    { 'about/page.tsx': 'export default function About() { return null }\n' },
    { appDir: 'app', param: 'lang' },
  )
  roots.push(root)
  vi.spyOn(process, 'cwd').mockReturnValue(root)
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
  vi.restoreAllMocks()
})

const mirror = (root: string, group = '(unprefixed)') =>
  existsSync(path.join(root, `app/${group}/about/page.tsx`))

describe('staticExport', () => {
  it('mirrors with the locale and segment best-i18n hands over', () => {
    const root = make()
    const plugin = staticExport({ watch: false })

    expect(plugin.name).toBe('next-unprefixed-locale')
    plugin.config(
      { output: 'export' },
      { options: { baseLocale: 'en', localeParam: 'lang' } },
    )

    expect(mirror(root)).toBe(true)
  })

  it('passes its own options through and warns without output: export', () => {
    const root = make()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    staticExport({ group: '(root)', watch: false }).config(
      {},
      { options: { baseLocale: 'en', localeParam: 'lang' } },
    )

    expect(mirror(root, '(root)')).toBe(true)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("output: 'export'"),
    )
  })

  it('refuses to combine with prefixBase', () => {
    const root = make()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    staticExport({ watch: false }).config(
      { output: 'export' },
      { options: { baseLocale: 'en', localeParam: 'lang', prefixBase: true } },
    )

    expect(mirror(root)).toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('prefixBase'))
  })
})
