import { useRef, useState } from 'react';
import { generateClient } from 'aws-amplify/data';
import { uploadData } from 'aws-amplify/storage';
import { fetchAuthSession } from 'aws-amplify/auth';
import type { Schema } from '../../amplify/data/resource';

const client = generateClient<Schema>();

// ── Stem classifier ──────────────────────────────────────────────────────────

export const STEM_CATEGORIES = [
  'Kick', 'Snare', 'Hi-Hat', 'Clap', 'Tom', 'Cymbal', 'Rimshot', 'Shaker',
  'Percussion', 'Drum Loop',
  'Bass', 'Sub Bass',
  'Lead', 'Pad', 'Chord', 'Arp', 'Pluck', 'Synth',
  'Keys', 'Piano', 'Organ', 'Rhodes',
  'Guitar', 'Strings', 'Brass',
  'Vocal', 'Vocal Chop', 'Adlib',
  'FX', 'Riser', 'Downlifter', 'Impact',
  'Loop', 'Sample', 'MIDI', 'Other',
] as const;

export type StemCategory = (typeof STEM_CATEGORIES)[number];

export function classifyStem(filename: string): StemCategory {
  const s = filename.toLowerCase().replace(/[_\-\.]/g, ' ');

  if (/\bkick\b|kik\b|\bbd\b|bass drum/.test(s)) return 'Kick';
  if (/\bsnare\b|\bsnr\b|\bsd\b/.test(s)) return 'Snare';
  if (/hi ?hat|hihat|\bhh\b|open hat|closed hat/.test(s)) return 'Hi-Hat';
  if (/\bclap\b|\bclp\b/.test(s)) return 'Clap';
  if (/\btom\b|floor tom/.test(s)) return 'Tom';
  if (/\bcymbal\b|\bcrash\b|\bride\b/.test(s)) return 'Cymbal';
  if (/\brimshot\b|\brim\b/.test(s)) return 'Rimshot';
  if (/\bshaker\b|\btamb\b|\bclave\b|\bcowbell\b/.test(s)) return 'Shaker';
  if (/\bperc(ussion)?\b/.test(s)) return 'Percussion';
  if (/drum ?loop|loop.{0,6}drum/.test(s)) return 'Drum Loop';

  if (/sub ?bass|subbass/.test(s)) return 'Sub Bass';
  if (/\bbass\b/.test(s)) return 'Bass';

  if (/\blead\b|\bmelody\b|\bmelo\b/.test(s)) return 'Lead';
  if (/\bpad\b/.test(s)) return 'Pad';
  if (/\bchord\b|\bstab\b/.test(s)) return 'Chord';
  if (/\barp(eggio)?\b/.test(s)) return 'Arp';
  if (/\bpluck\b/.test(s)) return 'Pluck';
  if (/\bsynth\b/.test(s)) return 'Synth';

  if (/\bpiano\b|\bkeys\b/.test(s)) return 'Piano';
  if (/\borgan\b|\bhammond\b/.test(s)) return 'Organ';
  if (/\brhodes\b|\bwurlit\b/.test(s)) return 'Rhodes';
  if (/\bguitar\b|\bgtr\b/.test(s)) return 'Guitar';
  if (/\bstrings\b|\bviolin\b|\bviola\b|\bcello\b/.test(s)) return 'Strings';
  if (/\bbrass\b|\bhorn\b|\btrumpet\b|\bsax\b/.test(s)) return 'Brass';

  if (/\bvocal\b|\bvox\b|\bvoc\b/.test(s)) return 'Vocal';
  if (/\bchop\b/.test(s)) return 'Vocal Chop';
  if (/\badlib\b|\bad lib\b/.test(s)) return 'Adlib';

  if (/\briser\b|\bswell\b/.test(s)) return 'Riser';
  if (/\bdownlift\b|down lift/.test(s)) return 'Downlifter';
  if (/\bimpact\b|\bhit\b/.test(s)) return 'Impact';
  if (/\bfx\b|\bsfx\b|\beffect\b/.test(s)) return 'FX';

  if (/\bloop\b/.test(s)) return 'Loop';
  if (/\.mid(i)?$/.test(filename.toLowerCase())) return 'MIDI';

  return 'Other';
}


function isAudio(filename: string) {
  return /\.(wav|aiff?|flac|mp3|ogg|m4a|aac)$/i.test(filename);
}

function isMidi(filename: string) {
  return /\.midi?$/i.test(filename);
}

function fileTypeFromName(filename: string): 'AUDIO' | 'MIDI' | 'INSTRUMENT' {
  if (isMidi(filename)) return 'MIDI';
  return 'AUDIO';
}

