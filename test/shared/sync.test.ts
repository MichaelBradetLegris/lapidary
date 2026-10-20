import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { APP_NAME } from '../../src/shared/branding';
import {
  CONFLICT_COPY_BADGE,
  MERGE_MARKERS_CARD,
  conflictCopyLabel,
  conflictCopyOf,
  hasMergeMarkers,
  mergeMarkersCard,
  mergeMarkersText
} from '../../src/shared/text/sync';

/* files.11: sync hygiene. A conflict copy is known by the name its tool gives
   it, for three tools only, and a chapter with merge markers by its lines.
   The badge and the card that use them are checked in
   test/renderer/syncHygiene.render.test.ts, and listChapters' Excalidraw rule
   in test/main/files.test.ts. */

describe('conflictCopyOf: Obsidian Sync', () => {
  it("reads the help page's own example", () => {
    expect(conflictCopyOf('Meeting notes (Conflicted copy MyMacBook2 202411281430).md')).toEqual({
      tool: 'Obsidian Sync',
      original: 'Meeting notes.md'
    });
  });

  it('takes a device name with spaces and an apostrophe, and a .txt chapter', () => {
    expect(conflictCopyOf("Chapter 12 - The Mill (Conflicted copy Jane's iPhone 202610191530).md")).toEqual({
      tool: 'Obsidian Sync',
      original: 'Chapter 12 - The Mill.md'
    });
    expect(conflictCopyOf('notes (Conflicted copy DESKTOP-4F2K 202610191530).txt')).toEqual({
      tool: 'Obsidian Sync',
      original: 'notes.txt'
    });
  });

  it('keeps brackets that belong to the chapter name, and reads the words in any case', () => {
    expect(conflictCopyOf('Chapter 1 (draft) (Conflicted copy MyMacBook2 202411281430).md')).toEqual({
      tool: 'Obsidian Sync',
      original: 'Chapter 1 (draft).md'
    });
    expect(conflictCopyOf('Chapter 1 (conflicted copy MyMacBook2 202411281430).md')?.tool).toBe(
      'Obsidian Sync'
    );
  });
});

describe('conflictCopyOf: Dropbox', () => {
  it("reads a person's and a computer's copy", () => {
    expect(conflictCopyOf("Chapter 12 (Jane Doe's conflicted copy 2026-10-19).md")).toEqual({
      tool: 'Dropbox',
      original: 'Chapter 12.md'
    });
    expect(conflictCopyOf("Chapter 12 (DESKTOP-4F2K's conflicted copy 2026-10-19).txt")).toEqual({
      tool: 'Dropbox',
      original: 'Chapter 12.txt'
    });
  });

  it('reads a second copy the same day, and a curly apostrophe', () => {
    expect(conflictCopyOf("Chapter 12 (Jane Doe's conflicted copy 2026-10-19 (1)).md")?.original).toBe(
      'Chapter 12.md'
    );
    expect(conflictCopyOf('Chapter 12 (Jane Doe’s conflicted copy 2026-10-19).md')?.tool).toBe('Dropbox');
  });

  it('keeps brackets that belong to the chapter name', () => {
    expect(conflictCopyOf("Chapter 1 (draft) (Jane Doe's conflicted copy 2026-10-19).md")).toEqual({
      tool: 'Dropbox',
      original: 'Chapter 1 (draft).md'
    });
  });

  it('reads an owner whose name holds brackets, and the words in any case', () => {
    expect(conflictCopyOf("Chapter 1 (a(b's conflicted copy 2026-10-19).md")).toEqual({
      tool: 'Dropbox',
      original: 'Chapter 1.md'
    });
    expect(conflictCopyOf("Chapter 1 (Jane Doe's Conflicted Copy 2026-10-19).md")?.tool).toBe('Dropbox');
  });
});

