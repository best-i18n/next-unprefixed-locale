import { watch } from 'node:fs'
import process from 'node:process'
import { generate } from './generate.ts'
import type { GenerateOptions, GenerateResult } from './generate.ts'

export { generate }
export type { GenerateOptions, GenerateResult }

/**
 * The one field of `NextConfig` this reads, declared structurally: `next` is
 * an optional peer, and a `.d.ts` that imports it would break for everyone
 * who uses the CLI without it.
 */
export interface NextConfigLike {
  pageExtensions?: string[] | undefined
}

export interface UnprefixedLocaleOptions extends GenerateOptions {
  /**
   * Regenerate when files are added to or removed from `[locale]`, so a new
   * route shows up unprefixed in `next dev` without a restart.
   *
   * @default process.env.NODE_ENV === 'development'
   */
  watch?: boolean
}

const watching = new Set<string>()

function watchOrigin(dir: string, regenerate: () => void): void {
  if (watching.has(dir)) return
  watching.add(dir)

  let timer: ReturnType<typeof setTimeout> | undefined
  const watcher = watch(dir, { recursive: true }, () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      try {
        regenerate()
      } catch (error) {
        console.error(error)
      }
    }, 100)
  })

  // `next typegen` and friends load the config too; a watcher that held the
  // event loop open would keep them from ever exiting.
  watcher.unref()
  watcher.on('error', () => watching.delete(dir))
}

/**
 * Wraps `next.config` so the mirror is regenerated every time Next loads the
 * config - `next dev`, `next build`, `next typegen` - and kept current while
 * `next dev` runs. The config itself is returned unchanged.
 *
 * @example
 *   // next.config.ts
 *   import { withUnprefixedLocale } from '@best-i18n/next-unprefixed-locale'
 *
 *   const withUnprefixed = withUnprefixedLocale({
 *     defaultLocale: 'en',
 *     localeParam: 'lang', // app/[lang]
 *   })
 *
 *   export default withUnprefixed({ output: 'export' })
 */
export function withUnprefixedLocale(options: UnprefixedLocaleOptions) {
  return function withUnprefixed<T extends NextConfigLike>(nextConfig: T): T {
    return mirror(options, nextConfig)
  }
}

function mirror<T extends NextConfigLike>(
  options: UnprefixedLocaleOptions,
  nextConfig: T,
): T {
  const { watch: shouldWatch, ...rest } = options
  const resolved: GenerateOptions = {
    ...rest,
    pageExtensions: rest.pageExtensions ?? nextConfig.pageExtensions,
  }

  const result = generate(resolved)

  if (shouldWatch ?? process.env.NODE_ENV === 'development') {
    watchOrigin(result.originDir, () => generate(resolved))
  }

  return nextConfig
}

/** What `staticExport()` takes: everything but what best-i18n already knows. */
export type StaticExportOptions = Omit<
  UnprefixedLocaleOptions,
  'defaultLocale' | 'localeParam'
>

/**
 * The shape of best-i18n's `createI18nPlugin` plugin, spelled out here rather
 * than imported so neither package depends on the other. Structural typing
 * is what lets the two meet.
 */
export interface I18nPluginContext {
  options: {
    baseLocale: string
    localeParam?: string | undefined
    prefixBase?: boolean | undefined
  }
}

/**
 * The same mirror as `withUnprefixedLocale`, as a plugin for best-i18n's
 * `createI18nPlugin`, which already knows the base locale and the segment
 * name and hands them over - so the app describes its locales once.
 *
 * @example
 *   // next.config.ts
 *   import { staticExport } from '@best-i18n/next-unprefixed-locale'
 *
 *   const withI18n = createI18nPlugin({
 *     ...i18n,
 *     messagesDir,
 *     plugins: [staticExport()],
 *   })
 *
 *   export default withI18n({ output: 'export' })
 */
export function staticExport(options: StaticExportOptions = {}) {
  return {
    name: 'next-unprefixed-locale',
    config(
      nextConfig: NextConfigLike & { output?: string | undefined },
      { options: i18n }: I18nPluginContext,
    ): void {
      if (i18n.prefixBase) {
        console.warn(
          '[next-unprefixed-locale] staticExport() was ignored: with `prefixBase: true` the base locale is served under its prefix, so there is nothing unprefixed to mirror.',
        )
        return
      }

      if (nextConfig.output !== 'export') {
        console.warn(
          "[next-unprefixed-locale] staticExport() is in use but the Next config has no `output: 'export'`. The mirror only matters for a static export; on a server the proxy serves the unprefixed URLs.",
        )
      }

      mirror(
        {
          ...options,
          defaultLocale: i18n.baseLocale,
          localeParam: i18n.localeParam ?? 'locale',
        },
        nextConfig,
      )
    },
  }
}
