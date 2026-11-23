import { expect } from 'chai';
import {
	decodeIntArray,
	decodeOpaqueText,
	decodeStringArray,
	deleteAtPath,
	encodeStringArray,
	fieldValue,
	instanceIds,
	mergeAtPath,
	parseFrame,
} from './protocol';

describe('protocol', () => {
	it('parses frames and skips broken messages', () => {
		expect(parseFrame('not json')).to.deep.equal([]);
		expect(parseFrame('{"a":1}')).to.deep.equal([]);
		const msgs = parseFrame('[null, 5, {"entity":{"path":"x"},"op":"update"}, {"request_id":"1","success":true}]');
		expect(msgs).to.have.length(2);
	});

	it('extracts values of all field types', () => {
		expect(fieldValue({ vb: false })).to.equal(false);
		expect(fieldValue({ vi: 0, ts: 1 })).to.equal(0);
		expect(fieldValue({ vf: 1.5 })).to.equal(1.5);
		expect(fieldValue({ vs: '' })).to.equal('');
		expect(fieldValue({ ai: ['0=1,1=-2'] })).to.equal('1,-2');
		expect(fieldValue({ ai: [0] })).to.equal('0');
		expect(fieldValue(undefined)).to.equal(null);
	});

	it('encodes and decodes arrays', () => {
		expect(decodeIntArray(['0=3,1=4'])).to.deep.equal([3, 4]);
		expect(decodeStringArray(["0='18',1='1800'"])).to.deep.equal(['18', '1800']);
		expect(encodeStringArray(['18', '1800'])).to.deep.equal(["0='18',1='1800'"]);
		expect(encodeStringArray(['18'])).to.deep.equal(["0='18'"]);
	});

	it('decodes opaque text (valve names)', () => {
		const b64 = Buffer.concat([Buffer.from('Rasen vorne', 'utf8'), Buffer.alloc(5)]).toString('base64');
		expect(decodeOpaqueText(b64)).to.equal('Rasen vorne');
	});

	it('merges partial updates and deletes', () => {
		const tree: Record<string, any> = { lemonbeat: { '0': { battery_level: { vi: 80, ts: 1 }, error: { vi: 0 } } } };
		mergeAtPath(tree, 'lemonbeat/0', { battery_level: { vi: 65, ts: 2 }, _urn: 'x' });
		expect(tree.lemonbeat['0'].battery_level).to.deep.equal({ vi: 65, ts: 2 });
		expect(tree.lemonbeat['0'].error).to.deep.equal({ vi: 0 });
		mergeAtPath(tree, 'actuator/1', { state: { vi: 2 } });
		expect(instanceIds(tree, 'actuator')).to.deep.equal(['1']);
		mergeAtPath(tree, 'lemonbeat/0', { error: { vi: 1 } }, true);
		expect(tree.lemonbeat['0'].battery_level).to.equal(undefined);
		deleteAtPath(tree, 'actuator/1');
		expect(instanceIds(tree, 'actuator')).to.deep.equal([]);
	});
});
