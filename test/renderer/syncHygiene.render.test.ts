import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { FileList } from '../../src/renderer/components/FileList';
import { noteMergeMarkers } from '../../src/renderer/state/mergeMarkers';
import { useApp } from '../../src/renderer/state/store';
import type { ChapterFile, ReviewSummary } from '../../src/shared/ipc';
import { MERGE_MARKERS_CARD, conflictCopyLabel, mergeMarkersText } from '../../src/shared/text/sync';

/* files.11: the chapter list's badge for a sync tool's conflict copy, and the
   card for a chapter with merge markers. The list is rendered with
   react-dom/server and the card runs against the app's store, type-checked
   with the renderer's project; App's two calls and the badge's style are
   source checks in syncHygiene.test.ts, as the tests run without a DOM. The
   names and lines are tested in test/shared/sync.test.ts. */

const FOLDER = 'D:/Novel';

function chapter(relativePath: string): ChapterFile {
  const name = relativePath.split('/').pop() ?? relativePath;
  return { path: `${FOLDER}/${relativePath}`, relativePath, name, size: 10, mtimeMs: 0 };
}

const FILES = [
  chapter('Chapter 12.md'),
  chapter("Chapter 12 (Jane Doe's conflicted copy 2026-10-19).md"),
  chapter('Chapter 12.sync-conflict-20261019-153045-ABCDEFG.md'),
  chapter('Part 2/Chapter 13 (Conflicted copy MyMacBook2 202610191530).md'),
  chapter('The Conflict.md')
];

function summary(sourcePath: string, pendingCount: number): ReviewSummary {
  return {
    id: 'r',
    path: `${sourcePath}.review.json`,
    sourcePath,
    createdAt: '2026-10-19T09:00:00.000Z',
    updatedAt: '2026-10-19T09:00:00.000Z',
    generatorKind: 'claude',
    provider: 'claude',
    hunkCount: pendingCount,
    pendingCount,
    unsavedCount: 0
  };
}

function render(index: Record<string, ReviewSummary> = {}): string {
  return renderToStaticMarkup(
    createElement(FileList, {
      files: FILES,
      index,
      review: null,
      configured: true,
      problem: null,
      watching: true,
      onOpen: () => undefined,
      onChooseFolder: () => undefined,
      onReadAgain: () => undefined,
      onNewChapter: () => undefined
    })
  );
}

const unescape = (html: string): string =>
  html
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');

/** Each row's markup, by the name it shows. */
function rows(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const li of unescape(html).match(/<li>[\s\S]*?<\/li>/g) ?? []) {
    const name = /<span class="filelist__name">([^<]*)<\/span>/.exec(li)?.[1];
    if (name !== undefined) out.set(name, li);
  }
  return out;
}

describe('the conflict copy badge (files.11)', () => {
  it('marks each tool’s copy, with a tooltip that names the tool and the chapter, and lists every file', () => {
    const list = rows(render());
    expect([...list.keys()]).toEqual(FILES.map((f) => f.relativePath));
    for (const file of FILES) {
      const row = list.get(file.relativePath) ?? '';
      const label = conflictCopyLabel(file.name);
      if (label === null) {
        expect(row, file.name).not.toContain('badge--conflict');
        expect(row, file.name).not.toContain('filelist__copy');
      } else {
        // The badge on a line of its own under the name (the files.11 review).
        expect(row, file.name).toContain(
          `<span class="filelist__copy"><span class="filelist__name">${file.relativePath}</span><span class="badge badge--conflict" title="${label}">conflict copy</span></span>`
        );
      }
    }
    const marked = [...list.values()].filter((row) => row.includes('badge--conflict'));
    expect(marked).toHaveLength(3);
    expect(list.get('Part 2/Chapter 13 (Conflicted copy MyMacBook2 202610191530).md')).toContain(
      'title="Obsidian Sync made this copy of Chapter 13.md when'
    );
  });

  it('keeps the copy a chapter like any other: a row button that opens it, its name in full as the tooltip', () => {
    const row = rows(render()).get("Chapter 12 (Jane Doe's conflicted copy 2026-10-19).md") ?? '';
    expect(row).toMatch(
      /^<li><button type="button" class="filelist__item " title="Chapter 12 \(Jane Doe's conflicted copy 2026-10-19\)\.md">/
    );
  });

  it('puts the badge under the name, and the pending count after both, as on any row', () => {
    const copy = FILES[1] as ChapterFile;
    const row = rows(render({ [copy.path]: summary(copy.path, 4) })).get(copy.relativePath) ?? '';
    const name = row.indexOf('filelist__name');
    const badge = row.indexOf('badge--conflict');
    const pending = row.indexOf('badge--pending');
    expect(name).toBeGreaterThan(-1);
    expect(badge).toBeGreaterThan(name);
    expect(pending).toBeGreaterThan(badge);
    // The pending count stays outside the name's column, beside both lines.
    expect(row).toMatch(/conflict copy<\/span><\/span><span class="badge badge--pending"/);
  });
});

describe('the merge markers card (files.11)', () => {
  const WITH = 'The wheel turned.\n\n<<<<<<< HEAD\nIt stopped.\n=======\nIt slowed.\n>>>>>>> origin/main\n';
  const WITHOUT = 'The wheel turned.\n\nIt stopped.\n';
  const cards = () =>
    useApp.getState().notifications.map((n) => ({ tone: n.tone, text: n.text, key: n.key }));
  const CARD = { tone: 'warn', text: mergeMarkersText('Chapter 12.md'), key: MERGE_MARKERS_CARD };

  beforeEach(() => {
    useApp.getState().clearNotifications();
  });

  it('warns when a chapter opens with markers, once however often it opens, and goes when one without opens', () => {
    noteMergeMarkers(null, WITH, 'Chapter 12.md');
    expect(cards()).toEqual([CARD]);
    noteMergeMarkers(null, WITH, 'D:\\Novel\\Chapter 12.md');
    expect(cards()).toEqual([CARD]);
    noteMergeMarkers(null, WITHOUT, 'Chapter 13.md');
    expect(cards()).toEqual([]);
  });

  it('leaves other cards alone', () => {
    useApp.getState().notify('info', 'Saved to the chapter file.');
    noteMergeMarkers(null, WITH, 'Chapter 12.md');
    noteMergeMarkers(null, WITHOUT, 'Chapter 13.md');
    expect(cards().map((c) => c.text)).toEqual(['Saved to the chapter file.']);
  });

  it('warns when a reload brings markers, goes when one takes them out, and stays closed while they remain', () => {
    noteMergeMarkers(WITHOUT, WITH, 'D:/Novel/Chapter 12.md');
    expect(cards()).toEqual([CARD]);
    // Closed with its X, it does not come back at the next save in Obsidian.
    const card = useApp.getState().notifications[0];
    useApp.getState().dismissNotification(card?.id ?? '');
    noteMergeMarkers(WITH, `${WITH}More.\n`, 'D:/Novel/Chapter 12.md');
    expect(cards()).toEqual([]);
    // Left up, it stays as it was.
    noteMergeMarkers(WITHOUT, WITH, 'D:/Novel/Chapter 12.md');
    const id = useApp.getState().notifications[0]?.id;
    noteMergeMarkers(WITH, `${WITH}More.\n`, 'D:/Novel/Chapter 12.md');
    expect(useApp.getState().notifications.map((n) => n.id)).toEqual([id]);
    // The markers taken out: the card goes.
    noteMergeMarkers(WITH, WITHOUT, 'D:/Novel/Chapter 12.md');
    expect(cards()).toEqual([]);
  });
});
