import { classifyStem } from '../components/BulkUploadModal';
import type { StemCategory } from '../components/BulkUploadModal';

declare global {
  interface Window {
    showDirectoryPicker(opts?: { mode?: 'read' | 'readwrite' }): Promise<FileSystemDirectoryHandle>;
  }
}

export interface AlsGroup {
  alsId: number;
  name: string;
  category: StemCategory;
}

export interface AlsData {
  bpm: number | null;
  key: string | null;
  groups: AlsGroup[];
  filename: string;
}

export interface MatchedGroup {
  group: AlsGroup;
  file: File | null;
}

export interface ProjectScan {
  alsFile: File | null;
  audioFiles: File[];
  hasAudio: boolean;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
// Ableton 12 ScaleInformation > Name index → scale name
const SCALE_NAMES = [
  'Major', 'Minor', 'Dorian', 'Mixolydian', 'Lydian', 'Phrygian', 'Locrian',
  'Whole Tone', 'Half-Whole Dim.', 'Whole-Half Dim.', 'Minor Blues',
  'Minor Pentatonic', 'Major Pentatonic', 'Harmonic Minor', 'Melodic Minor',
];
const AUDIO_EXT = /\.(wav|aiff?|flac|mp3|ogg|m4a|aac)$/i;

export async function parseAls(file: File): Promise<AlsData> {
  const arrayBuffer = await file.arrayBuffer();
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(arrayBuffer);
  writer.close();
  const xmlText = await new Response(ds.readable).text();

  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');

  // BPM — in Ableton 12 the Tempo element is nested inside MasterTrack > DeviceChain > Mixer,
  // not a direct child of LiveSet. Use a descendant selector to handle both versions.
  const bpmRaw = doc.querySelector('Tempo > Manual')?.getAttribute('Value');
  const bpmParsed = bpmRaw ? parseFloat(bpmRaw) : NaN;
  const bpm = isNaN(bpmParsed) ? null : bpmParsed;

  // Key — format changed between Ableton versions:
  //   Ableton 11: InKey = semitone index (0–11), IsMinor = boolean
  //   Ableton 12: InKey = boolean (snap-to-scale on/off), key stored in ScaleInformation > Root + Name
  let key: string | null = null;
  const inKeyVal = doc.querySelector('LiveSet > InKey')?.getAttribute('Value');
  if (inKeyVal === 'true' || inKeyVal === 'false') {
    // Ableton 12
    if (inKeyVal === 'true') {
      const rootVal = doc.querySelector('LiveSet > ScaleInformation > Root')?.getAttribute('Value');
      const nameVal = doc.querySelector('LiveSet > ScaleInformation > Name')?.getAttribute('Value');
      const rootIdx = rootVal != null ? parseInt(rootVal, 10) : NaN;
      if (!isNaN(rootIdx) && rootIdx >= 0 && rootIdx < 12) {
        const scaleIdx = nameVal != null ? parseInt(nameVal, 10) : 0;
        key = `${NOTE_NAMES[rootIdx]} ${SCALE_NAMES[scaleIdx] ?? 'Major'}`;
      }
    }
  } else if (inKeyVal != null) {
    // Ableton 11
    const isMinorVal = doc.querySelector('LiveSet > IsMinor')?.getAttribute('Value');
    const noteIdx = parseInt(inKeyVal, 10);
    if (!isNaN(noteIdx) && noteIdx >= 0 && noteIdx < 12) {
      key = `${NOTE_NAMES[noteIdx]} ${isMinorVal === 'true' ? 'minor' : 'major'}`;
    }
  }

  // GroupTracks at root level — TrackGroupId -1 means no parent
  const groups: AlsGroup[] = [];
  for (const gt of doc.querySelectorAll('Tracks > GroupTrack')) {
    const parentId = gt.querySelector(':scope > TrackGroupId')?.getAttribute('Value');
    if (parentId !== '-1') continue;
    const name = gt.querySelector(':scope > Name > EffectiveName')?.getAttribute('Value') ?? '';
    if (!name) continue;
    groups.push({
      alsId: parseInt(gt.getAttribute('Id') ?? '0', 10),
      name,
      category: classifyStem(name),
    });
  }

  return { bpm, key, groups, filename: file.name.replace(/\.als$/i, '') };
}

// ── FileList scanning (webkitdirectory input) ────────────────────────────────

export function scanFromFiles(files: File[]): ProjectScan {
  const alsFile = files.find(f => /\.als$/i.test(f.name)) ?? null;
  const audioFiles = files
    .filter(f => AUDIO_EXT.test(f.name))
    .sort((a, b) => {
      // webkitRelativePath gives the full path; prefer shallower files in matching
      const pathA = (a as File & { webkitRelativePath?: string }).webkitRelativePath ?? a.name;
      const pathB = (b as File & { webkitRelativePath?: string }).webkitRelativePath ?? b.name;
      return pathA.split('/').length - pathB.split('/').length;
    });
  return { alsFile, audioFiles, hasAudio: audioFiles.length > 0 };
}

// ── Folder scanning (FileSystemDirectoryHandle / showDirectoryPicker) ─────────

interface CollectedFile {
  file: File;
  depth: number;
}

async function collectRecursive(
  dirHandle: FileSystemDirectoryHandle,
  depth: number,
  results: CollectedFile[],
): Promise<void> {
  if (depth > 5) return;
  // FileSystemDirectoryHandle is async-iterable in Chrome 86+
  for await (const handle of (dirHandle as unknown as AsyncIterable<FileSystemHandle>)) {
    if (handle.kind === 'file') {
      results.push({ file: await (handle as FileSystemFileHandle).getFile(), depth });
    } else if (handle.kind === 'directory') {
      await collectRecursive(handle as FileSystemDirectoryHandle, depth + 1, results);
    }
  }
}

export async function scanProjectFolder(dirHandle: FileSystemDirectoryHandle): Promise<ProjectScan> {
  const collected: CollectedFile[] = [];
  await collectRecursive(dirHandle, 0, collected);

  const alsFile = collected.find(c => /\.als$/i.test(c.file.name))?.file ?? null;
  // Sort shallower first so shallow matches win ties in matchGroupsToFiles
  const audioFiles = collected
    .filter(c => AUDIO_EXT.test(c.file.name))
    .sort((a, b) => a.depth - b.depth)
    .map(c => c.file);

  return { alsFile, audioFiles, hasAudio: audioFiles.length > 0 };
}

// ── Group–file matching ───────────────────────────────────────────────────────

function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/^\d+\s*[-_.]?\s*/, '') // strip leading "01 " / "01-" track numbers
    .replace(/[_\-]+/g, ' ')
    .trim();
}

function matchScore(groupName: string, audioBasename: string): number {
  const g = normalizeForMatch(groupName);
  const f = normalizeForMatch(audioBasename);
  if (f === g) return 3;
  if (f.includes(g) || g.includes(f)) return 2;
  return 0;
}

export function matchGroupsToFiles(audioFiles: File[], groups: AlsGroup[]): MatchedGroup[] {
  const used = new Set<string>();
  return groups.map(group => {
    let bestScore = 0;
    let bestFile: File | null = null;

    for (const file of audioFiles) {
      if (used.has(file.name)) continue;
      const score = matchScore(group.name, file.name.replace(AUDIO_EXT, ''));
      if (score > bestScore) {
        bestScore = score;
        bestFile = file;
      }
    }

    if (bestFile && bestScore >= 2) {
      used.add(bestFile.name);
      return { group, file: bestFile };
    }
    return { group, file: null };
  });
}
