import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { headcount, money, share, formFields, fitInput, officeFor, fitPlan, sensitivity, breakEven, KEPT_LINES, MAX_HEADS, MAX_ADDED, MAX_MONEY } from '../src/adopt.mjs';
import { plan, transition, payback } from '../src/office.mjs';

const read = (p) => JSON.parse(readFileSync(new URL('../' + p, import.meta.url), 'utf8'));
const OFFICE = read('data/office.json'), BASIS = read('data/basis.json');
const SNAPSHOT = JSON.stringify(OFFICE);
const defaults = () => ({ departments: OFFICE.departments.map((d) => ({ id: d.id, today: d.today })), leadership: OFFICE.leadership.today });
const roles = (o) => o.retained.map((r) => r.role);

test('the model office, entered as it is, gives back exactly the white paper’s comparison', () => {
  const ref = plan(OFFICE, BASIS);
  for (const input of [defaults(), {}, { departments: [] }, 'x', null]) {
    const r = officeFor(input, OFFICE);
    assert.equal(r.ok, true);
    assert.equal(r.added, 0);
    assert.equal(r.why, '');
    assert.deepEqual(r.office, OFFICE);
    assert.deepEqual(plan(r.office, BASIS), ref);
  }
  const f = fitPlan(defaults(), OFFICE, BASIS);
  assert.equal(f.ok, true);
  assert.deepEqual(f.plan, ref);
  assert.equal(Math.round(f.plan.today.total), Math.round(ref.today.total));
  assert.equal(Math.round(f.plan.assisted.total), Math.round(ref.assisted.total));
  assert.equal(Math.round(f.plan.sovereign.total), Math.round(ref.sovereign.total));
  assert.equal(Math.round(f.plan.saving), Math.round(ref.saving));
  assert.equal(f.plan.today.headcount, 50);
  assert.equal(f.plan.sovereign.headcount, 5);
  assert.equal(f.plan.human.fits, true);
  assert.equal(JSON.stringify(OFFICE), SNAPSHOT, 'the model is never written to');
});

test('your headcount, recomputed — and the AI-native team grows only when the human remainder would not fit', () => {
  const r = officeFor({ departments: [{ id: 'service', today: 20 }] }, OFFICE);
  assert.equal(r.ok, true);
  assert.equal(r.added, 1);
  assert.deepEqual(roles(r.office), [...roles(OFFICE), 'Revenue lead (AI-native)']);
  const p = plan(r.office, BASIS);
  assert.equal(p.today.headcount, 60);
  assert.equal(p.sovereign.headcount, 6);
  assert.equal(p.human.fits, true);
  assert.equal(p.human.remainderFte.toFixed(6), '5.500000');
  assert.equal(p.human.capacityFte, 5.5);
  // the exact edge: 45 people's remainder (4.5 FTE) fits the model's five; the 46th person's does not
  const edge = officeFor({ departments: [{ id: 'service', today: 11 }] }, OFFICE);
  assert.equal(edge.added, 1);
  assert.equal(plan(edge.office, BASIS).human.fits, true);
  assert.equal(plan({ ...OFFICE, departments: OFFICE.departments.map((d) => (d.id === 'service' ? { ...d, today: 11 } : d)) }, BASIS).human.fits, false, 'without the extra lead it would not fit');

  const big = officeFor({ departments: [{ id: 'service', today: 200 }] }, OFFICE);
  assert.equal(big.added, 19);
  assert.equal(roles(big.office).filter((x) => x === 'Revenue lead (AI-native)').length, 20);
  assert.equal(plan(big.office, BASIS).human.fits, true);
  // spread over the departments: each new lead goes where the remainder per person is highest
  const wide = officeFor({ departments: [{ id: 'service', today: 30 }, { id: 'finance', today: 40 }, { id: 'people', today: 30 }] }, OFFICE);
  assert.equal(wide.ok, true);
  // remainders: revenue (30+8+5)×0.1 = 4.3, finance and people (40+30)×0.1 = 7.0, ops 0.8, IT 0.3; need 12.4 against 4.5 → eight more,
  // each to the highest remainder per person: F 7.0, R 4.3, F 3.5, F 2.33, R 2.15, F 1.75, R 1.43, F 1.4
  const [F, R] = ['Finance and people lead (AI-native)', 'Revenue lead (AI-native)'];
  assert.equal(wide.added, 8);
  assert.deepEqual(roles(wide.office).slice(5), [F, R, F, F, R, F, R, F]);
  assert.equal(plan(wide.office, BASIS).human.fits, true);
  // leadership is today's cost only
  const lead = officeFor({ leadership: 12 }, OFFICE);
  assert.equal(plan(lead.office, BASIS).today.headcount, 57);
  assert.equal(plan(lead.office, BASIS).sovereign.headcount, 5);
  assert.equal(lead.office.leadership.today, 12);
  assert.deepEqual(lead.office.leadership.seats, ['crm']);
  assert.deepEqual(officeFor({ leadership: '3' }, { ...OFFICE, leadership: undefined }).office.leadership, { today: 3 });
  // a department you leave out keeps the model's number
  assert.equal(officeFor({ departments: [{ id: 'it', today: 0 }] }, OFFICE).office.departments.find((d) => d.id === 'service').today, 10);
  assert.equal(officeFor({ departments: [{ id: 'it', today: 0 }] }, OFFICE).office.departments.find((d) => d.id === 'it').today, 0);
  assert.equal(JSON.stringify(OFFICE), SNAPSHOT);
});

