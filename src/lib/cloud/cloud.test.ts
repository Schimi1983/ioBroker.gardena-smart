/* eslint-disable @typescript-eslint/require-await -- fakes implement async interfaces */
import { expect } from 'chai';
import { CloudAuthError, CloudClient, CloudQuotaError } from './cloud-client';
import { QuotaCounter, WEEKLY_LIMIT, WINDOW_MS } from './quota';

describe('QuotaCounter', () => {
	it('keeps a reserve for user commands', () => {
		const now = 5_000_000_000;
		const q = new QuotaCounter(() => now, 1000);
		q.load(JSON.stringify(Array<number>(899).fill(now - 1000)));
		expect(q.allowsPriority('background')).to.equal(true);
		q.add();
		expect(q.allowsPriority('background')).to.equal(false);
		expect(q.allowsPriority('command')).to.equal(true);
	});

	it('counts requests in a rolling 7 day window', () => {
		let now = 1_000_000;
		const q = new QuotaCounter(() => now);
		q.add();
		now += 1000;
		q.add();
		expect(q.summary().used).to.equal(2);
		expect(q.summary().remaining).to.equal(WEEKLY_LIMIT - 2);
		now += WINDOW_MS - 500;
		expect(q.summary().used).to.equal(1);
		now += 1000;
		expect(q.summary().used).to.equal(0);
	});

	it('restores from JSON, ignores garbage and warns at 80 %', () => {
		const now = 5_000_000_000;
		const q = new QuotaCounter(() => now);
		q.load('not json');
		expect(q.summary().used).to.equal(0);
		q.load(JSON.stringify([...Array<number>(800).fill(now - 1000), 'x', now - WINDOW_MS - 1]));
		const s = q.summary();
		expect(s.used).to.equal(800);
		expect(s.percent).to.equal(80);
		expect(s.warning).to.equal(true);
		expect(q.allows(200)).to.equal(true);
		expect(q.allows(201)).to.equal(false);
		q.reset();
		expect(q.summary().used).to.equal(0);
	});
});

function response(status: number, body: unknown, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body), { status, headers });
}

describe('CloudClient', () => {
	const location = {
		data: { id: 'loc1', type: 'LOCATION', attributes: { name: 'My Garden' } },
		included: [
			{ id: 'd1', type: 'DEVICE' },
			{
				id: 'd1',
				type: 'COMMON',
				attributes: {
					name: { value: 'Vorgarten' },
					serial: { value: '00247127' },
					modelType: { value: 'GARDENA smart Water Control' },
				},
			},
			{ id: 'd1', type: 'VALVE', attributes: {} },
		],
	};

	it('reads device names, reuses the token and counts only API requests', async () => {
		const calls: string[] = [];
		const quota = new QuotaCounter();
		const client = new CloudClient({
			appKey: 'key',
			appSecret: 'secret',
			quota,
			fetchFn: (async (url: string, init?: RequestInit) => {
				calls.push(`${init?.method} ${url}`);
				if (url.includes('oauth2/token')) {
					expect(init?.body as string).to.include('grant_type=client_credentials');
					return response(200, { access_token: 'tok', expires_in: 3600 });
				}
				expect((init?.headers as Record<string, string>)['X-Api-Key']).to.equal('key');
				expect((init?.headers as Record<string, string>).Authorization).to.equal('Bearer tok');
				return url.endsWith('/locations')
					? response(200, { data: [{ id: 'loc1', type: 'LOCATION' }] })
					: response(200, location);
			}) as typeof fetch,
		});
		const devices = await client.listDevices();
		expect(devices).to.deep.equal([
			{
				id: 'd1',
				name: 'Vorgarten',
				serial: '00247127',
				model: 'GARDENA smart Water Control',
				location: 'My Garden',
			},
		]);
		await client.listDevices();
		expect(calls.filter(c => c.includes('oauth2')).length).to.equal(1);
		expect(quota.summary().used).to.equal(4);
	});

	it('reports wrong credentials and rate limits', async () => {
		const bad = new CloudClient({
			appKey: 'k',
			appSecret: 's',
			quota: new QuotaCounter(),
			fetchFn: async () => response(401, {}),
		});
		await bad.listDevices().then(
			() => expect.fail('should fail'),
			err => expect(err).to.be.instanceOf(CloudAuthError),
		);

		const limited = new CloudClient({
			appKey: 'k',
			appSecret: 's',
			quota: new QuotaCounter(),
			fetchFn: (async (url: string) =>
				url.includes('oauth2')
					? response(200, { access_token: 't', expires_in: 3600 })
					: response(429, {}, { 'Retry-After': '120' })) as unknown as typeof fetch,
		});
		await limited.listDevices().then(
			() => expect.fail('should fail'),
			err => {
				expect(err).to.be.instanceOf(CloudQuotaError);
				expect((err as CloudQuotaError).retryAfterMs).to.equal(120_000);
			},
		);
	});

	it('does not send requests when the counted limit is reached', async () => {
		const quota = new QuotaCounter();
		quota.load(JSON.stringify(Array<number>(WEEKLY_LIMIT).fill(Date.now())));
		let fetched = false;
		const client = new CloudClient({
			appKey: 'k',
			appSecret: 's',
			quota,
			fetchFn: async () => {
				fetched = true;
				return response(200, {});
			},
		});
		await client.listDevices().catch(err => expect(err).to.be.instanceOf(CloudQuotaError));
		expect(fetched).to.equal(false);
	});
});