describe('conflictCopyOf: Syncthing', () => {
  it('reads a copy with the device that made it', () => {
    expect(conflictCopyOf('Chapter 12.sync-conflict-20261019-153045-ABCDEFG.md')).toEqual({
      tool: 'Syncthing',
      original: 'Chapter 12.md'
    });
    expect(conflictCopyOf('notes.sync-conflict-20261019-153045-Q7Z2KX4.txt')).toEqual({
      tool: 'Syncthing',
      original: 'notes.txt'
    });
  });

  it('reads a copy from before Syncthing named the device, and the short ID of no device', () => {
    expect(conflictCopyOf('Chapter 12.sync-conflict-20261019-153045.md')?.original).toBe('Chapter 12.md');
    expect(conflictCopyOf('Chapter 12.sync-conflict-20261019-153045-0.md')?.original).toBe('Chapter 12.md');
  });

  it('keeps dots that belong to the chapter name', () => {
    expect(conflictCopyOf('Part 2. The Mill.sync-conflict-20261019-153045-ABCDEFG.md')).toEqual({
      tool: 'Syncthing',
      original: 'Part 2. The Mill.md'
    });
  });
});

describe('conflictCopyOf: any tool', () => {
  it('cuts a path to the file name, whichever separator it uses', () => {
    expect(conflictCopyOf("C:/vault/book/Chapter 12 (Jane Doe's conflicted copy 2026-10-19).md")).toEqual({
      tool: 'Dropbox',
      original: 'Chapter 12.md'
    });
    expect(conflictCopyOf('D:\\Novel\\Part 1\\Chapter 12.sync-conflict-20261019-153045-ABCDEFG.md')).toEqual({
      tool: 'Syncthing',
      original: 'Chapter 12.md'
    });
  });

  it('names a copy of a copy by the tool that made it last', () => {
    expect(
      conflictCopyOf(
        "Chapter 12 (Jane Doe's conflicted copy 2026-10-19).sync-conflict-20261020-101010-ABCDEFG.md"
      )
    ).toEqual({ tool: 'Syncthing', original: "Chapter 12 (Jane Doe's conflicted copy 2026-10-19).md" });
    expect(
      conflictCopyOf(
        "Chapter 12 (Conflicted copy MyMacBook2 202411281430) (Jane Doe's conflicted copy 2026-10-19).md"
      )
    ).toEqual({ tool: 'Dropbox', original: 'Chapter 12 (Conflicted copy MyMacBook2 202411281430).md' });
    expect(
      conflictCopyOf(
        'Chapter 12.sync-conflict-20261019-153045-ABCDEFG (Conflicted copy MyMacBook2 202411281430).md'
      )
    ).toEqual({ tool: 'Obsidian Sync', original: 'Chapter 12.sync-conflict-20261019-153045-ABCDEFG.md' });
    // The same tool twice: the copy is of the first copy.
    expect(
      conflictCopyOf(
        'Chapter 12 (Conflicted copy MyMacBook2 202411281430) (Conflicted copy iPad 202411281502).md'
      )
    ).toEqual({ tool: 'Obsidian Sync', original: 'Chapter 12 (Conflicted copy MyMacBook2 202411281430).md' });
    expect(
      conflictCopyOf(
        "Chapter 12 (Jane Doe's conflicted copy 2026-10-19) (Bob's conflicted copy 2026-10-20).md"
      )
    ).toEqual({ tool: 'Dropbox', original: "Chapter 12 (Jane Doe's conflicted copy 2026-10-19).md" });
    expect(
      conflictCopyOf(
        'Chapter 12.sync-conflict-20261019-153045-ABCDEFG.sync-conflict-20261020-101010-HIJKLMN.md'
      )
    ).toEqual({ tool: 'Syncthing', original: 'Chapter 12.sync-conflict-20261019-153045-ABCDEFG.md' });
  });

  it('leaves near misses and titles that only mention a conflict alone', () => {
    const misses = [
      // Ordinary chapters and copies no sync tool made.
      'Chapter 12.md',
      'The Conflict.md',
      'Chapter 9 - Conflicted.md',
      'Conflicted copy.md',
      'Chapter 1 (copy).md',
      'Chapter 1 - Copy.md',
      'Chapter 1 (1).md',
      'sync-conflict notes.md',
      // Obsidian Sync, one thing wrong.
      'Chapter 1 (Conflicted copy 202411281430).md',
      'Chapter 1 (Conflicted copy MyMacBook2 20241128).md',
      'Chapter 1 (Conflicted copy MyMacBook2 2024112814301).md',
      'Chapter 1 (Conflict copy MyMacBook2 202411281430).md',
      'Chapter 1(Conflicted copy MyMacBook2 202411281430).md',
      'Chapter 1 (Conflicted copy MyMacBook2 202411281430) draft.md',
      'Chapter 1 (Conflicted copy MyMacBook2 202411281430)',
      '(Conflicted copy MyMacBook2 202411281430).md',
      // Dropbox, one thing wrong.
      'Chapter 1 (conflicted copy 2026-10-19).md',
      "Chapter 1 (Jane Doe's conflicted copy).md",
      "Chapter 1 (Jane Doe's conflicted copy 19-10-2026).md",
      "Chapter 1 (Jane Doe's conflicted copy 2026-10-19.md",
      "Chapter 1 (Jane Doe's copy 2026-10-19).md",
      "Chapter 1 (Jane Doe's conflicted copy 2026-10-19 (a)).md",
      "Chapter 1 (Jane Doe's conflicted copy 2026-10-19)",
      // Syncthing, one thing wrong.
      'Chapter 1.sync-conflict.md',
      'Chapter 1.sync-conflict-2026101-153045-ABCDEFG.md',
      'Chapter 1.sync-conflict-20261019-15304-ABCDEFG.md',
      'Chapter 1.sync-conflict-20261019-153045-ABCDEFGH.md',
      'Chapter 1.sync-conflict-20261019-153045-abcdefg.md',
      'Chapter 1 sync-conflict-20261019-153045-ABCDEFG.md',
      'Chapter 1.syncconflict-20261019-153045-ABCDEFG.md',
      'Chapter 1.sync-conflict-20261019-153045-ABCDEFG',
      '.sync-conflict-20261019-153045-ABCDEFG.md',
      ''
    ];
    for (const name of misses) {
      expect(conflictCopyOf(name), name).toBeNull();
      expect(conflictCopyLabel(name), name).toBeNull();
    }
  });

  /* Each tool's copy of any chapter name gives that tool and the name back. */
  const nameChar = fc.constantFrom(..."abcxyzABCXYZ0129 -_,'.()!é".split(''));
  const chapterBase = fc
    .array(nameChar, { minLength: 1, maxLength: 24 })
    .map((chars) => chars.join('').trim())
    .filter((base) => base.length > 0 && !base.endsWith('.'));
  const ext = fc.constantFrom('.md', '.txt', '.MD');

  it('reads each tool back from any chapter name it copies (property)', () => {
    fc.assert(
      fc.property(
        chapterBase,
        ext,
        fc.constantFrom('Obsidian Sync', 'Dropbox', 'Syncthing'),
        (base, extension, tool) => {
          const name =
            tool === 'Obsidian Sync'
              ? `${base} (Conflicted copy Jane's Laptop 202610191530)${extension}`
              : tool === 'Dropbox'
                ? `${base} (Jane Doe's conflicted copy 2026-10-19)${extension}`
                : `${base}.sync-conflict-20261019-153045-ABCDEFG${extension}`;
          expect(conflictCopyOf(name)).toEqual({ tool, original: `${base}${extension}` });
          expect(conflictCopyLabel(name)).toContain(`${tool} made this copy of ${base}${extension} `);
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('never marks a name with no bracket and no .sync-conflict- (property)', () => {
    const plain = fc
      .array(
        fc.constantFrom(..."abcxyzABCXYZ0129 -_,'.!".split(''), 'conflicted copy ', "Jane's ", '2026-10-19 '),
        {
          maxLength: 12
        }
      )
      .map((parts) => parts.join(''));
    fc.assert(
      fc.property(plain, ext, (base, extension) => {
        expect(conflictCopyOf(`${base}${extension}`)).toBeNull();
      }),
      { numRuns: 1000 }
    );
  });
});

describe('conflictCopyLabel', () => {
  it('says which tool made the copy, of which chapter, and that nothing is hidden or deleted', () => {
    expect(conflictCopyLabel('Meeting notes (Conflicted copy MyMacBook2 202411281430).md')).toBe(
      `Obsidian Sync made this copy of Meeting notes.md when the file was changed in two places at once. Compare the two and keep the words you want. ${APP_NAME} does not hide or delete either.`
    );
    expect(conflictCopyLabel("Chapter 12 (Jane Doe's conflicted copy 2026-10-19).md")).toMatch(
      /^Dropbox made this copy of Chapter 12\.md when /
    );
    expect(conflictCopyLabel('Chapter 12.sync-conflict-20261019-153045-ABCDEFG.md')).toMatch(
      /^Syncthing made this copy of Chapter 12\.md when /
    );
  });

  it('gives the badge its words', () => {
    expect(CONFLICT_COPY_BADGE).toBe('conflict copy');
  });
});

describe('hasMergeMarkers', () => {
  it('finds the lines git writes around a passage it could not merge', () => {
    expect(
      hasMergeMarkers(
        'Mara walked to the mill.\n\n<<<<<<< HEAD\nThe wheel turned.\n=======\nThe wheel stood still.\n>>>>>>> origin/main\n'
      )
    ).toBe(true);
  });

  it('finds either marker alone, at the start or the end of the text, and in CRLF text', () => {
    expect(hasMergeMarkers('<<<<<<< HEAD\nThe wheel turned.')).toBe(true);
    expect(hasMergeMarkers('The wheel turned.\n>>>>>>> 3f2a91c (Chapter 12)')).toBe(true);
    expect(hasMergeMarkers('The wheel turned.\r\n<<<<<<< Updated upstream\r\nIt stopped.\r\n')).toBe(true);
    expect(hasMergeMarkers('a\n>>>>>>> ')).toBe(true);
  });

  it('leaves near misses alone', () => {
    const misses = [
      '',
      'The wheel turned.',
      '=======',
      'Chapter Twelve\n=======\n\nThe wheel turned.',
      '||||||| merged common ancestors',
      '<<<<<< six',
      '>>>>>> six',
      '<<<<<<<< eight',
      '>>>>>>>> eight',
      ' <<<<<<< HEAD',
      '\t>>>>>>> main',
      '<<<<<<<HEAD',
      '<<<<<<<\tHEAD',
      '<<<<<<<',
      'a\n>>>>>>>',
      'She wrote <<<<<<< HEAD in the margin.',
      '> A quotation.\n>> Within a quotation.',
      '« Où es-tu ? » she said.',
      '<<Where are you?>>'
    ];
    for (const text of misses) expect(hasMergeMarkers(text), JSON.stringify(text)).toBe(false);
  });
});

describe('the merge markers card', () => {
  it('names the chapter by its file name and says the file was not changed', () => {
    expect(mergeMarkersText('Chapter 12.md')).toBe(
      `Chapter 12.md has merge markers: lines that start with <<<<<<< or >>>>>>>. Git or a sync tool leaves them where two versions of the file disagreed, with both versions between them. Keep the words you want and remove the markers in Obsidian before you review or save this chapter. ${APP_NAME} has not changed the file.`
    );
    expect(mergeMarkersText('C:\\Novel\\Part 1\\Chapter 12.md')).toMatch(
      /^Chapter 12\.md has merge markers: /
    );
    expect(mergeMarkersText('/srv/novel/Chapter 12.md')).toMatch(/^Chapter 12\.md has merge markers: /);
    expect(MERGE_MARKERS_CARD).toBe('merge-markers');
  });

  const WITH = 'a\n<<<<<<< HEAD\nb\n=======\nc\n>>>>>>> main\n';
  const WITHOUT = 'a\nb\n';

  it('shows on an open with markers, and closes a card left from another chapter on one without', () => {
    expect(mergeMarkersCard(null, WITH)).toBe('show');
    expect(mergeMarkersCard(null, WITHOUT)).toBe('close');
  });

  it('shows on a reload that brings markers, closes on one that takes them away, and otherwise keeps', () => {
    expect(mergeMarkersCard(WITHOUT, WITH)).toBe('show');
    expect(mergeMarkersCard(WITH, WITHOUT)).toBe('close');
    expect(mergeMarkersCard(WITH, `${WITH}d\n`)).toBe('keep');
    expect(mergeMarkersCard(WITHOUT, `${WITHOUT}d\n`)).toBe('close');
  });
});
