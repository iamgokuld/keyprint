// node test_secret.js — password rules and salted hashes (KP-SECRET block in index.html), with Node's Web Crypto.
'use strict';
const { webcrypto } = require('crypto');
const { load, check, done } = require('./test_util');
const { KPS } = load('KP-SECRET');

const rules = (p) => { const c = KPS.checkPassword(p); return [c.rules.len, c.rules.upper, c.rules.number, c.rules.special].map(Number).join(''); };

console.log('Password rules: 8+ characters, a capital, a number, a special character');
check('empty: nothing met', rules('') === '0000' && !KPS.checkPassword('').ok);
check('"Abcdef1!" passes', KPS.checkPassword('Abcdef1!').ok && rules('Abcdef1!') === '1111');
check('7 characters fails on length only', !KPS.checkPassword('Abcde1!').ok && rules('Abcde1!') === '0111');
check('no capital fails', !KPS.checkPassword('abcdef1!').ok && rules('abcdef1!') === '1011');
check('no number fails', !KPS.checkPassword('Abcdefg!').ok && rules('Abcdefg!') === '1101');
check('no special fails', !KPS.checkPassword('Abcdefg1').ok && rules('Abcdefg1') === '1110');
check('a space is not a special character', rules('Abcdef 1') === '1110');
check('every ASCII symbol counts as special', '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'.split('').every((s) => KPS.checkPassword('Abcdef1' + s).ok));
const ue = KPS.checkPassword('Abcdef1!é');
check('non-keyboard character refused and named', !ue.ok && ue.badChar === 'é');
check('over 64 characters refused', !KPS.checkPassword('Aa1!' + 'x'.repeat(61)).ok && KPS.checkPassword('Aa1!' + 'x'.repeat(60)).ok);

console.log('Answers ignore case and spacing');
check('normalise', KPS.normalizeAnswer('  Blue   CAR ') === 'blue car' && KPS.normalizeAnswer(null) === '');

(async () => {
  console.log('Salted PBKDF2 hashes');
  const known = await KPS.hash(webcrypto, 'password', '73616c74', 1);   // RFC 6070-style vector: P="password", S="salt", c=1, SHA-256
  check('PBKDF2-SHA-256 matches the published test vector', known === '120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b', known);
  const acct = await KPS.makeAccount(webcrypto, 'Abcdef1!', '  First bike? ', 'Blue Car');
  check('account shape is valid', KPS.isAccount(acct) && acct.iterations === KPS.ITERATIONS && acct.question === 'First bike?');
  const json = JSON.stringify(acct);
  check('password and answer are not stored in plain text', !json.includes('Abcdef1!') && !/blue car/i.test(json));
  check('different random salts for password and answer', acct.pwSalt !== acct.ansSalt && acct.pwSalt.length === 32);
  check('right password accepted', await KPS.checkTyped(webcrypto, acct, 'Abcdef1!'));
  check('wrong password refused (case matters)', !(await KPS.checkTyped(webcrypto, acct, 'abcdef1!')));
  check('answer accepted with other case and spacing', await KPS.checkAnswer(webcrypto, acct, ' blue  car'));
  check('wrong answer refused', !(await KPS.checkAnswer(webcrypto, acct, 'red car')));
  const again = await KPS.makeAccount(webcrypto, 'Abcdef1!', 'q?', 'a');
  check('same password, new salt -> different hash', again.pwHash !== acct.pwHash);
  check('isAccount rejects junk', !KPS.isAccount(null) && !KPS.isAccount({ v: 1 }) && !KPS.isAccount(Object.assign({}, acct, { pwHash: 'zz' })));
  done();
})();