test('the AI share is plan()’s own: whatever the model says, the sized team always fits', () => {
  for (const aiShare of [0.8, 0.5, 0.95, 1, 7, -1, 0, 'x', NaN, undefined]) {
    const r = officeFor({}, { ...OFFICE, aiShare });
    assert.equal(r.ok, true, String(aiShare));
    assert.equal(plan(r.office, BASIS).human.fits, true, String(aiShare));
  }
  assert.equal(officeFor({}, { ...OFFICE, aiShare: 7 }).added, 0);
  assert.equal(officeFor({}, { ...OFFICE, aiShare: -1 }).added, 41);
  assert.equal(officeFor({}, { ...OFFICE, aiShare: 'x' }).added, 0);
  assert.equal(officeFor({}, { ...OFFICE, aiShare: 0.8 }).added, 5);
  // a share, a headcount or an oversight that is not a finite number counts as plan() counts it — the default share, no people, no time
  const twenty = { departments: [{ id: 'service', today: 20 }] };
  for (const aiShare of [NaN, Infinity, -Infinity, '0.5']) assert.equal(officeFor(twenty, { ...OFFICE, aiShare }).added, 1, String(aiShare));
  const inf = officeFor({}, { aiShare: 0.9, departments: [{ id: 'a', today: 30 }, { id: 'b', today: Infinity }], retained: [{ role: 'RI', covers: ['a'], oversight: Infinity }, { role: 'R1', covers: ['a'], oversight: 1 }] });
  assert.deepEqual(roles(inf.office), ['RI', 'R1', 'R1', 'R1']);
  assert.equal(plan(inf.office, BASIS).human.fits, true);
});

