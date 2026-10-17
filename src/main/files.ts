import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  ChapterExtension,
  ChapterFile,
  FileContent,
  NameCheck,
  SaveBackup,
  SaveRequest,
  SaveResponse
} from '../shared/ipc';
import { CHAPTER_EXTENSIONS } from '../shared/ipc';
import { isInsidePath, pathKey, samePath } from '../shared/paths';
import { MAX_TEXT_BYTES, classifyBytes, encodingProblem } from '../shared/text/encoding';
import { normalizeText, restoreText } from '../shared/text/eol';
import { atomicWriteFile, type AtomicWriteOptions } from './atomic';
import { fail } from './errors';

const SKIP_DIRS = new Set(['node_modules', '.git', '.obsidian', '.trash', 'out', 'dist']);

/** Extensions the app treats as a chapter, lower-case and with the dot. */
const CHAPTER_SUFFIXES = new Set<string>(CHAPTER_EXTENSIONS.map((e) => `.${e}`));

export function isChapterFile(name: string): boolean {
  return CHAPTER_SUFFIXES.has(path.extname(name).toLowerCase());
}

export function hashBytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Whether this platform's file system ignores case when it compares names. */
export function caseInsensitiveFs(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'win32' || platform === 'darwin';
}

/* ------------------------------------------------------------------ */
/* Which files Save may write (files.2)                                */
/* ------------------------------------------------------------------ */

/**
 * Chapters read or created from inside the manuscript folder during this run.
 * A chapter stays savable after Settings points at another folder, because the
 * author opened it from the right one; a path never opened that way does not.
 */
export class OpenedChapters {
  private readonly keys = new Set<string>();

  constructor(private readonly ci: boolean = caseInsensitiveFs()) {}

  add(file: string): void {
    this.keys.add(pathKey(path.resolve(file), this.ci));
  }

  has(file: string): boolean {
    return this.keys.has(pathKey(path.resolve(file), this.ci));
  }
}

export interface SaveGuard {
  manuscriptFolder: string | null;
  guidelinesPath: string | null;
  opened: Pick<OpenedChapters, 'has'>;
  ci: boolean;
}

export function isInsideManuscript(file: string, manuscriptFolder: string | null, ci: boolean): boolean {
  return manuscriptFolder !== null && isInsidePath(path.resolve(manuscriptFolder), path.resolve(file), ci);
}

/**
 * Throws unless `file` is a chapter Save may write: a .md or .txt file, not
 * the guidelines file, and either inside the manuscript folder or opened from
 * it earlier in this run. The renderer only ever saves the chapter it opened;
 * this is what holds when it asks for anything else (CLAUDE.md rule 1).
 */
export function assertSavableChapter(file: string, guard: SaveGuard): void {
  const name = path.basename(file);
  if (!isChapterFile(name)) {
    throw fail(
      'invalid-input',
      `${name} is not a chapter file, so it was not saved. Only .md and .txt chapters are written.`
    );
  }
  if (guard.guidelinesPath && samePath(path.resolve(file), path.resolve(guard.guidelinesPath), guard.ci)) {
    throw fail(
      'invalid-input',
      `${name} is the guidelines file, so it was not saved as a chapter. Edit it in Obsidian or any text editor.`
    );
  }
  if (isInsideManuscript(file, guard.manuscriptFolder, guard.ci) || guard.opened.has(file)) return;
  throw fail(
    'invalid-input',
    `${name} was not opened from the manuscript folder chosen in Settings, so it was not saved. Open it again from the file list, or set Settings > Manuscript folder back to the folder that holds it.`
  );
}

function isHidden(name: string): boolean {
  return name.startsWith('.');
}

/**
 * Every `.md` and `.txt` under `folder`, skipping dot-folders, the reviews
 * folder and any files named in `excludeFiles` (the guidelines file is not a
 * chapter).
 */
