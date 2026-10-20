import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FileList } from '../../src/renderer/components/FileList';
import type { ChapterFile } from '../../src/shared/ipc';
import { NOT_WATCHING, NO_CHAPTERS, NO_FOLDER_CHOSEN } from '../../src/shared/ui/chapterList';

/* files.21: the chapter list while main is not watching the manuscript
   folder, rendered with react-dom/server and type-checked with the renderer's
   project. The line's words are tested in test/shared/chapterList.test.ts and
   App's wiring in test/renderer/openChapter.test.ts. */

const FOLDER = 'D:/Novel';

function chapter(name: string): ChapterFile {
  return { path: `${FOLDER}/${name}`, relativePath: name, name, size: 10, mtimeMs: 0 };
}

const PROBLEM =
  'Windows would not let Lapidary read the manuscript folder Novel. Another program may have it open, such as a sync, backup or antivirus tool, or your Windows account may not be allowed to read it. Close it there, or wait a moment, and try again. Lapidary has not changed anything.';

function render(input: {
  files?: ChapterFile[];
  configured?: boolean;
  problem?: string | null;
  watching: boolean;
}): string {
  return renderToStaticMarkup(
    createElement(FileList, {
      files: input.files ?? [],
      index: {},
      review: null,
      configured: input.configured ?? true,
      problem: input.problem ?? null,
      watching: input.watching,
      onOpen: () => undefined,
      onChooseFolder: () => undefined,
      onReadAgain: () => undefined,
      onNewChapter: () => undefined
    })
  );
}

/** What follows the heading, as text in order: each line, button and row. */
function body(html: string): string[] {
  const after = html.slice(html.indexOf('</div>') + '</div>'.length);
  const out: string[] = [];
  for (const match of after.matchAll(
    /<p class="([^"]*)">([^<]*)<\/p>|<button type="button">([^<]*)<\/button>|<span class="filelist__name">([^<]*)<\/span>/g
  )) {
    if (match[1] !== undefined) out.push(`${match[1]}: ${match[2]}`);
    else if (match[3] !== undefined) out.push(`[${match[3]}]`);
    else out.push(`row: ${match[4]}`);
  }
  return out.map((line) => line.replace(/&#x27;/g, "'"));
}

describe('the chapter list while main is not watching the folder (files.21)', () => {
  it('puts the line and Try again above the rows when the list was read', () => {
    const html = render({ files: [chapter('Chapter 1.md'), chapter('Chapter 2.md')], watching: false });
    expect(body(html)).toEqual([
      `files__problem: ${NOT_WATCHING}`,
      '[Try again]',
      'row: Chapter 1.md',
      'row: Chapter 2.md'
    ]);
  });

  it('adds the line under the words of a folder that could not be read, with one Try again', () => {
    expect(body(render({ problem: PROBLEM, watching: false }))).toEqual([
      `files__problem: ${PROBLEM}`,
      `files__problem: ${NOT_WATCHING}`,
      '[Try again]'
    ]);
  });

  it('adds it under the empty-folder line, which then has Try again too', () => {
    expect(body(render({ watching: false }))).toEqual([
      `side__empty: ${NO_CHAPTERS}`,
      `files__problem: ${NOT_WATCHING}`,
      '[Try again]'
    ]);
  });

  it('says nothing of the watcher while main watches the folder, as before', () => {
    expect(body(render({ files: [chapter('Chapter 1.md')], watching: true }))).toEqual(['row: Chapter 1.md']);
    expect(body(render({ problem: PROBLEM, watching: true }))).toEqual([
      `files__problem: ${PROBLEM}`,
      '[Try again]'
    ]);
    expect(body(render({ watching: true }))).toEqual([`side__empty: ${NO_CHAPTERS}`]);
  });

  it('asks for a folder while none is chosen, since there is nothing to watch', () => {
    expect(body(render({ configured: false, watching: false }))).toEqual([
      `side__empty: ${NO_FOLDER_CHOSEN}`,
      '[Choose folder]'
    ]);
  });
});