test('who gets the extra lead: the highest remainder per person; a tie goes to the role listed first', () => {
  const mk = (depts, retained) => ({ aiShare: 0.9, departments: depts, retained });
  const tie = officeFor({}, mk([{ id: 'a', today: 15 }, { id: 'b', today: 15 }], [{ role: 'R1', covers: ['a'], oversight: 1 }, { role: 'R2', covers: ['b'], oversight: 1 }]));
  assert.deepEqual(roles(tie.office), ['R1', 'R2', 'R1']);
  const two = officeFor({}, mk([{ id: 'a', today: 15 }, { id: 'b', today: 16 }], [{ role: 'R1', covers: ['a'], oversight: 1 }, { role: 'R2', covers: ['b'], oversight: 1 }]));
  assert.deepEqual(roles(two.office), ['R1', 'R2', 'R2', 'R1'], 'need 3.1 against 2: R2 first (1.6 > 1.5), then R1 (1.5 > 0.8)');
  // a department no role covers still gets leads — never the director, who oversees no department
  const unc = officeFor({}, mk([{ id: 'a', today: 30 }, { id: 'b', today: 0 }], [{ role: 'MD', covers: [], oversight: 0.5 }, { role: 'R1', covers: ['b'], oversight: 1 }]));
  assert.deepEqual(roles(unc.office), ['MD', 'R1', 'R1', 'R1']);
  assert.equal(unc.added, 2);
  // a role with no oversight time is never the one added
  const zero = officeFor({}, mk([{ id: 'a', today: 30 }], [{ role: 'R0', covers: ['a'], oversight: 0 }, { role: 'R1', covers: ['a'], oversight: 1 }]));
  assert.deepEqual(roles(zero.office), ['R0', 'R1', 'R1', 'R1']);
  // a role covering a department the model does not have adds nothing to its load
  const ghost = officeFor({}, mk([{ id: 'a', today: 20 }], [{ role: 'G', covers: ['nope'], oversight: 1 }, { role: 'R1', covers: ['a'], oversight: 1 }]));
  assert.deepEqual(roles(ghost.office), ['G', 'R1']);
  // no role oversees anything: nothing can be added, and plan() says it does not fit
  const none = officeFor({}, mk([{ id: 'a', today: 50 }], [{ role: 'MD', covers: [], oversight: 0.5 }]));
  assert.equal(none.added, 0);
  assert.equal(plan(none.office, BASIS).human.fits, false);
  // the ceiling: a model whose leads oversee almost nothing stops at MAX_ADDED, and says it does not fit
  const cap = officeFor({}, mk([{ id: 'a', today: MAX_HEADS }], [{ role: 'R', covers: ['a'], oversight: 0.001 }]));
  assert.equal(cap.added, MAX_ADDED);
  assert.equal(cap.office.retained.length, MAX_ADDED + 1);
  assert.equal(plan(cap.office, BASIS).human.fits, false);
});

test('refusals name the problem; nothing half-applied', () => {
  const why = (input, ...base) => { const r = officeFor(input, base.length ? base[0] : OFFICE); assert.equal(r.ok, false); assert.equal(r.office, null); assert.equal(r.added, 0); return r.why; };
  assert.equal(why({ departments: [{ id: 'canteen', today: 3 }] }), 'there is no department called canteen');
  assert.equal(why({ departments: [{ id: 7, today: 3 }] }), 'there is no department called 7');
  assert.equal(why({ departments: [null] }), 'there is no department called undefined');
  assert.equal(why({ departments: ['service'] }), 'there is no department called undefined');
  assert.equal(why({ departments: [{ id: 'service', today: 3 }, { id: 'service', today: 4 }] }), 'the service department was given twice');
  for (const bad of [-1, 1.5, '1.5', '', ' ', '1e3', '0x10', NaN, Infinity, MAX_HEADS + 1, '99999', true, null, undefined, [5], {}])
    assert.equal(why({ departments: [{ id: 'sales', today: bad }] }), 'the headcount for Sales and business development must be a whole number from 0 to 10000', String(bad));
  assert.equal(why({ departments: [{ id: 'x2', today: 'q' }] }, { departments: [{ id: 'x2' }], retained: [] }), 'the headcount for x2 must be a whole number from 0 to 10000', 'a department with no name is named by its id');
  assert.equal(why({ leadership: -2 }), 'the leadership headcount must be a whole number from 0 to 10000');
  assert.equal(why({ leadership: undefined }), 'the leadership headcount must be a whole number from 0 to 10000');
  for (const base of [null, undefined, 'office', 5, [], {}, { departments: [] }, { retained: [] }, { departments: 'x', retained: [] }, { departments: [], retained: 'x' }])
    assert.equal(why({}, base), 'the modelled office is missing', JSON.stringify(base) ?? String(base));
  const circular = { departments: [], retained: [] };
  circular.self = circular;
  assert.equal(why({}, circular), 'the input could not be read');
  assert.equal(why({ get departments() { throw new Error('boom'); } }), 'the input could not be read');
  assert.equal(JSON.stringify(OFFICE), SNAPSHOT);
  const f = fitPlan({ departments: [{ id: 'canteen', today: 1 }] }, OFFICE, BASIS);
  assert.deepEqual(f, { ok: false, why: 'there is no department called canteen', office: null, added: 0, plan: null, transition: null, payback: null });
});

