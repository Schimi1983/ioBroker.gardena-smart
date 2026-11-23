import { expect } from 'chai';
import { decodePause, decodeSchedules, encodePause, parseUtcOffset } from './schedule';

describe('schedule helpers (values recorded on a Water Control)', () => {
	it('parses the device time zone', () => {
		expect(parseUtcOffset('UTC+01:00')).to.equal(60);
		expect(parseUtcOffset('UTC-05:30')).to.equal(-330);
		expect(parseUtcOffset(undefined)).to.equal(0);
	});

	it('decodes a pause until a date in local device time', () => {
		// 24.11.2026 19:41 at UTC+01:00
		const p = decodePause('6gcLGBMp', 60);
		expect(p).to.deep.equal({ paused: true, until: Date.UTC(2026, 10, 24, 18, 41), permanent: false });
	});

	it('detects "permanently" and "not paused"', () => {
		expect(decodePause('9gcBEgEA', 60)?.permanent).to.equal(true);
		expect(decodePause('', 60)).to.deep.equal({ paused: false, until: 0, permanent: false });
	});

	it('encodes pauses like the GARDENA app', () => {
		expect(encodePause(Date.UTC(2026, 10, 24, 18, 41), 60)).to.equal('6gcLGBMp');
		expect(encodePause('permanent', 60)).to.equal('9gcBEgEA');
		expect(encodePause(0, 60)).to.equal('');
	});

	it('decodes the schedules', () => {
		expect(decodeSchedules('gH8HIwUAAIF/CAQjAAA=')).to.deep.equal([
			{ id: 0x80, days: 0x7f, start: '07:35', end: '07:40', minutes: 5 },
			{ id: 0x81, days: 0x7f, start: '08:04', end: '08:39', minutes: 35 },
		]);
		expect(decodeSchedules('')).to.deep.equal([]);
	});
});
