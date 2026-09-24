# @best-i18n/next-unprefixed-locale

Serve the default locale unprefixed from a Next.js static export - `/about`
and `/zh/about`, not `/en/about` - without writing the route tree twice.

```text
app/
  [lang]/            what you write
    layout.tsx
    docs/[[...slug]]/page.tsx
  (unprefixed)/      what this generates, gitignored
    layout.tsx       → imports [lang]/layout, params.lang pinned to 'en'
    docs/[[...slug]]/page.tsx
```

## Why

Routes under `app/[locale]` give every language a prefix. Hiding it for the
default locale takes a proxy that rewrites `/about` onto `/en/about`, and a
static export (`output: 'export'`) has no proxy: only the files that exist are
served. The usual answer is a second route tree - a route group with one file
per route that imports the `[locale]` version and hardcodes the locale. It
works, and it drifts: every new route needs its twin, and a forgotten twin is
a 404 nobody sees until production.

This package writes that second tree. Each generated file imports the original
module, adds the locale to `params`, and hands the call on. The originals stay
the only place logic lives; the mirror is regenerated on every config load and
kept current while `next dev` runs.

## Setup

```bash
pnpm add @best-i18n/next-unprefixed-locale
```

```ts
// next.config.ts
import { withUnprefixedLocale } from '@best-i18n/next-unprefixed-locale'

const withUnprefixed = withUnprefixedLocale({
  defaultLocale: 'en',
  localeParam: 'lang', // app/[lang]; the default is 'locale'
})

export default withUnprefixed({ output: 'export' })
```

Then keep the default locale out of the `[locale]` tree, or its pages would be
built twice:

```ts
// app/[lang]/layout.tsx
export function generateStaticParams() {
  return locales.filter((lang) => lang !== 'en').map((lang) => ({ lang }))
}

export const dynamicParams = false
```

That is the setup. `app/(unprefixed)` appears on the next `next dev`, `next
build` or `next typegen`; it carries its own `.gitignore`, so nothing changes
in the repo's.

## generateStaticParams

A mirrored route has no locale segment, so its `generateStaticParams` cannot
return one, and with `output: 'export'` an extra key is a build error. The
wrapper handles this by calling the original with the default locale as the
parent segment's param, then dropping the key from the result. What the
original has to do differs between pages and route handlers, because Next
treats them differently.

**Pages and layouts** receive the params of the segments above them. Derive
the params from the locale you are handed and both trees are right:

```ts
// app/[lang]/docs/[[...slug]]/page.tsx
export function generateStaticParams({ params }: { params: { lang: string } }) {
  return source.generateParams().filter((p) => p.lang === params.lang)
}
```

Under `[lang]`, the layout above supplies each prefixed locale in turn. The
mirror supplies the default one.

**Route handlers** sit outside the layout tree, so Next calls their
`generateStaticParams` with no parent params, and they have to enumerate
everything themselves. Read the locale when it is there, enumerate when it is
not:

```ts
// app/[lang]/og/[...slug]/route.tsx
export function generateStaticParams({
  params,
}: {
  params?: { lang?: string }
}) {
  const langs = params?.lang
    ? [params.lang]
    : locales.filter((lang) => lang !== 'en')

  return langs.flatMap((lang) => paramsFor(lang))
}
```

An original that ignores the param and returns every locale still works - the
wrapper keeps only the default locale's entries - as long as it includes the
default locale in what it returns.

## What is generated

| In `[locale]`                                            | In the mirror                                                                                                                                                                                   |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `page`, `layout`, `template`, `default`                  | A component rendering the original with `params` pinned. `generateMetadata`, `generateViewport` and `generateStaticParams` are wrapped the same way; `metadata` and `viewport` are re-exported. |
| `route`                                                  | One function per HTTP method, `context.params` pinned, plus `generateStaticParams`.                                                                                                             |
| `opengraph-image`, `twitter-image`, `icon`, `apple-icon` | The default export and `generateImageMetadata` pinned; `alt`, `size`, `contentType` re-exported.                                                                                                |
| `loading`, `error`, `not-found`, `global-error`          | Re-exported as they are; they take no params.                                                                                                                                                   |
| `favicon.ico`, `icon.png`, `robots.txt`, …               | Copied.                                                                                                                                                                                         |
| Anything else - components, helpers, styles              | Left alone. The wrappers import the originals, which resolve their own neighbours.                                                                                                              |