test('headcount: a whole number from 0 to MAX_HEADS, as a number or digits', () => {
  for (const [x, want] of [[0, 0], [7, 7], [MAX_HEADS, MAX_HEADS], ['12', 12], [' 7 ', 7], ['0', 0], ['10000', 10000]]) assert.equal(headcount(x), want, String(x));
  for (const x of [MAX_HEADS + 1, -1, 1.5, NaN, Infinity, '10001', '99999', '123456', '-3', '1.0', '1e3', '0x1f', '', '  ', 'seven', true, false, null, undefined, [3], { valueOf: () => 3 }, 3n, Symbol('s'), () => 3])
    assert.equal(headcount(x), null, String(typeof x === 'symbol' ? 'symbol' : x));
});

test('the form: one field per department in the model’s order, the kept lines, then leadership; what it sends back', () => {
  const f = formFields(OFFICE);
  assert.deepEqual(f.map((x) => x.id), [...OFFICE.departments.map((d) => d.id), 'clients', 'field', 'leadership']);
  assert.deepEqual(f.filter((x) => x.kept).map((x) => [x.id, x.value, x.label]), KEPT_LINES.map((k) => [k.id, 0, k.name]));
  // a model that already has a kept line by that id does not get it twice
  assert.deepEqual(formFields({ departments: [{ id: 'field', today: 4, name: 'Our engineers' }] }).map((x) => x.id), ['field', 'clients', 'leadership']);
  assert.deepEqual(f[0], { id: 'service', label: 'Customer service', value: 10, work: OFFICE.departments[0].work });
  assert.deepEqual(f.at(-1), { id: 'leadership', label: 'Leadership', value: 5, work: 'Direction, decisions, relationships' });
  assert.deepEqual(formFields({ departments: [{ id: 'a', today: -3 }, { id: 'b', today: 'x', name: 'B' }] }).slice(0, 2), [{ id: 'a', label: 'a', value: 0, work: '' }, { id: 'b', label: 'B', value: 0, work: '' }]);
  assert.equal(formFields({ departments: [] }).at(-1).value, 0);
  for (const j of [null, undefined, {}, 'x', 7]) assert.deepEqual(formFields(j), []);
  // what the form sends → officeFor's input
  assert.deepEqual(fitInput([{ id: 'service', value: '12' }, { id: 'leadership', value: '4' }, null, 'x', 7, { id: 'it', value: 2 }]),
    { departments: [{ id: 'service', today: '12' }, { id: 'it', today: 2 }], leadership: '4' });
  assert.deepEqual(fitInput([]), { departments: [] });
  for (const j of [null, undefined, 'x', {}, 3]) assert.deepEqual(fitInput(j), { departments: [] });
  assert.deepEqual(fitInput([{ get id() { throw new Error('boom'); } }]), { departments: [] });
  // the round trip a visitor makes: form → input → office → plan
  const sent = formFields(OFFICE).map((x) => ({ id: x.id, value: String(x.value) }));
  assert.deepEqual(fitPlan(fitInput(sent), OFFICE, BASIS).plan, plan(OFFICE, BASIS));
});

test('fuzz: no export throws on junk', () => {
  const toxic = { get departments() { throw new Error('boom'); }, get retained() { throw new Error('boom'); }, get id() { throw new Error('boom'); }, get leadership() { throw new Error('boom'); } };
  const JUNK = [undefined, null, 0, NaN, '', 'x', [], {}, [null], toxic, 1n, () => 1, Symbol('s'), [toxic], { departments: [toxic] }];
  for (const a of JUNK) for (const b of [...JUNK, OFFICE]) {
    assert.doesNotThrow(() => headcount(a));
    assert.doesNotThrow(() => formFields(a));
    assert.doesNotThrow(() => fitInput(a));
    assert.doesNotThrow(() => officeFor(a, b));
    assert.doesNotThrow(() => fitPlan(a, b, BASIS));
    assert.doesNotThrow(() => fitPlan(a, OFFICE, b));
    const r = officeFor(a, b);
    assert.equal(typeof r.ok, 'boolean');
    assert.equal(r.ok ? typeof r.office : r.office, r.ok ? 'object' : null);
  }
});

