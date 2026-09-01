import {deployScript, artifacts} from '../rocketh/deploy.js';

export default deployScript(
	async (env) => {
		const {deployer} = env.namedAccounts;
		await env.deploy('EventFixture', {
			account: deployer,
			artifact: artifacts.EventFixture,
			args: [],
		});
	},
	{tags: ['EventFixture', 'EventFixture_deploy']},
);
