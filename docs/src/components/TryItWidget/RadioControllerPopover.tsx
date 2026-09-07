import type {ReactNode} from 'react';
import type {RadioControllerStatus} from '@ethereum-radio/indexer/react';
import styles from './styles.module.css';

interface RadioControllerPopoverProps {
	status: RadioControllerStatus;
	elapsedMs: number;
	totalFound: number;
	isTakingAWhile: boolean;
	pause: () => void;
	resume: () => void;
	cancel: () => void;
}

const POPOVER_ID = 'radio-controller-popover';

const STATUS_LABEL: Record<RadioControllerStatus, string> = {
	idle: 'Idle',
	scanning: 'Scanning',
	paused: 'Paused',
	'caught-up': 'Caught up',
	cancelled: 'Cancelled',
	error: 'Error',
};

const formatElapsed = (ms: number): string => {
	const seconds = Math.floor(ms / 1_000);
	if (seconds < 60) return `${seconds}s`;
	return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

// A small floating panel over the native HTML Popover API (`popover` +
// `popoverTarget` — no dialog/portal library) that lets a user watching a
// long-running scan check status and pause/resume/cancel it. Pause/resume
// need no support from the underlying stream beyond what useRadioController
// already provides — see that hook's module comment for why.
export default function RadioControllerPopover({
	status,
	elapsedMs,
	totalFound,
	isTakingAWhile,
	pause,
	resume,
	cancel,
}: RadioControllerPopoverProps): ReactNode {
	const isPausable = status === 'scanning' || status === 'caught-up';
	const isResumable = status === 'paused';
	const isCancellable = isPausable || isResumable;

	return (
		<div className={styles.radioControllerTrigger}>
			<button
				type="button"
				popoverTarget={POPOVER_ID}
				className="button button--secondary button--sm">
				Scan status: {STATUS_LABEL[status]} ({formatElapsed(elapsedMs)})
			</button>
			<div id={POPOVER_ID} popover="auto" className={styles.radioControllerPopover}>
				<strong>Radio controller</strong>
				<p className={styles.reorgStatus}>
					{STATUS_LABEL[status]} — {formatElapsed(elapsedMs)} elapsed — {totalFound} log(s) found
				</p>
				{isTakingAWhile && (
					<p className={styles.warning}>
						This is taking a while — the contract may be busier than expected. Consider pausing and
						narrowing the block range, or check the RPC capabilities panel above.
					</p>
				)}
				<div className={styles.row}>
					{isPausable && (
						<button type="button" className="button button--secondary button--sm" onClick={pause}>
							Pause
						</button>
					)}
					{isResumable && (
						<button type="button" className="button button--primary button--sm" onClick={resume}>
							Resume
						</button>
					)}
					{isCancellable && (
						<button type="button" className="button button--danger button--sm" onClick={cancel}>
							Cancel
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
