import type {ReactNode} from 'react';
import clsx from 'clsx';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  Svg: React.ComponentType<React.ComponentProps<'svg'>>;
  description: ReactNode;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'Client-Side Indexing',
    Svg: require('@site/static/img/index-scan.svg').default,
    description: (
      <>
        Track which block ranges have already been scanned and resume from
        there — no subgraph, no backend indexer, no server to run.
      </>
    ),
  },
  {
    title: 'Adapter-Agnostic',
    Svg: require('@site/static/img/adapter-plug.svg').default,
    description: (
      <>
        Works with <code>viem</code> or <code>ethers</code> — pick one, wrap
        your existing client with an adapter, and everything else stays the
        same.
      </>
    ),
  },
  {
    title: 'Storage-Agnostic',
    Svg: require('@site/static/img/storage-swap.svg').default,
    description: (
      <>
        Scan progress lives behind a tiny, swappable <code>SpanStore</code>{' '}
        interface — ship with in-memory or <code>localStorage</code>, or
        write your own in a handful of lines.
      </>
    ),
  },
];

function Feature({title, Svg, description}: FeatureItem) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center">
        <Svg className={styles.featureSvg} role="img" />
      </div>
      <div className="text--center padding-horiz--md">
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
