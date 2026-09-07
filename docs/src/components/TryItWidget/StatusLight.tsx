import type {ReactNode} from 'react';
import type {RadioControllerStatus} from '@ethereum-radio/indexer/react';
import styles from './styles.module.css';

const STATUS_LIGHT_LABEL: Record<RadioControllerStatus, string> = {
	idle: 'not indexing',
	paused: 'not indexing (paused)',
	cancelled: 'not indexing (cancelled)',
	error: 'not indexing (errored)',
	scanning: 'catching up on history',
	'caught-up': 'tailing the live head',
};

// Collapses useRadioController's six-value status into the three-color signal
// a radio's tuning light actually needs: red (nothing running — idle, paused,
// cancelled, or errored), yellow (walking history backward), green (caught up
// and polling the live tip). `scanning` covers both the history backfill and
// the live-tail poll loop inside radio() — but status only flips to
// 'caught-up' once history is fully replayed, so yellow-vs-green here really
// does mean catching-up-vs-live.
const STATUS_LIGHT_CLASS: Record<RadioControllerStatus, string> = {
	idle: styles.statusLightRed,
	paused: styles.statusLightRed,
	cancelled: styles.statusLightRed,
	error: styles.statusLightRed,
	scanning: styles.statusLightYellow,
	'caught-up': styles.statusLightGreen,
};

interface StatusLightProps {
	status: RadioControllerStatus;
}

export default function StatusLight({status}: StatusLightProps): ReactNode {
	return (
		<span
			className={`${styles.statusLight} ${STATUS_LIGHT_CLASS[status]}`}
			role="img"
			aria-label={`Radio status: ${STATUS_LIGHT_LABEL[status]}`}
			title={STATUS_LIGHT_LABEL[status]}
		/>
	);
}