test('money and share: what a visitor types', () => {
  for (const [x, want] of [[45000, 45000], ['45000', 45000], ['£45,000', 45000], [' £ 45,000.50 ', 45000.5], ['45k', 45000], ['7m', 7e6], ['7.5m', 7.5e6], ['1,234,567', 1234567], ['0', 0], [0, 0], [MAX_MONEY, MAX_MONEY], ['18M', 18e6], ['45K', 45000]])
    assert.equal(money(x), want, String(x));
  for (const x of [-1, MAX_MONEY + 1, '1001m', NaN, Infinity, '', 'abc', '45,00', '4,5000', '£', '1.234', '1e6', '-5', '12 000', true, null, undefined, [5], {}])
    assert.equal(money(x), null, String(x));
  for (const [x, want] of [[0.82, 0.82], [0, 0], [1, 1], ['82', 0.82], ['82%', 0.82], [' 100 ', 1], ['0', 0], ['82.5', 0.825]]) assert.equal(share(x), want, String(x));
  for (const x of [1.01, -0.1, '101', '-5', 'x', '', NaN, Infinity, null, true, '1000', [0.5]]) assert.equal(share(x), null, String(x));
});

test('fitInput: dotted fields merge into one department; the office’s own fields go to the top', () => {
  assert.deepEqual(fitInput([{ id: 'service', value: '12' }, { id: 'service.pay', value: '£40,000' }, { id: 'sales.share', value: '70' }, { id: 'service.share', value: '80' },
    { id: 'aiShare', value: '85' }, { id: 'software', value: '30k' }, { id: 'setup', value: '20000' }, { id: 'leadership.pay', value: '90k' }, { id: 'field', value: '17' }]),
    { departments: [{ id: 'service', today: '12', payYear: '£40,000', aiShare: '80' }, { id: 'sales', aiShare: '70' }, { id: 'field', today: '17' }],
      aiShare: '85', softwarePerYear: '30k', setupCost: '20000', leadershipPay: '90k' });
  assert.deepEqual(fitInput([{ id: 'x.y.z', value: 1 }]), { departments: [{ id: 'x', today: 1 }] });   // an unknown field is a headcount
  assert.deepEqual(fitInput([{ id: 7, value: 2 }]), { departments: [{ id: 7, today: 2 }] });            // a non-string id is kept as given (officeFor refuses it)
});