export async function listChapters(
  folder: string,
  reviewsFolder: string | null,
  excludeFiles: readonly string[] = []
): Promise<ChapterFile[]> {
  const out: ChapterFile[] = [];
  const excluded = reviewsFolder ? path.resolve(reviewsFolder) : null;
  const skipFiles = new Set(excludeFiles.map((f) => path.resolve(f).toLowerCase()));

  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (isHidden(entry.name) || SKIP_DIRS.has(entry.name)) continue;
        if (excluded && path.resolve(full) === excluded) continue;
        await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (isHidden(entry.name) || !isChapterFile(entry.name)) continue;
      if (skipFiles.has(path.resolve(full).toLowerCase())) continue;
      const stat = await fs.stat(full).catch(() => null);
      if (!stat) continue;
      out.push({
        path: full,
        relativePath: path.relative(folder, full).split(path.sep).join('/'),
        name: entry.name,
        size: stat.size,
        mtimeMs: stat.mtimeMs
      });
    }
  };

  await walk(folder);
  return out.sort((a, b) => a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true }));
}

/**
 * The text of a chapter or guidelines file, read only when it is UTF-8 and at
 * most 4 MiB (files.3, PLAN 11.3 l). Anything else is refused with advice for
 * what it most likely is, before the app could write replacement characters
 * back over the author's letters. Decoding keeps the BOM, which
 * `normalizeText` records.
 */
export function decodeText(
  bytes: Buffer,
  file: string,
  platform: NodeJS.Platform = process.platform
): string {
  const name = path.basename(file);
  if (bytes.length > MAX_TEXT_BYTES) throw tooLarge(name, bytes.length);
  const problem = encodingProblem(name, classifyBytes(bytes), platform === 'win32');
  if (problem) throw fail('not-utf8', problem);
  return bytes.toString('utf8');
}

function tooLarge(name: string, size: number): Error {
  const mib = (size / (1024 * 1024)).toFixed(1);
  return fail(
    'invalid-input',
    `${name} is ${mib} MiB, and the app opens files up to 4 MiB. Split it into smaller chapters to review it. The app has not changed the file.`
  );
}

/** The bytes of a text file, refusing an oversized one before reading it all. */
async function readTextBytes(file: string): Promise<Buffer> {
  const stat = await fs.stat(file);
  if (stat.size > MAX_TEXT_BYTES) throw tooLarge(path.basename(file), stat.size);
  return fs.readFile(file);
}

/** A chapter's bytes as read, with what `readChapter` makes of them. */
async function readChapterBytes(file: string): Promise<{ bytes: Buffer; content: FileContent }> {
  const bytes = await readTextBytes(file);
  const normalized = normalizeText(decodeText(bytes, file));
  return {
    bytes,
    content: {
      path: file,
      text: normalized.text,
      hash: hashBytes(bytes),
      eol: normalized.eol,
      bom: normalized.bom,
      trailingNewline: normalized.trailingNewline
    }
  };
}

/** Read a chapter, capturing everything needed to write it back byte-identically. */
export async function readChapter(file: string): Promise<FileContent> {
  return (await readChapterBytes(file)).content;
}

/** Bytes that would be written for the given LF text and shape. */
export function bytesFor(request: Pick<SaveRequest, 'text' | 'eol' | 'bom' | 'trailingNewline'>): Buffer {
  return Buffer.from(restoreText(request.text, request), 'utf8');
}

export interface WriteHooks {
  /** called with the hash just written so the watcher can ignore its own echo */
  onWritten?: (file: string, hash: string) => void;
  /**
   * Step 4 of PLAN 11.3 (h): handed the exact bytes about to be replaced,
   * once the file is known to be the one the caller expects and before
   * anything is written. Main backs them up here (`chapterBackupHooks` in
   * `backups.ts`). If it throws, nothing is written and the save fails with
   * "Could not back up the chapter before saving, so nothing was written:"
   * and its message. What it returns comes back as `SaveResponse.backup`.
   */
  beforeReplace?: (file: string, bytes: Buffer) => Promise<SaveBackup | undefined>;
  /**
   * Step 8: after the chapter is written and its hash remembered. Best
   * effort: the save has already happened, so a failure here never fails it.
   */
  afterWrite?: (file: string) => Promise<void>;
  /** tests replace the rename and the waits between retries */
  atomic?: Pick<AtomicWriteOptions, 'rename' | 'sleep'>;
}

