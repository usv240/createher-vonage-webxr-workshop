// Unit tests for the preview tour's narration sync.
//
// The boundary-event offset -> word-index mapping is the one piece of the preview that is easy
// to get subtly wrong (off-by-one at word starts, at the very end, on multiple spaces), and it
// is invisible when wrong: the highlight just drifts. So it lives in a pure function and is
// tested here rather than eyeballed in a headset.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// The static files are ES modules for the browser; load the one function under test without a
// bundler by evaluating the module source with its export stripped.
const src = fs.readFileSync(path.join(__dirname, '../static/StoryListener.js'), 'utf8');
const body = src.slice(src.indexOf('export function wordIndexAtChar')).replace('export function', 'function');
const wordIndexAtChar = new Function(`${body}; return wordIndexAtChar;`)();

const story = JSON.parse(fs.readFileSync(path.join(__dirname, '../static/story.json'), 'utf8'));

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`ok    ${name}`);
  } catch (e) {
    failures++;
    console.log(`FAIL  ${name}\n        ${e.message}`);
  }
}

const T = 'Once upon a time, in a cozy cave';

check('offset 0 is inside the first word', () => assert.strictEqual(wordIndexAtChar(T, 0), 1));
check('offset at the start of word 2 counts 2', () => assert.strictEqual(wordIndexAtChar(T, T.indexOf('upon')), 2));
check('offset on the space before word 2 counts 1', () => assert.strictEqual(wordIndexAtChar(T, T.indexOf('upon') - 1), 1));
check('offset mid-word does not advance', () => assert.strictEqual(wordIndexAtChar(T, T.indexOf('upon') + 2), 2));
check('offset past the end counts every word', () => assert.strictEqual(wordIndexAtChar(T, 9999), T.split(/\s+/).length));
check('empty text is zero', () => assert.strictEqual(wordIndexAtChar('', 5), 0));
check('null-ish inputs do not throw', () => {
  assert.strictEqual(wordIndexAtChar(undefined, undefined), 0);
  assert.strictEqual(wordIndexAtChar(T, -50), 1);
});
check('runs of whitespace do not create phantom words', () => {
  assert.strictEqual(wordIndexAtChar('a   b', 9999), 2);
  assert.strictEqual(wordIndexAtChar('a   b', 2), 1);
});

// The count must never exceed what the book will actually render, or highlightUpTo silently
// clamps and the last word never lights.
check('never exceeds the book\'s own word count, on every real page', () => {
  for (const page of story.pages) {
    const rendered = page.text.split(/\s+/).filter(Boolean).length;
    for (let i = 0; i <= page.text.length; i++) {
      const n = wordIndexAtChar(page.text, i);
      assert.ok(n >= 0 && n <= rendered, `page char ${i}: got ${n}, book renders ${rendered}`);
    }
    assert.strictEqual(wordIndexAtChar(page.text, page.text.length), rendered, 'end of page must light every word');
  }
});

check('monotonic across a whole page', () => {
  const t = story.pages[0].text;
  let prev = 0;
  for (let i = 0; i <= t.length; i++) {
    const n = wordIndexAtChar(t, i);
    assert.ok(n >= prev, `went backwards at ${i}`);
    prev = n;
  }
});

// Every keyword in story.json must actually occur in its page text, or the illustration
// effect can never fire — in the preview or on a real call.
check('every story keyword appears in its page text', () => {
  story.pages.forEach((page, i) => {
    for (const word of Object.keys(page.keywords || {})) {
      assert.ok(page.text.toLowerCase().includes(word.toLowerCase()), `page ${i + 1} has no "${word}"`);
    }
  });
});

check('every keypad effect maps to a sound', () => {
  for (const [key, fx] of Object.entries(story.effects || {})) {
    assert.ok(fx.sound, `key ${key} has no sound`);
    assert.ok(fx.label, `key ${key} has no label`);
  }
});

console.log(failures ? `\n${failures} PROBLEM(S)` : '\nALL PREVIEW CHECKS PASSED');
process.exit(failures ? 1 : 0);