// ── Types ────────────────────────────────────────────────────────────────────

type UploadStatus = 'idle' | 'uploading' | 'done' | 'error';

interface StemRow {
  file: File;
  category: StemCategory;
  fileType: 'AUDIO' | 'MIDI' | 'INSTRUMENT';
  status: UploadStatus;
  progress: number;
  error?: string;
}

// ── Component ────────────────────────────────────────────────────────────────

interface BulkUploadModalProps {
  trackId: string;
  existingStemCount: number;
  existingCategories?: StemCategory[];
  onClose: () => void;
}

export function BulkUploadModal({ trackId, existingStemCount, existingCategories = [], onClose }: BulkUploadModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<StemRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  const addFiles = (files: FileList | File[]) => {
    const accepted = Array.from(files).filter((f) => isAudio(f.name) || isMidi(f.name));
    setRows((prev) => {
      const existing = new Set(prev.map((r) => r.file.name));
      const next = accepted
        .filter((f) => !existing.has(f.name))
        .map((f) => ({
          file: f,
          category: classifyStem(f.name),
          fileType: fileTypeFromName(f.name),
          status: 'idle' as UploadStatus,
          progress: 0,
        }));
      return [...prev, ...next];
    });
  };

  const updateRow = <K extends keyof StemRow>(idx: number, key: K, val: StemRow[K]) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [key]: val } : r)));
  };

  const removeRow = (idx: number) => setRows((prev) => prev.filter((_, i) => i !== idx));

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
  };

  const handleUploadAll = async () => {
    const pending = rows.filter((r) => r.status === 'idle');
    if (!pending.length) return;
    setUploading(true);

    await Promise.all(
      rows.map(async (row, idx) => {
        if (row.status !== 'idle') return;
        const { identityId } = await fetchAuthSession();
        const entityId = identityId ?? 'unknown';

        try {
          // 1. Create Stem record
          const stemResult = await client.models.Stem.create({
            name: row.category,
            type: row.fileType,
            stemCategory: row.category,
            trackId,
            sortOrder: existingStemCount + idx,
            isActive: true,
          });
          if (stemResult.errors || !stemResult.data) {
            throw new Error(stemResult.errors?.[0]?.message ?? 'Failed to create stem');
          }
          const stemId = stemResult.data.id;

          // 2. Upload file
          const ext = row.file.name.split('.').pop() ?? 'wav';
          const s3Key = `stems/${entityId}/stems/${stemId}/${Date.now()}.${ext}`;

          updateRow(idx, 'status', 'uploading');

          await uploadData({
            path: s3Key,
            data: row.file,
            options: {
              contentType: row.file.type || 'application/octet-stream',
              onProgress: ({ transferredBytes, totalBytes }) => {
                if (totalBytes) updateRow(idx, 'progress', Math.round((transferredBytes / totalBytes) * 100));
              },
            },
          }).result;

          // 3. Create StemVersion record
          const versionResult = await client.models.StemVersion.create({
            stemId,
            s3Key,
            versionLabel: 'v1',
            fileSizeBytes: row.file.size,
          });
          if (versionResult.errors || !versionResult.data) {
            throw new Error(versionResult.errors?.[0]?.message ?? 'Failed to create version');
          }

          // 4. Set as active version
          await client.models.Stem.update({ id: stemId, activeVersionId: versionResult.data.id });

          updateRow(idx, 'status', 'done');
        } catch (e) {
          updateRow(idx, 'status', 'error');
          updateRow(idx, 'error', e instanceof Error ? e.message : 'Upload failed');
        }
      })
    );

    setUploading(false);
  };

  const doneCount = rows.filter((r) => r.status === 'done').length;
  const errorCount = rows.filter((r) => r.status === 'error').length;
  const allDone = rows.length > 0 && rows.every((r) => r.status === 'done' || r.status === 'error');
  const idleCount = rows.filter((r) => r.status === 'idle').length;

  return (
    <div className="modal-overlay" onClick={!uploading ? onClose : undefined}>
      <div
        className="modal"
        style={{ width: '780px', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="modal-title" style={{ margin: '0 0 16px' }}>Upload stems</h2>

        <div
          ref={dropRef}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: '2px dashed var(--border)', borderRadius: '10px', padding: '28px',
            textAlign: 'center', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '13px',
            flexShrink: 0, transition: 'border-color 0.15s, background 0.15s',
          }}
          onDragEnter={(e) => { e.preventDefault(); if (dropRef.current) dropRef.current.style.borderColor = 'var(--accent)'; }}
          onDragLeave={() => { if (dropRef.current) dropRef.current.style.borderColor = 'var(--border)'; }}
        >
          <div style={{ fontSize: '24px', marginBottom: '8px' }}>🎛</div>
          Drop audio files here or <span style={{ color: 'var(--accent)' }}>browse</span>
          <div style={{ marginTop: '4px', fontSize: '11px' }}>WAV · AIFF · FLAC · MP3 · MIDI — multiple files OK</div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".wav,.aiff,.aif,.flac,.mp3,.ogg,.mid,.midi"
            style={{ display: 'none' }}
            onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }}
          />
        </div>

        {rows.length > 0 && (
          <div style={{ flex: 1, overflowY: 'auto', marginTop: '16px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  <th style={{ textAlign: 'left', padding: '4px 6px', width: '30%' }}>Type</th>
                  <th style={{ textAlign: 'left', padding: '4px 6px', width: '10%' }}>Format</th>
                  <th style={{ textAlign: 'left', padding: '4px 6px', width: '28%' }}>File</th>
                  <th style={{ textAlign: 'left', padding: '4px 6px', width: '16%' }}>Status</th>
                  <th style={{ padding: '4px 6px', width: '6%' }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <tr
                    key={row.file.name}
                    style={{
                      borderTop: '1px solid var(--border-subtle)',
                      background: row.status === 'error' ? 'rgba(239,68,68,0.05)' :
                                  row.status === 'done' ? 'rgba(16,185,129,0.05)' : undefined,
                    }}
                  >
                    <td style={{ padding: '6px 6px' }}>
                      {(() => {
                        const takenByBatch = new Set(rows.filter((r, i) => i !== idx && r.status === 'idle').map((r) => r.category));
                        const available = STEM_CATEGORIES.filter((c) => c === row.category || (!existingCategories.includes(c) && !takenByBatch.has(c)));
                        return (
                          <select
                            value={row.category}
                            onChange={(e) => updateRow(idx, 'category', e.target.value as StemCategory)}
                            disabled={row.status !== 'idle'}
                            style={{ fontSize: '12px', padding: '3px 6px' }}
                          >
                            {available.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                        );
                      })()}
                    </td>
                    <td style={{ padding: '6px 6px' }}>
                      <span className={`badge ${row.fileType === 'MIDI' ? 'badge-midi' : 'badge-audio'}`} style={{ fontSize: '10px' }}>
                        {row.fileType}
                      </span>
                    </td>
                    <td style={{ padding: '6px 6px', color: 'var(--text-muted)', maxWidth: 0 }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.file.name}</div>
                      <div style={{ fontSize: '10px', marginTop: '1px' }}>{(row.file.size / 1024 / 1024).toFixed(1)} MB</div>
                    </td>
                    <td style={{ padding: '6px 6px' }}>
                      {row.status === 'idle' && <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      {row.status === 'uploading' && (
                        <div>
                          <div style={{ height: '3px', background: 'var(--border)', borderRadius: '2px', overflow: 'hidden' }}>
                            <div style={{ width: `${row.progress}%`, height: '100%', background: 'var(--accent)', transition: 'width 0.2s' }} />
                          </div>
                          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>{row.progress}%</div>
                        </div>
                      )}
                      {row.status === 'done' && <span style={{ color: 'var(--accent-green)' }}>✓ Done</span>}
                      {row.status === 'error' && <span style={{ color: 'var(--accent-red)', fontSize: '11px' }} title={row.error}>✗ Error</span>}
                    </td>
                    <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                      {row.status === 'idle' && (
                        <button className="btn-ghost btn-sm" onClick={() => removeRow(idx)} style={{ padding: '1px 5px', color: 'var(--text-muted)' }}>✕</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '16px', flexShrink: 0 }}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            {rows.length > 0 && !uploading && !allDone && (
              <>{rows.length} file{rows.length !== 1 ? 's' : ''} ready — edit names and categories before uploading</>
            )}
            {uploading && <>{doneCount} / {rows.length} uploaded…</>}
            {allDone && (
              <span style={{ color: errorCount ? 'var(--accent-orange)' : 'var(--accent-green)' }}>
                {doneCount} uploaded{errorCount ? `, ${errorCount} failed` : ''}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn-secondary" onClick={onClose} disabled={uploading}>
              {allDone ? 'Close' : 'Cancel'}
            </button>
            {!allDone && (
              <button className="btn-primary" onClick={handleUploadAll} disabled={uploading || idleCount === 0}>
                {uploading ? `Uploading… ${doneCount}/${rows.length}` : `Upload ${idleCount} stem${idleCount !== 1 ? 's' : ''}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
