import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {RawLog} from '../adapters/types.ts';
import {createCursor, type Cursor, type CursorConfig} from '../core/cursor.ts';
import {radio} from '../core/radio.ts';

export interface UseRadioControllerArgs extends CursorConfig {
	/** Delay between live-tail sync() polls once history is fully replayed. Default: 4000ms. */
	pollIntervalMs?: number;
	/** See RadioOptions.yieldEveryMs. Default: 50ms. */
	yieldEveryMs?: number;
	/** No new chunk, and not yet caught up, for this long -> isTakingAWhile flips true. Default: 15,000ms. */
	takingAWhileMs?: number;
	/** Caps how many RawLog entries `logs` holds — totalFound still counts everything found. Default: 200. */
	logCap?: number;
	/** How often status/isTakingAWhile/caught-up are recomputed. Default: 1000ms. */
	statusPollMs?: number;
}

export type RadioControllerStatus =
	| 'idle'
	| 'scanning'
	| 'paused'
	| 'caught-up'
	| 'cancelled'
	| 'error';

export interface UseRadioControllerResult {
	status: RadioControllerStatus;
	logs: RawLog[];
	totalFound: number;
	isTakingAWhile: boolean;
	elapsedMs: number;
	error: Error | undefined;
	pause: () => void;
	resume: () => void;
	cancel: () => void;
	/** The underlying Cursor — for getCellStates()/checkForReorg()/isFullyScanned() and the like; this hook doesn't duplicate that surface. */
	cursor: Cursor;
}

const DEFAULT_TAKING_A_WHILE_MS = 15_000;
const DEFAULT_LOG_CAP = 200;
const DEFAULT_STATUS_POLL_MS = 1_000;

