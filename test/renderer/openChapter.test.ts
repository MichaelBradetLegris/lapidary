import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createKeyedWriter } from '../../src/renderer/state/persist';

/* apply.25: what the page does with a read that failed, in the chapter list
   and when a chapter opens. These are source checks: the tests run without a
   DOM. What main sends is tested in test/main/files.test.ts (`listChapters`)
   and test/main/reviews.test.ts (`loadLatestReview`), the list's line in
   test/shared/chapterList.test.ts, and the window steps are in PLAN
   (apply.25). Its review adds the card's words (test/shared/open.test.ts)
   and a review whose decisions could not be written: the review writer
   (`reviewPersistence.ts`) reaches main through the preload bridge, so it is
   checked by its source, and the keyed writer it is built on is run here as
   an open uses it. */

const RENDERER = path.join(__dirname, '../../src/renderer');
const withoutComments = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
const read = (file: string): string => withoutComments(readFileSync(path.join(RENDERER, file), 'utf8'));

const APP = read('App.tsx');
const FILE_LIST = read('components/FileList.tsx');
const CSS = readFileSync(path.join(RENDERER, 'styles/app.css'), 'utf8');

const between = (text: string, from: string, to: string): string => {
  const start = text.indexOf(from);
  expect(start, from).toBeGreaterThan(-1);
  const end = text.indexOf(to, start);
  expect(end, to).toBeGreaterThan(start);
  return text.slice(start, end);
};