test('kept lines join the office and stay on the AI-native payroll; per-line cost and share; the office’s own numbers', () => {
  const ref = plan(OFFICE, BASIS);
  const k = fitPlan({ departments: [{ id: 'field', today: '17' }, { id: 'clients', today: 0 }] }, OFFICE, BASIS);
  assert.equal(k.ok, true);
  assert.equal(k.office.departments.length, OFFICE.departments.length + 1, 'an empty kept line is not added');
  const f = k.office.departments.at(-1);
  assert.deepEqual([f.id, f.today, f.kept, f.seats], ['field', 17, true, []]);
  assert.equal(k.plan.sovereign.headcount, 5 + 17);
  assert.equal(k.added, 0, 'kept people are not in the remainder, so no extra lead');
  assert.equal(Math.round(k.plan.saving), Math.round(ref.saving));
  assert.equal(k.transition.leavers, 45, 'the kept do not leave');
  // a kept line given twice, or with a bad headcount
  assert.equal(officeFor({ departments: [{ id: 'field', today: 1 }, { id: 'field', today: 2 }] }, OFFICE).why, 'the field department was given twice');
  assert.equal(officeFor({ departments: [{ id: 'field', today: -1 }] }, OFFICE).why, 'the headcount for Engineers and staff on site (kept) must be a whole number from 0 to 10000');
  assert.equal(officeFor({ departments: [{ id: 'field' }] }, OFFICE).ok, true, 'a kept line with no headcount is simply empty');
  // per-line cost and share; a line given only its cost keeps the model's headcount
  const c = fitPlan({ departments: [{ id: 'finance', payYear: '60k' }, { id: 'service', aiShare: '50' }] }, OFFICE, BASIS);
  assert.equal(c.office.departments.find((d) => d.id === 'finance').today, 5);
  assert.equal(c.office.departments.find((d) => d.id === 'finance').payYear, 60000);
  assert.equal(c.office.departments.find((d) => d.id === 'service').aiShare, 0.5);
  assert.ok(c.added > 0, 'service at 50% leaves more for people: the team grows');
  assert.equal(c.plan.human.fits, true);
  assert.equal(officeFor({ departments: [{ id: 'finance', payYear: 'lots' }] }, OFFICE).why, 'the cost per person for Finance and accounts must be an amount in pounds from 0 to £1,000,000,000');
  assert.equal(officeFor({ departments: [{ id: 'finance', aiShare: '120' }] }, OFFICE).why, 'the share of Finance and accounts’s work done by agents must be from 0% to 100%');
  assert.equal(officeFor({ departments: [{ id: 'finance', today: undefined }] }, OFFICE).why, 'the headcount for Finance and accounts must be a whole number from 0 to 10000');
  // the office’s own numbers
  const o = fitPlan({ aiShare: '80', softwarePerYear: '£30,000', setupCost: '20k', leadershipPay: '90000' }, OFFICE, BASIS);
  assert.equal(o.office.aiShare, 0.8);
  assert.equal(o.office.softwarePerYear, 30000);
  assert.equal(o.office.setupCost, 20000);
  assert.equal(o.office.leadership.payYear, 90000);
  assert.equal(o.plan.today.seatsYear1, 30000);
  assert.equal(o.plan.sovereign.setup, 20000);
  assert.equal(o.added, 5);                                                     // as officeFor({}, {aiShare: 0.8}) says
  assert.deepEqual(officeFor({ leadershipPay: 1 }, { ...OFFICE, leadership: undefined }).office.leadership, { payYear: 1 });
  assert.deepEqual(officeFor({ leadershipPay: 1 }, OFFICE).office.leadership, { ...OFFICE.leadership, payYear: 1 }, 'the leaders are still there');
  // a model that already has a line by a kept id keeps its own (and its name in a refusal)
  const own = { ...OFFICE, departments: [...OFFICE.departments, { id: 'field', name: 'Our engineers', today: 4 }] };
  assert.equal(officeFor({ departments: [{ id: 'field', today: 'x' }] }, own).why, 'the headcount for Our engineers must be a whole number from 0 to 10000');
  assert.equal(officeFor({ departments: [{ id: 'field', today: 6 }] }, own).office.departments.at(-1).today, 6);
  assert.equal(officeFor({ departments: [{ id: 'field', today: 6 }] }, own).office.departments.at(-1).kept, undefined);
  for (const [k, why] of [['aiShare', 'the share of the work done by agents must be from 0% to 100%'], ['softwarePerYear', 'the software bill per year must be an amount in pounds from 0 to £1,000,000,000'],
    ['setupCost', 'the roll-out cost must be an amount in pounds from 0 to £1,000,000,000'], ['leadershipPay', 'the cost per leader must be an amount in pounds from 0 to £1,000,000,000']])
    assert.equal(officeFor({ [k]: 'nope' }, OFFICE).why, why);
  // fitPlan carries the transition and the payback, computed by office.mjs
  const fp = fitPlan({}, OFFICE, BASIS);
  assert.deepEqual(fp.transition, transition(ref, OFFICE, BASIS));
  assert.deepEqual(fp.payback, payback(ref, transition(ref, OFFICE, BASIS), BASIS));
  assert.equal(JSON.stringify(OFFICE), SNAPSHOT);
});

