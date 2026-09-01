import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'Ethereum Radio',
  tagline: 'Client-side event-log indexing for dapps — no subgraph, no backend',
  favicon: 'img/favicon.ico',

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  // Deploying as a GitHub Pages *project* site (org page would be
  // polus-arcticus.github.io itself) — served at /ethereum-radio/, so
  // baseUrl must match or every asset path 404s once live.
  url: 'https://polus-arcticus.github.io',
  baseUrl: '/ethereum-radio/',

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
