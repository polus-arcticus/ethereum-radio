import {describe, it} from 'node:test';
import {expect} from 'earl';
import {
	recordCheckpoint,
	findCheckpoint,
	removeCheckpointsFrom,
} from '../../src/core/checkpoints.ts';

describe('recordCheckpoint / findCheckpoint', () => {
	it('finds nothing in an empty list', () => {
		expect(findCheckpoint([], 100n)).toEqual(undefined);
	});

	it('inserts a checkpoint and finds it by block number', () => {
		const checkpoints = recordCheckpoint([], {blockNumber: 100n, hash: '0xa'});
		expect(findCheckpoint(checkpoints, 100n)).toEqual({
			blockNumber: 100n,
			hash: '0xa',
		});
	});

	it('replaces an existing checkpoint at the same block number', () => {
		const checkpoints = recordCheckpoint(
			[{blockNumber: 100n, hash: '0xa'}],
			{blockNumber: 100n, hash: '0xb'},
		);
		expect(checkpoints).toEqual([{blockNumber: 100n, hash: '0xb'}]);
	});

	it('keeps the list sorted by blockNumber regardless of insertion order', () => {
		const checkpoints = recordCheckpoint(
			[{blockNumber: 300n, hash: '0xc'}],
			{blockNumber: 100n, hash: '0xa'},
		);
		expect(checkpoints).toEqual([
			{blockNumber: 100n, hash: '0xa'},
			{blockNumber: 300n, hash: '0xc'},
		]);
	});
});

describe('removeCheckpointsFrom', () => {
	it('drops checkpoints at or above the given block, keeping ones below it', () => {
		const checkpoints = [
			{blockNumber: 100n, hash: '0xa'},
			{blockNumber: 200n, hash: '0xb'},
			{blockNumber: 300n, hash: '0xc'},
		];
		expect(removeCheckpointsFrom(checkpoints, 200n)).toEqual([
			{blockNumber: 100n, hash: '0xa'},
		]);
	});
});
