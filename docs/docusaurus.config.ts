import {readFileSync} from 'node:fs';
import path from 'node:path';
import GithubSlugger from 'github-slugger';
import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

// Deploying as a GitHub Pages *project* site (org page would be
// polus-arcticus.github.io itself) — served at /ethereum-radio/, so
// baseUrl must match or every asset path 404s once live. Pulled out to a
// constant since the sidebar heading generator below needs to build the same
// URLs the site itself resolves to.
const baseUrl = '/ethereum-radio/';

// Strips inline markdown (code spans, bold, italic) from a heading's raw
// text, for both the sidebar label (plain string, not markdown-rendered)
// and as input to slugify() below.
const toPlainText = (heading: string): string =>
  heading
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\*([^*]*)\*/g, '$1')
    .trim();

// github-slugger is what Docusaurus's own MDX heading-anchor plugin uses
// internally — reusing the same library (rather than approximating the
// algorithm by hand) guarantees these hrefs match the real anchors byte for
// byte, including edge cases like "`Store<T>` / `SpanStore`" ->
// "storet--spanstore" (the stripped `<T>` and `/` each still contribute a
// separate hyphen). One Slugger instance per file, reused across all of that
// file's headings in document order, so duplicate heading text within one
// page gets the same -1/-2 suffixing Docusaurus itself would apply.
const slugifyHeadings = (plainTexts: string[]): string[] => {
  const slugger = new GithubSlugger();
  return plainTexts.map((text) => slugger.slug(text));
};

// Reads an .mdx file's top-level (##) headings, skipping fenced code blocks
// so a stray "##"-looking line inside a snippet is never mistaken for one.
const extractH2Headings = (filePath: string): string[] => {
  const headings: string[] = [];
  let inFence = false;
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    if (/^```/.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^##\s+(.+?)\s*$/.exec(line);
    if (match) headings.push(match[1]!);
  }
  return headings;
};

// Turns each docs/api/*.mdx page into its own collapsible sidebar dropdown,
// one entry per ## heading (createRadio, Cursor, checkForReorg, ...) —
// Docusaurus's default generator only nests at the file level, so without
// this every API page is one flat link and you have to open it to see
// what's inside. Left untouched for installation.mdx/usage.mdx, which don't
// need this — a plain link is enough there.
const addApiHeadingSubItems = (
  items: any[],
  docs: {id: string; title: string; source: string}[],
): any[] =>
  items.map((item) => {
    if (item.type === 'category') {
      return {...item, items: addApiHeadingSubItems(item.items, docs)};
    }
    if (item.type === 'doc' && typeof item.id === 'string' && item.id.startsWith('api/')) {
      const doc = docs.find((d) => d.id === item.id);
      if (!doc) return item;
      const filePath = path.join(__dirname, doc.source.replace(/^@site[\\/]/, ''));
      const headings = extractH2Headings(filePath).map(toPlainText);
      if (headings.length === 0) return item;
      const slugs = slugifyHeadings(headings);
      return {
        type: 'category',
        label: item.label ?? doc.title,
        collapsible: true,
        collapsed: true,
        link: {type: 'doc', id: item.id},
        items: headings.map((heading, i) => ({
          type: 'link',
          label: heading,
          // routeBasePath defaults to 'docs' (not overridden in the docs
          // preset below) — keep this in sync if that ever changes.
          href: `${baseUrl}docs/${item.id}#${slugs[i]}`,
        })),
      };
    }
    return item;
  });

const config: Config = {
  title: 'Ethereum Radio',
  tagline: 'Client-side event-log indexing for dapps — no subgraph, no backend',
  favicon: 'img/favicon.ico',

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  url: 'https://polus-arcticus.github.io',
  baseUrl,

  // GitHub pages deployment config.
  organizationName: 'polus-arcticus', // Usually your GitHub org/user name.
  projectName: 'ethereum-radio', // Usually your repo name.

  // Explicit per Docusaurus's own deploy warning — avoids GitHub Pages
  // adding a server-redirect trailing slash on direct (non-navigated) hits.
  trailingSlash: false,

  onBrokenLinks: 'throw',

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/polus-arcticus/ethereum-radio/tree/main/docs/',
          sidebarItemsGenerator: async ({defaultSidebarItemsGenerator, ...args}) => {
            const items = await defaultSidebarItemsGenerator(args);
            return addApiHeadingSubItems(items, args.docs);
          },
        },
        blog: {
          showReadingTime: true,
          feedOptions: {
            type: ['rss', 'atom'],
            xslt: true,
          },
          editUrl: 'https://github.com/polus-arcticus/ethereum-radio/tree/main/docs/',
          // Useful options to enforce blogging best practices
          onInlineTags: 'warn',
          onInlineAuthors: 'warn',
          onUntruncatedBlogPosts: 'warn',
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  // Local, offline fuzzy search — builds a lunr.js index at build time and
  // searches entirely client-side, no external service/account required
  // (unlike Algolia DocSearch, which crawls the live public site and needs
  // an application/approval).
  themes: [
    [
      '@easyops-cn/docusaurus-search-local',
      {
        hashed: true,
        language: ['en'],
        indexBlog: true,
        indexDocs: true,
        // Default edit distance (1) only tolerates a single typo; loosen it
        // slightly given the terse, hash/param-heavy vocabulary here
        // (`blockRangeLimit`, `checkForReorg`, ...).
        fuzzyMatchingDistance: 2,
        highlightSearchTermsOnTargetPage: true,
      },
    ],
  ],

  themeConfig: {
    // Replace with your project's social card
    image: 'img/docusaurus-social-card.jpg',
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Ethereum Radio',
      logo: {
        alt: 'Ethereum Radio Logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'tutorialSidebar',
          position: 'left',
          label: 'Docs',
        },
        {to: '/blog', label: 'Blog', position: 'left'},
        {to: '/try-it', label: 'Try it out', position: 'left'},
        {
          href: 'https://github.com/polus-arcticus/ethereum-radio',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'Installation',
              to: '/docs/installation',
            },
            {
              label: 'Usage',
              to: '/docs/usage',
            },
            {
              label: 'API Reference',
              to: '/docs/api/core',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'Blog',
              to: '/blog',
            },
            {
              label: 'GitHub',
              href: 'https://github.com/polus-arcticus/ethereum-radio',
            },
            {
              label: 'npm',
              href: 'https://www.npmjs.com/package/@ethereum-radio/indexer',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Ethereum Radio.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
