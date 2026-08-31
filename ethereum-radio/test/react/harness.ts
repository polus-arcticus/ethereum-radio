import './dom-setup.ts';
import React from 'react';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';

// A minimal renderHook-style harness (no @testing-library/react) — a
// component calls the hook every render and stashes the latest result into a
// mutable box read back out after act() settles. Every act() call is the
// async form: useCursor's effects kick off real promises (mock provider
// calls), and only the async act() overload waits for those microtasks
// before flushing the resulting state updates.
export const renderHook = async <Args, Result>(
	hook: (args: Args) => Result,
	initialArgs: Args,
) => {
	const box: {current: Result | undefined} = {current: undefined};
	let latestArgs = initialArgs;

	function Harness() {
		box.current = hook(latestArgs);
		return null;
	}

	const container = document.createElement('div');
	document.body.appendChild(container);
	let root!: Root;

	await act(async () => {
		root = createRoot(container);
		root.render(React.createElement(Harness));
	});

	// Effects (including chained async ones inside useCursor) resolve over
	// several microtask/macrotask turns — flush repeatedly rather than once.
	const flush = async (rounds = 10) => {
		for (let i = 0; i < rounds; i++) {
			await act(async () => {
				await new Promise((resolve) => setTimeout(resolve, 0));
			});
		}
	};

	const rerender = async (args: Args) => {
		latestArgs = args;
		await act(async () => {
			root.render(React.createElement(Harness));
		});
	};

	const unmount = async () => {
		await act(async () => {
			root.unmount();
		});
	};

	// Runs a callback that triggers state updates (e.g. calling one of the
	// hook's returned action functions) inside act(), then flushes.
	const act_ = async <T>(callback: () => Promise<T>): Promise<T> => {
		let value!: T;
		await act(async () => {
			value = await callback();
		});
		await flush();
		return value;
	};

	return {
		get result() {
			return box.current!;
		},
		flush,
		rerender,
		unmount,
		act: act_,
	};
};
