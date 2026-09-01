import {describe, it} from 'node:test';
import {expect} from 'earl';
import {toPortable, fromPortable} from '../../src/core/json-bigint.ts';

describe('toPortable / fromPortable', () => {
	it('round-trips bigints inside nested arrays and objects', () => {
		const value = {
			spans: [
				{fromBlock: 100n, toBlock: 200n},
				{fromBlock: 300n, toBlock: 400n},
			],
			logs: [{blockNumber: 150n, logIndex: 0, address: '0xabc'}],
		};
		const portable = toPortable(value);
		expect(JSON.parse(JSON.stringify(portable))).toEqual(portable);
		expect(fromPortable(JSON.parse(JSON.stringify(portable)))).toEqual(value);
	});

	it('leaves non-bigint primitives untouched', () => {
		const value = {a: 1, b: 'text', c: true, d: null};
		expect(fromPortable(toPortable(value))).toEqual(value);
	});

	it('round-trips an empty array', () => {
		expect(fromPortable(toPortable([]))).toEqual([]);
	});
});