test('sensitivity: the saving at 50/70/90% re-sizes the team; break-even is where the net saving crosses zero', () => {
  const rows = sensitivity({}, OFFICE, BASIS);
  assert.deepEqual(rows.map((r) => r.share), [0.5, 0.7, 0.9]);
  assert.ok(rows.every((r) => r.ok));
  assert.ok(rows[0].team > rows[1].team && rows[1].team > rows[2].team, 'less automation needs more people: ' + rows.map((r) => r.team));
  assert.ok(rows[0].net < rows[1].net && rows[1].net < rows[2].net);
  assert.equal(rows[2].team, 5);
  assert.equal(Math.round(rows[2].saving), Math.round(plan(OFFICE, BASIS).saving));
  const f = fitPlan({}, OFFICE, BASIS);
  assert.equal(Math.round(rows[2].net), Math.round(f.payback.net));
  assert.equal(rows[2].paybackMonths, f.payback.paybackMonths);
  assert.equal(rows[2].npv, f.payback.npv);
  assert.equal(rows[2].transition, f.transition.total);
  assert.equal(rows[2].today, f.plan.today.total);
  assert.equal(rows[2].sovereign, f.plan.sovereign.total);
  // a per-line share is replaced by the row's share
  const one = sensitivity({ departments: [{ id: 'service', aiShare: '10' }] }, OFFICE, BASIS, [0.9]);
  assert.equal(Math.round(one[0].saving), Math.round(rows[2].saving));
  assert.deepEqual(sensitivity({ departments: [{ id: 'canteen', today: 1 }] }, OFFICE, BASIS, [0.5]), [{ share: 0.5, ok: false, why: 'there is no department called canteen' }]);
  assert.deepEqual(sensitivity({}, OFFICE, BASIS, []), []);
  assert.deepEqual(sensitivity(null, OFFICE, BASIS).map((r) => [r.share, r.ok, r.team]), rows.map((r) => [r.share, r.ok, r.team]), 'no input is the model office');
  assert.deepEqual(sensitivity({ departments: [null] }, OFFICE, BASIS, [0.5]), [{ share: 0.5, ok: false, why: 'there is no department called undefined' }]);
  assert.deepEqual(breakEven(null, OFFICE, BASIS), breakEven({}, OFFICE, BASIS));
  // break-even: the share where the five-year net saving is zero
  const be = breakEven({}, OFFICE, BASIS);
  assert.equal(be.ok, true);
  assert.equal(be.alwaysPays, false);
  assert.ok(be.share > 0 && be.share < 0.9, String(be.share));
  const at = (s) => fitPlan({ aiShare: s }, OFFICE, BASIS).payback.net;
  assert.ok(at(be.share) >= 0, 'at break-even it pays: ' + at(be.share));
  assert.ok(at(be.share - 0.002) < 0, 'just below it does not');
  // a business that never pays: everyone kept but one person — and one that pays even with no automation
  const never = breakEven({ departments: OFFICE.departments.map((d) => ({ id: d.id, today: 0 })).concat([{ id: 'sales', today: 0 }].slice(1)), leadership: 1 }, OFFICE, BASIS);
  assert.deepEqual(never, { ok: true, share: null, alwaysPays: false });
  const cheap = { ...OFFICE, retained: [{ role: 'R', covers: ['service'], oversight: 1000 }], setupDays: 0 };
  assert.deepEqual(breakEven({}, cheap, BASIS), { ok: true, share: 0, alwaysPays: true });
  assert.deepEqual(breakEven({ departments: [{ id: 'canteen' }] }, OFFICE, BASIS), { ok: false, share: null, alwaysPays: false });
});

test('fuzz: the new exports never throw', () => {
  const toxic = { get departments() { throw new Error('boom'); }, get aiShare() { throw new Error('boom'); } };
  for (const j of [undefined, null, 0, NaN, '', 'x', [], {}, [null], toxic, 1n, () => 1, Symbol('s'), { departments: [toxic] }, { departments: 'x' }]) {
    assert.doesNotThrow(() => money(j));
    assert.doesNotThrow(() => share(j));
    assert.doesNotThrow(() => sensitivity(j, OFFICE, BASIS));
    assert.doesNotThrow(() => sensitivity({}, j, BASIS, [0.5]));
    assert.doesNotThrow(() => sensitivity({}, OFFICE, BASIS, j));
    assert.doesNotThrow(() => breakEven(j, OFFICE, BASIS));
    assert.doesNotThrow(() => breakEven({}, j, BASIS));
  }
  assert.deepEqual(sensitivity(toxic, OFFICE, BASIS), []);
  assert.deepEqual(breakEven(toxic, OFFICE, BASIS), { ok: false, share: null, alwaysPays: false });
});