Route segment config - `dynamic`, `dynamicParams`, `revalidate` and the rest -
is repeated as a literal, because Next reads it by static analysis and would
not see a re-exported binding. Write those values inline in the original; a
value that is not a literal is skipped with a warning.

A `'use client'` page gets a `'use client'` wrapper, so Next renders it through
the same client boundary it would the original. A server wrapper forwarding
`searchParams` to a client component would have it resolved during prerender,
which makes the page dynamic and fails the export.

The wrappers are typed against the originals, so `next typegen`'s validator
checks them like any other route file, and a TypeScript original produces a
TypeScript wrapper. A generated page looks like this:

```ts
// Generated by @best-i18n/next-unprefixed-locale from [lang]/docs/[[...slug]]/page.tsx.
import {
  pin,
  render,
  staticParams,
} from '@best-i18n/next-unprefixed-locale/runtime'
import * as origin from '../../../[lang]/docs/[[...slug]]/page'
import type {
  Arg0,
  Unprefixed,
} from '@best-i18n/next-unprefixed-locale/runtime'

export default function Page(
  props: Unprefixed<Arg0<typeof origin.default>, 'lang'>,
) {
  return render(origin.default, pin(props, 'lang', 'en'))
}

export function generateStaticParams(props?: {
  params?: Record<string, unknown>
}) {
  return staticParams(origin.generateStaticParams, props, 'lang', 'en')
}

export const dynamicParams = false
```

## Options

| Option           | Default                                  |                                                                          |
| ---------------- | ---------------------------------------- | ------------------------------------------------------------------------ |
| `defaultLocale`  | required                                 | The locale served unprefixed.                                            |
| `localeParam`    | `'locale'`                               | Name of the segment: `[locale]`, `[lang]`.                               |
| `appDir`         | `src/app`, else `app`                    | Relative to the working directory.                                       |
| `group`          | `'(unprefixed)'`                         | Where the mirror goes. Must be a route group, so it adds no URL segment. |
| `pageExtensions` | from `next.config`, else `tsx ts jsx js` | Which files are routes.                                                  |
| `watch`          | `NODE_ENV === 'development'`             | Regenerate when files are added to or removed from `[locale]`.           |
| `quiet`          | `false`                                  | Skip the one-line summary. Warnings are always printed.                  |

`generate(options)` is exported too, for running it outside the config, and
there is a CLI for the same:

```bash
next-unprefixed-locale --locale en --param lang          # once
next-unprefixed-locale --locale en --param lang --watch  # keep going
```

## Limits

- **No dynamic segment directly under `[locale]`.** `[lang]/[slug]` would
  mirror to `/[slug]`, beside `/[lang]` at the root, and Next does not allow
  two dynamic segments with different names at one level. Put it under a
  static one. This is a constraint of the two-tree layout, generated or not.
- **Two root layouts.** `[locale]/layout.tsx` and its mirror each render
  `<html>`, so switching locale is a full page load rather than a client
  navigation. Also true of the hand-written version.
- **`export *`** in a route file hides its exports from the mirror; only the
  ones the file declares itself are wrapped.
- **New routes in `next dev`** appear once the watcher has run, a moment after
  the file is saved. Deleting a route removes its wrapper the same way.

## With fumadocs and best-i18n

fumadocs' `defineI18n({ hideLocale: 'default-locale' })` produces exactly the
URL shape this serves, and its `[lang]` segment is the `localeParam`.

An app on [best-i18n](https://github.com/best-i18n/best-i18n#readme) does not
need the wrapper at all: its Next plugin already knows the base locale and the
segment name, and takes plugins that run at config load with them.
`staticExport()` is this package as one of those - `createI18nPlugin({ ...i18n,
messagesDir, plugins: [staticExport()] })` - and accepts the same options minus
the two it is handed. Neither package depends on the other. The best-i18n docs
site is the working example: one `[lang]` tree, docs pages, a route handler per
page for its Markdown, another for its OpenGraph image, and a `'use client'`
landing page, all mirrored.

## License

MIT