/** A chapter's bytes for a save, with a missing file explained. */
async function readForSave(file: string): Promise<{ bytes: Buffer; content: FileContent }> {
  return readChapterBytes(file).catch((err: unknown) => {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw fail(
        'not-found',
        `The chapter is no longer at ${file}. If you renamed or moved it in Obsidian, open it again from the list; its review comes with it.`
      );
    }
    throw err;
  });
}

/**
 * Save a chapter, in the order of PLAN 11.3 (h). The file is re-read first:
 * when the bytes on disk are not the ones the caller based its decisions on,
 * nothing is written and the fresh contents come back so the caller can rebase
 * and try again (plan section 6.3). When the new bytes are the ones already on
 * disk, nothing is written or backed up, so the file keeps its modified time
 * and Obsidian or a sync tool sees no change (`unchanged`, step 3). Otherwise
 * `beforeReplace` backs up the old bytes (step 4), the file is read once more
 * in case it changed meanwhile (step 5), and only then replaced (step 6).
 */
export async function writeChapter(request: SaveRequest, hooks: WriteHooks = {}): Promise<SaveResponse> {
  const { bytes: onDisk, content: current } = await readForSave(request.path);

  if (current.hash !== request.expectedHash) {
    return { status: 'stale', disk: current };
  }

  const bytes = bytesFor(request);
  if (bytes.equals(onDisk)) return { status: 'written', hash: current.hash, unchanged: true };

  let backup: SaveBackup | undefined;
  if (hooks.beforeReplace) {
    try {
      backup = await hooks.beforeReplace(request.path, onDisk);
    } catch (err) {
      throw fail(
        'io',
        `Could not back up the chapter before saving, so nothing was written: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    // The copy took a moment. Bytes that arrived meanwhile, from Obsidian or a
    // sync, are not in the backup and are not what the caller decided on.
    const again = await readForSave(request.path);
    if (again.content.hash !== current.hash) return { status: 'stale', disk: again.content };
  }

  const outcome = await atomicWriteFile(request.path, bytes, {
    ...hooks.atomic,
    // While Windows refuses the rename, Obsidian may be the one writing.
    beforeRetry: async () => {
      try {
        return hashBytes(await fs.readFile(request.path)) === current.hash ? 'same' : 'changed';
      } catch {
        return 'unreadable';
      }
    }
  });
  if (outcome === 'stale') return { status: 'stale', disk: await readChapter(request.path) };
  const hash = hashBytes(bytes);
  hooks.onWritten?.(request.path, hash);
  if (hooks.afterWrite) await hooks.afterWrite(request.path).catch(() => undefined);
  return backup ? { status: 'written', hash, backup } : { status: 'written', hash };
}

/* ------------------------------------------------------------------ */
/* Creating a chapter                                                  */
/* ------------------------------------------------------------------ */

/** Characters Windows refuses in a file name. */
const ILLEGAL = /[<>:"|?*]/;

/**
 * Control characters are illegal in a file name too. They are tested by code
 * point rather than with a regex literal full of escapes, because a literal
 * control character in the source is exactly the kind of thing an editor round
 * trip mangles (appendix C.18).
 */
function hasControlChar(value: string): boolean {
  for (const ch of value) {
    if ((ch.codePointAt(0) ?? 32) < 0x20) return true;
  }
  return false;
}

/** Names Windows reserves whatever the extension is. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * Where a new chapter would go, or a sentence saying why it cannot go anywhere.
 *
 * This is the only gate in front of `files:create`, so it is deliberately
 * strict: a separator, a traversal, a reserved device name or anything that
 * lands outside the manuscript folder is refused rather than sanitized. The
 * dialog calls it on every keystroke, so it returns a verdict instead of
 * throwing.
 */
export function checkChapterName(
  folder: string,
  name: string,
  extension: ChapterExtension
): NameCheck & { file: string | null } {
  const bad = (problem: string): NameCheck & { file: string | null } => ({
    valid: false,
    problem,
    exists: false,
    path: null,
    file: null
  });

  if (!CHAPTER_EXTENSIONS.includes(extension)) return bad('Choose md or txt.');

  const trimmed = name.trim();
  if (trimmed.length === 0) return bad('');
  if (/[\\/]/.test(trimmed)) return bad('The name cannot contain \\ or /.');
  if (ILLEGAL.test(trimmed) || hasControlChar(trimmed)) {
    return bad('A file name cannot contain < > : " | ? *');
  }
  if (/^\.+$/.test(trimmed)) return bad('Give the file a real name.');
  if (trimmed.endsWith('.') || trimmed.endsWith(' ')) {
    return bad('A file name cannot end with a dot or a space.');
  }

  // The author may type the extension themselves; do not double it.
  const stem = trimmed.replace(/\.(md|txt)$/i, '').trim();
  if (stem.length === 0) return bad('Give the file a name in front of the extension.');
  if (RESERVED.test(stem)) return bad(`${stem} is a name Windows reserves. Pick another.`);

  const root = path.resolve(folder);
  const file = path.resolve(root, `${stem}.${extension}`);
  if (path.dirname(file) !== root) {
    return bad('That name would put the file outside the manuscript folder.');
  }

  return { valid: true, exists: false, path: file, file };
}

/** The same verdict, with the live answer to "is that name taken?". */
export async function checkChapterNameOnDisk(
  folder: string,
  name: string,
  extension: ChapterExtension
): Promise<NameCheck> {
  const verdict = checkChapterName(folder, name, extension);
  if (!verdict.valid || !verdict.file) {
    return { valid: verdict.valid, problem: verdict.problem ?? '', exists: false, path: null };
  }
  return {
    valid: true,
    exists: await exists(verdict.file),
    path: verdict.file
  };
}

/**
 * Create a chapter. The write uses the exclusive-create flag, so it can never
 * touch a file that already exists: the dialog's live "that name is taken"
 * check is a courtesy, this is the guarantee (CLAUDE.md rule 1).
 *
 * A new file is written LF with a trailing newline and no BOM, which is what
 * the rest of the app normalizes to anyway. Once the file exists, Save preserves
 * whatever shape it has.
 */
export async function createChapter(
  folder: string,
  name: string,
  extension: ChapterExtension,
  text: string
): Promise<ChapterFile> {
  const verdict = checkChapterName(folder, name, extension);
  if (!verdict.valid || !verdict.file) {
    throw fail('invalid-input', verdict.problem || 'That file name cannot be used.');
  }

  const normalized = normalizeText(text);
  const bytes = Buffer.from(
    restoreText(normalized.text, { eol: 'lf', bom: false, trailingNewline: true }),
    'utf8'
  );

  await fs.mkdir(folder, { recursive: true });
  try {
    await fs.writeFile(verdict.file, bytes, { flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      throw fail('invalid-input', `A file with this name already exists: ${path.basename(verdict.file)}`);
    }
    throw err;
  }

  const stat = await fs.stat(verdict.file);
  return {
    path: verdict.file,
    relativePath: path.relative(folder, verdict.file).split(path.sep).join('/'),
    name: path.basename(verdict.file),
    size: stat.size,
    mtimeMs: stat.mtimeMs
  };
}

export async function readTextFile(file: string): Promise<string> {
  return normalizeText(decodeText(await readTextBytes(file), file)).text;
}

export async function exists(file: string): Promise<boolean> {
  return fs
    .access(file)
    .then(() => true)
    .catch(() => false);
}
