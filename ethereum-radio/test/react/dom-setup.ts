import {Window} from 'happy-dom';

// A minimal manual DOM wiring for testing a React hook with react-dom/client
// in plain Node — this happy-dom version doesn't ship a GlobalRegistrator
// convenience, so the handful of globals react-dom actually touches for a
// basic render+effects cycle are wired up by hand here instead of pulling in
// a full testing-library/jsdom stack.
const win = new Window();

const globals: Record<string, unknown> = {
	window: win,
	document: win.document,
	navigator: win.navigator,
	HTMLElement: win.HTMLElement,
	Node: win.Node,
	Event: win.Event,
	CustomEvent: win.CustomEvent,
	MutationObserver: win.MutationObserver,
};

for (const [key, value] of Object.entries(globals)) {
	Object.defineProperty(globalThis, key, {
		value,
		configurable: true,
		writable: true,
	});
}

(globalThis as any).requestAnimationFrame =
	(win as any).requestAnimationFrame?.bind(win) ??
	((cb: () => void) => setTimeout(cb, 0));
(globalThis as any).cancelAnimationFrame =
	(win as any).cancelAnimationFrame?.bind(win) ?? clearTimeout;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
