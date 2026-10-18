import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/* apply.25: what the page does with a read that failed, in the chapter list
   and when a chapter opens. These are source checks: the tests run without a
   DOM. What main sends is tested in test/main/files.test.ts (`listChapters`)
   and test/main/reviews.test.ts (`loadLatestReview`), the list's line in
   test/shared/chapterList.test.ts, and the window steps are in PLAN
   (apply.25). */

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
    // No catch of its own: the chapter used to open on a blank review.
    expect(open).toContain(
      "const latest = await call('reviews:load-latest', { sourcePath: file.path, hash: base.hash });"
    );
    expect(open).not.toMatch(/catch \{|\.catch\(/);
    expect(open.match(/catch\s*\(/g)).toHaveLength(1);
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
      /\} catch \(err\) \{\s*notify\('error', errorMessage\(err\), OPEN_CHAPTER_CARD\);\s*\}/
    );
    const dismiss = open.indexOf('dismissNotificationsByKey(OPEN_CHAPTER_CARD);');
    expect(dismiss).toBeGreaterThan(open.indexOf('await marked;'));
    expect(dismiss).toBeLessThan(open.indexOf('setReview('));
  });
});