// A React binding over radio()'s streaming replay, adding the controls a
// long-running scan against a dense contract actually needs: pause/resume
// without losing progress, cancel, and an "is this stuck?" status. Pause and
// resume need no new capability from core/radio.ts — Cursor is already
// designed to be fully re-derivable from `store` (every method re-reads
// store.load(key) fresh, see core/cursor.ts), so "pause" is just aborting the
// current radio() and "resume" is starting a fresh one against the *same*
// store/checkpointStore the caller passed in, which naturally continues
// wherever the aborted one left off.
export const useRadioController = (args: UseRadioControllerArgs): UseRadioControllerResult => {
	const {
		provider,
		store,
		key,
		address,
		floorBlock,
		blockRangeLimit,
		safetyPadding,
		atBlock,
		checkpointStore,
		pollIntervalMs,
		yieldEveryMs,
		takingAWhileMs = DEFAULT_TAKING_A_WHILE_MS,
		logCap = DEFAULT_LOG_CAP,
		statusPollMs = DEFAULT_STATUS_POLL_MS,
	} = args;
	// Arrays/objects (address, topics) can't safely sit in a dep array by
	// reference — stringify them so a new-but-equal value doesn't churn the
	// memoized cursor every render. Same convention as useCursor.
	const topicsKey = JSON.stringify(args.topics ?? null);
	const addressKey = JSON.stringify(address);

	const cursor = useMemo(
		() =>
			createCursor({
				provider,
				store,
				key,
				address,
				topics: args.topics,
				floorBlock,
				blockRangeLimit,
				safetyPadding,
				atBlock,
				checkpointStore,
			}),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[
			provider,
			store,
			key,
			addressKey,
			topicsKey,
			floorBlock,
			blockRangeLimit,
			safetyPadding,
			atBlock,
			checkpointStore,
		],
	);

	const [status, setStatus] = useState<RadioControllerStatus>('idle');
	const [logs, setLogs] = useState<RawLog[]>([]);
	const [totalFound, setTotalFound] = useState(0);
	const [isTakingAWhile, setIsTakingAWhile] = useState(false);
	const [elapsedMs, setElapsedMs] = useState(0);
	const [error, setError] = useState<Error>();
	// Bumped by resume() — the effect dependency that starts a fresh radio()
	// against the same cursor/store, continuing from wherever the aborted one
	// left off.
	const [generation, setGeneration] = useState(0);

	// Mirrors `status` for the interval/pause/resume/cancel closures below,
	// which need the latest value without re-running the whole streaming
	// effect (and its AbortController) every time status itself changes.
	const statusRef = useRef(status);
	useEffect(() => {
		statusRef.current = status;
	}, [status]);

	const controllerRef = useRef<AbortController | null>(null);
	// Set once, on the first run — elapsedMs reflects total wall-clock time
	// since this scan started, including any paused gaps, not "time since
	// the last resume".
	const startedAtRef = useRef<number | null>(null);
	const pendingLogsRef = useRef<RawLog[]>([]);
	const pendingCountRef = useRef(0);

	useEffect(() => {
		const controller = new AbortController();
		controllerRef.current = controller;
		if (startedAtRef.current === null) startedAtRef.current = Date.now();
		let lastChunkAt = Date.now();

		setStatus('scanning');
		setError(undefined);
		pendingLogsRef.current = [];
		pendingCountRef.current = 0;

		const flush = () => {
			// Captured into locals *before* resetting the refs — the setState
			// updaters below close over these fixed values, not the mutable
			// refs, so it doesn't matter whether React invokes an updater
			// synchronously here or defers it to the next render: reading
			// `pendingLogsRef.current`/`pendingCountRef.current` directly inside
			// an updater is a race against the reset two lines down, since
			// nothing guarantees both updaters run at the same point relative
			// to it.
			const newLogs = pendingLogsRef.current;
			const newCount = pendingCountRef.current;
			if (newCount === 0) return;
			pendingLogsRef.current = [];
			pendingCountRef.current = 0;
			setLogs((prev) => [...newLogs, ...prev].slice(0, logCap));
			setTotalFound((prev) => prev + newCount);
		};

		// radio() only yields non-empty chunks, so a scan with zero matches (or
		// one that's already caught up) would never update status via the loop
		// below alone — poll isFullyScanned()/the "stuck?" check separately.
		// Skipped once we're not actively 'scanning' so a manual pause/cancel
		// isn't raced back to 'caught-up' by a fullyScanned check that was
		// already true before the pause.
		const statusInterval = setInterval(() => {
			flush();
			setElapsedMs(Date.now() - (startedAtRef.current ?? Date.now()));
			if (statusRef.current === 'scanning') {
				setIsTakingAWhile(Date.now() - lastChunkAt >= takingAWhileMs);
				void cursor.isFullyScanned().then((done) => {
					if (!controller.signal.aborted && done) setStatus('caught-up');
				});
			}
		}, statusPollMs);

		(async () => {
			try {
				for await (const chunk of radio(cursor, {
					pollIntervalMs,
					yieldEveryMs,
					signal: controller.signal,
				})) {
					if (controller.signal.aborted) break;
					pendingLogsRef.current = [...chunk, ...pendingLogsRef.current].slice(0, logCap);
					pendingCountRef.current += chunk.length;
					lastChunkAt = Date.now();
					setIsTakingAWhile(false);
				}
				flush();
			} catch (e) {
				if (!controller.signal.aborted) {
					flush();
					setError(e instanceof Error ? e : new Error(String(e)));
					setStatus('error');
				}
			}
		})();

		return () => {
			controller.abort();
			clearInterval(statusInterval);
		};
	}, [cursor, generation, pollIntervalMs, yieldEveryMs, logCap, takingAWhileMs, statusPollMs]);

	const pause = useCallback(() => {
		if (statusRef.current === 'cancelled') return;
		controllerRef.current?.abort();
		setStatus('paused');
	}, []);

	// Bumping `generation` re-runs the streaming effect above against the
	// *same* `cursor` (and therefore the same store) — see the module comment
	// for why that's enough to continue rather than restart from scratch.
	const resume = useCallback(() => {
		if (statusRef.current === 'cancelled') return;
		setGeneration((g) => g + 1);
	}, []);

	const cancel = useCallback(() => {
		controllerRef.current?.abort();
		setStatus('cancelled');
	}, []);

	return {
		status,
		logs,
		totalFound,
		isTakingAWhile,
		elapsedMs,
		error,
		pause,
		resume,
		cancel,
		cursor,
	};
};
