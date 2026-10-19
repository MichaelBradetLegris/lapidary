import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  OBSIDIAN_OPEN_PREFIX,
  encodeLinkValue,
  isFullPath,
  isObsidianOpenUrl,
  obsidianLinkPath,
  obsidianOpenUrl,
  obsidianOpensFile
} from '../../src/shared/obsidian';

/* setup.10b: Open in Obsidian hands the system obsidian://open?path=<full
   path>. Obsidian finds the vault that holds the path itself, so the link
   names no vault, and every value is percent-encoded as Obsidian asks. */

describe('obsidianOpenUrl', () => {
  it('encodes a Windows path whole: drive colon, backslashes and spaces', () => {
    expect(obsidianOpenUrl('C:\\Vault\\Novel One\\GUIDELINES.md')).toBe(
      'obsidian://open?path=C%3A%5CVault%5CNovel%20One%5CGUIDELINES.md'
    );
    expect(obsidianOpenUrl('D:/Writing/Novel One/GUIDELINES.md')).toBe(
      'obsidian://open?path=D%3A%2FWriting%2FNovel%20One%2FGUIDELINES.md'
    );
  });

  it("encodes a POSIX path's slashes as %2F and its spaces as %20, as Obsidian's own example does", () => {
    const linux = '/home/user/my vault/path/to/my note.md'; // check-public: allow
    const mac = '/Users/writer/Documents/Novel/GUIDELINES.md'; // check-public: allow
    expect(obsidianOpenUrl(linux)).toBe(
      'obsidian://open?path=%2Fhome%2Fuser%2Fmy%20vault%2Fpath%2Fto%2Fmy%20note.md'
    );
    expect(obsidianOpenUrl(mac)).toBe(
      'obsidian://open?path=%2FUsers%2Fwriter%2FDocuments%2FNovel%2FGUIDELINES.md'
    );
  });

  it('takes network shares, with or without the long-path prefix', () => {
    expect(obsidianOpenUrl('\\\\nas\\books\\Vault\\GUIDELINES.md')).toBe(
      'obsidian://open?path=%5C%5Cnas%5Cbooks%5CVault%5CGUIDELINES.md'
    );
    expect(obsidianOpenUrl('\\\\?\\C:\\Vault\\GUIDELINES.md')).toBe(
      'obsidian://open?path=%5C%5C%3F%5CC%3A%5CVault%5CGUIDELINES.md'
    );
  });

  it('names no vault: a vault folder of any name is just part of the one path value', () => {
    const url = obsidianOpenUrl('C:\\Users\\writer\\Novel & Notes #1 100% +draft=yes?\\Book\\GUIDELINES.md'); // check-public: allow
    expect(url).toBe(
      'obsidian://open?path=C%3A%5CUsers%5Cwriter%5CNovel%20%26%20Notes%20%231%20100%25%20%2Bdraft%3Dyes%3F%5CBook%5CGUIDELINES.md'
    );
    expect(url).not.toMatch(/[?&](vault|file)=/);
    // One parameter, nothing after it, no space and no plus standing for one.
    const query = url!.slice('obsidian://open?'.length);
    expect(query.split('&')).toHaveLength(1);
    expect(url).not.toMatch(/[#+ ]/);
  });

  it("encodes !'()* too, which encodeURIComponent leaves alone", () => {
    expect(obsidianOpenUrl("/v/It's (nearly) done!*/GUIDELINES.md")).toBe(
      'obsidian://open?path=%2Fv%2FIt%27s%20%28nearly%29%20done%21%2A%2FGUIDELINES.md'
    );
    expect(encodeLinkValue("!'()*~-._")).toBe('%21%27%28%29%2A~-._');
  });

  it('encodes other scripts and accents as UTF-8 and keeps the Unicode form the system gave', () => {
    const composed = '/home/zoé/Romans/Été/GUIDELINES.md'.normalize('NFC'); // check-public: allow
    const decomposed = composed.normalize('NFD');
    expect(obsidianOpenUrl(composed)).toBe(
      'obsidian://open?path=%2Fhome%2Fzo%C3%A9%2FRomans%2F%C3%89t%C3%A9%2FGUIDELINES.md'
    );
    expect(obsidianOpenUrl(decomposed)).toBe(
      'obsidian://open?path=%2Fhome%2Fzoe%CC%81%2FRomans%2FE%CC%81te%CC%81%2FGUIDELINES.md'
    );
    expect(obsidianOpenUrl('C:\\小説\\Роман 📚\\GUIDELINES.md')).toBe(
      'obsidian://open?path=C%3A%5C%E5%B0%8F%E8%AA%AC%5C%D0%A0%D0%BE%D0%BC%D0%B0%D0%BD%20%F0%9F%93%9A%5CGUIDELINES.md'
    );
  });

  it('makes no link for a path that is not a full one, a file that is not .md, or text a link cannot carry', () => {
    expect(obsidianOpenUrl('GUIDELINES.md')).toBeNull();
    expect(obsidianOpenUrl('Novel\\GUIDELINES.md')).toBeNull();
    expect(obsidianOpenUrl('./Novel/GUIDELINES.md')).toBeNull();
    expect(obsidianOpenUrl('C:GUIDELINES.md')).toBeNull();
    expect(obsidianOpenUrl('')).toBeNull();
    expect(obsidianOpenUrl('C:\\Vault\\GUIDELINES.txt')).toBeNull();
    expect(obsidianOpenUrl('C:\\Vault\\GUIDELINES')).toBeNull();
    expect(obsidianOpenUrl('C:\\Vault.md\\GUIDELINES')).toBeNull();
    expect(obsidianOpenUrl('C:\\Vault\\\uD800 notes.md')).toBeNull();
    expect(obsidianOpenUrl('C:\\Vault\\GUIDELINES.MD')).toBe(
      'obsidian://open?path=C%3A%5CVault%5CGUIDELINES.MD'
    );
  });
});

describe('isFullPath and obsidianOpensFile', () => {
  it('knows a full path from a relative one on Windows and POSIX', () => {
    for (const p of ['C:\\a.md', 'c:/a.md', '\\\\server\\share\\a.md', '/a.md', '//server/share/a.md']) {
      expect(isFullPath(p), p).toBe(true);
    }
    for (const p of ['a.md', '.\\a.md', '..\\a.md', 'C:a.md', '\\a.md', '~/a.md', 'obsidian://open']) {
      expect(isFullPath(p), p).toBe(false);
    }
  });

  it('opens .md files in Obsidian, in any case, and nothing else', () => {
    expect(obsidianOpensFile('C:\\V\\GUIDELINES.md')).toBe(true);
    expect(obsidianOpensFile('/v/Notes.Md')).toBe(true);
    expect(obsidianOpensFile('/v/GUIDELINES.txt')).toBe(false);
    expect(obsidianOpensFile('/v/GUIDELINES.md.bak')).toBe(false);
  });
});

describe('isObsidianOpenUrl', () => {
  it('accepts exactly the links obsidianOpenUrl makes and gives their path back', () => {
    const file = 'C:\\Vault\\Novel One\\GUIDELINES.md';
    const url = obsidianOpenUrl(file)!;
    expect(isObsidianOpenUrl(url)).toBe(true);
    expect(obsidianLinkPath(url)).toBe(file);
  });

  it('refuses any other scheme, action, parameter or spelling of the same path', () => {
    for (const url of [
      'https://example.com/GUIDELINES.md',
      'file:///C:/Vault/GUIDELINES.md',
      'obsidian://new?path=C%3A%5CVault%5CGUIDELINES.md',
      'obsidian://open?vault=Vault&file=GUIDELINES',
      'obsidian://open?path=C%3A%5CVault%5CGUIDELINES.md&vault=Other',
      'obsidian://open?path=C%3A%5CVault%5CGUIDELINES.md#Heading',
      'obsidian://open?path=C:%5CVault%5CGUIDELINES.md',
      'obsidian://open?path=C%3a%5cVault%5cGUIDELINES.md',
      'obsidian://open?path=C%3A%5CVault%5CGUIDELINES.txt',
      'obsidian://open?path=GUIDELINES.md',
      'obsidian://open?path=%E0%A4%A',
      'obsidian://open?path=',
      'OBSIDIAN://open?path=C%3A%5CVault%5CGUIDELINES.md'
    ]) {
      expect(isObsidianOpenUrl(url), url).toBe(false);
    }
  });

  it('round-trips any folder name: one path parameter that decodes to the path it was made from', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ unit: 'grapheme', minLength: 1, maxLength: 12 }), {
          minLength: 1,
          maxLength: 4
        }),
        fc.constantFrom('C:\\', 'D:/', '/', '\\\\nas\\share\\'),
        (folders, root) => {
          const separator = root.includes('/') ? '/' : '\\';
          const clean = folders.map((f) => f.replace(/[\\/]/g, '_'));
          const file = `${root}${clean.join(separator)}${separator}GUIDELINES.md`;
          const url = obsidianOpenUrl(file);
          expect(url).not.toBeNull();
          expect(url!.startsWith(OBSIDIAN_OPEN_PREFIX)).toBe(true);
          expect(url!.slice(OBSIDIAN_OPEN_PREFIX.length)).toMatch(/^(?:[A-Za-z0-9\-._~]|%[0-9A-F]{2})+$/);
          expect(isObsidianOpenUrl(url!)).toBe(true);
          expect(obsidianLinkPath(url!)).toBe(file);
        }
      )
    );
  });
});
