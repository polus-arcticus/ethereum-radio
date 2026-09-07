import type {ReactNode} from 'react';
import styles from './styles.module.css';

interface DiagramFigureProps {
	children: ReactNode;
	caption?: ReactNode;
}

// A consistent wrapper for the small inline SVG diagrams that break up prose
// on doc pages (as opposed to HomepageFeatures' fixed-size icon grid) — full
// width up to a readable max, with an optional caption underneath.
export default function DiagramFigure({children, caption}: DiagramFigureProps): ReactNode {
	return (
		<figure className={styles.figure}>
			{children}
			{caption && <figcaption className={styles.caption}>{caption}</figcaption>}
		</figure>
	);
}