describe('a manuscript folder that cannot be read (apply.25 a)', () => {
  it('keeps why the list could not be read, and clears it once it is read, newest answer only', () => {
    const refresh = between(APP, 'const refreshFiles = useCallback(', '}, [refreshIndex]);');
    expect(refresh).toContain('const ticket = ++filesSeq.current;');
    expect(refresh).toMatch(
      /\.then\(\(list\) => \{\s*if \(ticket !== filesSeq\.current\) return;\s*setFiles\(list\);\s*setFilesProblem\(null\);/
    );
    expect(refresh).toMatch(
      /\.catch\(\(err: unknown\) => \{\s*if \(ticket !== filesSeq\.current\) return;\s*setFiles\(\[\]\);\s*setFilesProblem\(errorMessage\(err\)\);/
    );
    expect(APP).toContain('const [filesProblem, setFilesProblem] = useState<string | null>(null);');
  });

  it('hands the list the words and a way to read it again', () => {
    expect(APP).toMatch(/<FileList[^>]*problem=\{filesProblem\}[^>]*onReadAgain=\{refreshFiles\}/);
  });

  it('shows the words where the empty-folder line would be, with Try again', () => {
    expect(FILE_LIST).toContain(
      'const notice = chapterListNotice({ configured, count: files.length, problem });'
    );
    expect(FILE_LIST).toMatch(
      /<p className=\{notice\.action === 'read-again' \? 'files__problem' : 'side__empty'\}>\{notice\.text\}<\/p>/
    );
    expect(FILE_LIST).toMatch(
      /notice\.action === 'read-again' \? \(\s*<button type="button" onClick=\{onReadAgain\}>\s*\{READ_LIST_AGAIN\}\s*<\/button>/
    );
    // The words are in shared/ui/chapterList.ts, not in the component.
    expect(FILE_LIST).not.toContain('No .md or .txt files');
    expect(CSS).toMatch(/\.files__problem \{[^}]*color: var\(--ink\);[^}]*overflow-wrap: anywhere;/);
  });
});

describe('the review a chapter opens with that cannot be read (apply.25 c)', () => {
  const open = between(APP, 'const openChapter = useCallback(', 'const openHistoryEntry');

  it('lets a failed reviews:load-latest stop the open, before anything on screen changes', () => {
    const load = open.indexOf("await call('reviews:load-latest'");
    expect(load).toBeGreaterThan(open.indexOf("call('files:read'"));
    // Never swallowed: the chapter used to open on a blank review. Its only
    // catch names the chapter and throws again (apply.25 review, below).
    expect(open).toContain(
      "latest = await call('reviews:load-latest', { sourcePath: file.path, hash: base.hash });"
    );
    expect(open).not.toMatch(/catch \{|\.catch\(/);
    expect(open.match(/catch\s*\(/g)).toHaveLength(2);
    for (const change of [
      'setReview(',
      'markReviewPersistedState(',
      'refreshHistory(',
      'dismissNotificationsByKey('
    ]) {
      expect(open.indexOf(change), change).toBeGreaterThan(load);
    }
  });

  it('shows the failure as a card that the next try replaces, and an open that works closes', () => {
    expect(APP).toContain("const OPEN_CHAPTER_CARD = 'open-chapter';");
    expect(open).toMatch(
      /\} catch \(err\) \{\s*notify\('error', errorMessage\(err\), OPEN_CHAPTER_CARD\);\s*\}\s*\}\)\(\);/
    );
    const dismiss = open.indexOf('dismissNotificationsByKey(OPEN_CHAPTER_CARD);');
    expect(dismiss).toBeGreaterThan(open.indexOf('await marked;'));
    expect(dismiss).toBeLessThan(open.indexOf('setReview('));
  });
});

/* apply.25 review: the card says which chapter was not opened when the
   failure is the review's, whose words name only a review file or a folder.
   The words are tested in test/shared/open.test.ts. */
describe('the card names the chapter that was not opened (apply.25 review)', () => {
  const open = between(APP, 'const openChapter = useCallback(', 'const openHistoryEntry');

  it("wraps only reviews:load-latest's failure in the chapter's name, and throws it on to the card", () => {
    expect(open).toMatch(
      /let latest: LoadedReview \| null;\s*try \{\s*latest = await call\('reviews:load-latest', \{ sourcePath: file\.path, hash: base\.hash \}\);\s*\} catch \(err\) \{\s*throw new Error\(chapterNotOpenedText\(file\.name, errorMessage\(err\)\), \{ cause: err \}\);\s*\}/
    );
    // The chapter file's own failure is not wrapped: its words name the chapter already.
    const read = open.indexOf("const content = await call('files:read', { path: file.path });");
    expect(read).toBeGreaterThan(-1);
    expect(read).toBeLessThan(open.indexOf('let latest: LoadedReview | null;'));
    expect(open.match(/chapterNotOpenedText\(/g)).toHaveLength(1);
  });
});

/* apply.25 review: a decision whose write failed is not in the review file,
   so the open tries such writes again before it reads anything, and a review
   whose write still fails does not come on screen read from disk without it. */
describe('a review whose latest decisions could not be written (apply.25 review)', () => {
  const open = between(APP, 'const openChapter = useCallback(', 'const openHistoryEntry');
  const history = between(APP, 'const openHistoryEntry = useCallback(', 'const offChanged');

  it('tries failed writes again before it flushes, in both opens, before anything is read', () => {
    for (const [name, body, first] of [
      ['chapter', open, "call('files:read'"],
      ['history', history, "call('reviews:load'"]
    ] as const) {
      expect(body, name).toMatch(
        /retryReviewWrites\(\);\s*await flushReviewWrites\(\);\s*await flushDraftWrites\(\);\s*if \(decision === 'here'\) return;/
      );
      expect(body.indexOf('retryReviewWrites();'), name).toBeLessThan(body.indexOf(first));
    }
  });

  it('stops a chapter whose review is behind the page, before anything on screen changes', () => {
    const check = open.indexOf('const unwritten = reviewWriteFailureOf(loaded.review);');
    expect(check).toBeGreaterThan(open.indexOf("await call('reviews:load-latest'"));
    expect(check).toBeGreaterThan(
      open.indexOf('loaded = { path: latest.path, review: rehomeReview(latest.review, file.path) };')
    );
    expect(open).toMatch(
      /const unwritten = reviewWriteFailureOf\(loaded\.review\);\s*if \(unwritten !== null\) throw new Error\(unwrittenReviewText\(\{ chapter: file\.name \}, unwritten\)\);/
    );
    for (const change of [
      'await marked;',
      'dismissNotificationsByKey(',
      'setReview(',
      'markReviewPersistedState(',
      'refreshHistory('
    ]) {
      expect(open.indexOf(change), change).toBeGreaterThan(check);
    }
  });

  it('stops a review from History or the selector the same way, with the open card', () => {
    const check = history.indexOf('const unwritten = reviewWriteFailureOf(review);');
    expect(check).toBeGreaterThan(history.indexOf("await call('reviews:load'"));
    expect(history).toMatch(
      /if \(unwritten !== null\) \{\s*throw new Error\(unwrittenReviewText\(\{ reviewCreatedAt: summary\.createdAt \}, unwritten\)\);\s*\}/
    );
    for (const change of [
      "call('files:read'",
      'dismissNotificationsByKey(OPEN_CHAPTER_CARD);',
      'setReview(',
      'markReviewPersistedState(',
      "call('reviews:shown'"
    ]) {
      expect(history.indexOf(change), change).toBeGreaterThan(check);
    }
    // Its failures share the open card: the next try replaces it, an open that works closes it.
    expect(history).toMatch(
      /\} catch \(err\) \{\s*notify\('error', errorMessage\(err\), OPEN_CHAPTER_CARD\);\s*\}/
    );
    expect(history).not.toContain('fail(err)');
    expect(history.indexOf('dismissNotificationsByKey(OPEN_CHAPTER_CARD);')).toBeLessThan(
      history.indexOf('setReview(')
    );
  });
});

describe('the review writer as an open uses it (apply.25 review)', () => {
  const PERSIST = read('state/reviewPersistence.ts');
  const HELD = 'Another program is holding the review file.';
  /** Review B of Chapter 01, keyed as `reviewKey` keys it: chapter path, then review id. */
  const B = 'C:/vault/Chapter 01.md\u0000review-b';

  it("names the failure of one review only, by the key of the review about to be shown, in its card's words", () => {
    expect(PERSIST).toContain(
      "export function reviewKey(review: Pick<Review, 'sourcePath' | 'id'>): string {"
    );
    expect(PERSIST).toMatch(
      /export function reviewWriteFailureOf\(review: Pick<Review, 'sourcePath' \| 'id'>\): string \| null \{\s*const \[message\] = writer\.failures\(reviewKey\(review\)\);\s*return message === undefined \? null : notSavedText\(message\);\s*\}/
    );
    expect(PERSIST).toContain('writer.retry();');
  });

  it('keeps a failed write until a retry writes it; a flush alone, all an open used to do, does not', async () => {
    let refuse = true;
    const written: [string, string][] = [];
    const writer = createKeyedWriter<string>({
      delayMs: 700,
      write: (key, value) => {
        if (refuse) return Promise.reject(new Error(HELD));
        written.push([key, value]);
        return Promise.resolve();
      }
    });
    writer.schedule(B, 'accepted');
    await writer.flush();
    expect(writer.failures(B)).toEqual([HELD]);
    expect(writer.failures('C:/vault/Chapter 01.md\u0000review-a')).toEqual([]);
    expect(writer.failures('C:/vault/Chapter 02.md\u0000review-b')).toEqual([]);

    // The file is free again, but a flush writes only what is waiting: the
    // open used to read the review back here, without the decision.
    refuse = false;
    await writer.flush();
    expect(written).toEqual([]);
    expect(writer.failures(B)).toEqual([HELD]);

    // What an open now does first: B is written, and nothing stops it.
    writer.retry();
    await writer.flush();
    expect(written).toEqual([[B, 'accepted']]);
    expect(writer.failures(B)).toEqual([]);
  });

  it('still names the failure when the retry fails too, so the open stops', async () => {
    const writer = createKeyedWriter<string>({
      delayMs: 700,
      write: () => Promise.reject(new Error(HELD))
    });
    writer.schedule(B, 'accepted');
    await writer.flush();
    writer.retry();
    await writer.flush();
    expect(writer.failures(B)).toEqual([HELD]);
  });
});
