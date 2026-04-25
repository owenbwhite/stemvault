import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { generateClient } from 'aws-amplify/data';
import { uploadData, getUrl } from 'aws-amplify/storage';
import { useAuthenticator } from '@aws-amplify/ui-react';
import type { Schema } from '../../amplify/data/resource';
import { AudioPlayer } from './AudioPlayer';
import { MidiDiff } from './MidiDiff';

const client = generateClient<Schema>();

type Track = Schema['Track']['type'];
type Version = Schema['Version']['type'];

interface VersionWithUrl extends Version {
  playbackUrl?: string;
}

export function TrackDetail() {
  const { projectId, trackId } = useParams<{ projectId: string; trackId: string }>();
  const { user } = useAuthenticator((ctx) => [ctx.user]);

  const [track, setTrack] = useState<Track | null>(null);
  const [versions, setVersions] = useState<VersionWithUrl[]>([]);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [diffVersionId, setDiffVersionId] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!trackId) return;
    client.models.Track.get({ id: trackId }).then((res) => {
      setTrack(res.data);
      setActiveVersionId(res.data?.activeVersionId ?? null);
      setLoading(false);
    });

    const sub = client.models.Version.observeQuery({
      filter: { trackId: { eq: trackId } },
    }).subscribe({
      next: async ({ items }) => {
        const sorted = [...items].sort(
          (a, b) =>
            new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime()
        );
        const withUrls = await Promise.all(
          sorted.map(async (v) => {
            if (!v.proxyS3Key && !v.s3Key) return v as VersionWithUrl;
            try {
              const key = v.proxyS3Key ?? v.s3Key;
              const { url } = await getUrl({
                path: key!,
                options: { expiresIn: 3600 },
              });
              return { ...v, playbackUrl: url.toString() } as VersionWithUrl;
            } catch {
              return v as VersionWithUrl;
            }
          })
        );
        setVersions(withUrls);
        if (withUrls.length > 0 && !selectedVersionId) {
          setSelectedVersionId(withUrls[0].id);
        }
      },
    });
    return () => sub.unsubscribe();
  }, [trackId, selectedVersionId]);

  const handleHotswap = async (versionId: string) => {
    if (!trackId) return;
    await client.models.Track.update({ id: trackId, activeVersionId: versionId });
    setActiveVersionId(versionId);
  };

  const selectedVersion = versions.find((v) => v.id === selectedVersionId);
  const diffVersion = diffVersionId ? versions.find((v) => v.id === diffVersionId) : null;
  const activeVersion = versions.find((v) => v.id === activeVersionId);

  if (loading) {
    return <div style={{ color: 'var(--text-muted)', padding: '40px 0' }}>Loading…</div>;
  }

  if (!track) {
    return (
      <div className="empty-state">
        <p>Track not found.</p>
        <Link to={`/project/${projectId}`}>Back to project</Link>
      </div>
    );
  }

  const typeClass: Record<string, string> = {
    AUDIO: 'badge-audio',
    MIDI: 'badge-midi',
    INSTRUMENT: 'badge-instrument',
  };

  return (
    <>
      <Link to={`/project/${projectId}`} className="back-link">← Project</Link>

      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h1 className="page-title">{track.name}</h1>
          <span className={`badge ${typeClass[track.type ?? 'AUDIO']}`}>
            {track.type ?? 'AUDIO'}
          </span>
        </div>
        <button className="btn-primary" onClick={() => setShowUpload(true)}>
          + Upload version
        </button>
      </div>

      {/* Active version player */}
      {activeVersion?.playbackUrl && (
        <div className="card" style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--accent-green)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              ● Active
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--accent)' }}>
              {activeVersion.versionLabel ?? `v${versions.length - versions.indexOf(activeVersion)}`}
            </span>
            {activeVersion.notes && (
              <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{activeVersion.notes}</span>
            )}
          </div>
          <AudioPlayer
            src={activeVersion.playbackUrl}
            waveformData={activeVersion.waveformData as number[] | null}
          />
          <VersionMeta version={activeVersion} />
        </div>
      )}

      {/* Version history */}
      <p className="section-title">
        Version history ({versions.length})
        {versions.length > 1 && (
          <span style={{ marginLeft: 8, fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--text-muted)' }}>
            — click a version to preview, select two to diff
          </span>
        )}
      </p>

      {versions.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📂</div>
          <p>No versions yet. Upload a stem to start tracking.</p>
        </div>
      ) : (
        versions.map((v, idx) => {
          const label = v.versionLabel ?? `v${versions.length - idx}`;
          const isActive = v.id === activeVersionId;
          const isSelected = v.id === selectedVersionId;
          const isDiff = v.id === diffVersionId;

          return (
            <div
              key={v.id}
              className={`version-row${isActive ? ' active' : ''}`}
              style={{
                cursor: 'pointer',
                outline: isSelected && !isActive ? '1px solid var(--accent-blue)' : undefined,
                outlineOffset: '-1px',
              }}
              onClick={() => setSelectedVersionId(v.id)}
            >
              <span className="version-label">{label}</span>
              <span className="version-notes">{v.notes ?? '—'}</span>
              <span className="version-meta">
                {new Date(v.createdAt!).toLocaleString()}
              </span>

              <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                {isActive ? (
                  <span style={{ fontSize: '11px', color: 'var(--accent-green)', padding: '2px 8px' }}>active</span>
                ) : (
                  <button
                    className="btn-secondary btn-sm"
                    onClick={(e) => { e.stopPropagation(); handleHotswap(v.id); }}
                    title="Set as active version (hotswap)"
                  >
                    Hotswap ⚡
                  </button>
                )}
                <button
                  className={`btn-sm ${isDiff ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setDiffVersionId(isDiff ? null : v.id);
                  }}
                  title="Select for diff"
                  style={{ fontSize: '11px' }}
                >
                  Diff
                </button>
              </div>
            </div>
          );
        })
      )}

      {/* Preview player for selected version */}
      {selectedVersion?.playbackUrl && selectedVersion.id !== activeVersionId && (
        <div className="card" style={{ marginTop: '20px' }}>
          <p className="section-title" style={{ margin: '0 0 12px' }}>
            Preview — {selectedVersion.versionLabel ?? `v${versions.length - versions.indexOf(selectedVersion)}`}
          </p>
          <AudioPlayer
            src={selectedVersion.playbackUrl}
            waveformData={selectedVersion.waveformData as number[] | null}
          />
          <VersionMeta version={selectedVersion} />
        </div>
      )}

      {/* MIDI diff */}
      {track.type === 'MIDI' && selectedVersion && diffVersion && (
        <div className="card" style={{ marginTop: '20px' }}>
          <MidiDiff
            labelA={selectedVersion.versionLabel ?? 'Version A'}
            labelB={diffVersion.versionLabel ?? 'Version B'}
            metadataA={selectedVersion.midiMetadata as Record<string, unknown> | null}
            metadataB={diffVersion.midiMetadata as Record<string, unknown> | null}
          />
        </div>
      )}

      {showUpload && (
        <UploadModal
          trackId={trackId!}
          userId={user?.userId ?? ''}
          trackType={track.type ?? 'AUDIO'}
          onClose={() => setShowUpload(false)}
        />
      )}
    </>
  );
}

function VersionMeta({ version }: { version: Version }) {
  const parts: string[] = [];
  if (version.sampleRate) parts.push(`${version.sampleRate / 1000}kHz`);
  if (version.bitDepth) parts.push(`${version.bitDepth}-bit`);
  if (version.channels) parts.push(version.channels === 1 ? 'Mono' : 'Stereo');
  if (version.durationSeconds) {
    const m = Math.floor(version.durationSeconds / 60);
    const s = Math.floor(version.durationSeconds % 60);
    parts.push(`${m}:${s.toString().padStart(2, '0')}`);
  }
  if (version.normalizedLufs) parts.push(`${version.normalizedLufs.toFixed(1)} LUFS`);
  if (version.fileSizeBytes) parts.push(`${(version.fileSizeBytes / 1024 / 1024).toFixed(1)} MB`);

  if (parts.length === 0) return null;

  return (
    <div className="meta-row" style={{ marginTop: '10px' }}>
      {parts.map((p) => (
        <span key={p} className="meta-item">{p}</span>
      ))}
    </div>
  );
}

interface UploadModalProps {
  trackId: string;
  userId: string;
  trackType: string;
  onClose: () => void;
}

function UploadModal({ trackId, userId, trackType, onClose }: UploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState('');
  const [notes, setNotes] = useState('');
  const [sampleRate, setSampleRate] = useState('');
  const [bitDepth, setBitDepth] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const isMidi = trackType === 'MIDI';
  const acceptedFormats = isMidi ? '.mid,.midi' : '.wav,.aiff,.aif,.flac,.mp3,.ogg';

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    setProgress(0);

    try {
      // Path: {userId}/stems/{trackId}/{timestamp}.{ext}
      // {userId} must be the first segment to satisfy Amplify storage {entity_id} constraint
      const ext = file.name.split('.').pop() ?? 'wav';
      const timestamp = Date.now();
      const s3Key = `${userId}/stems/${trackId}/${timestamp}.${ext}`;

      await uploadData({
        path: s3Key,
        data: file,
        options: {
          contentType: file.type || 'application/octet-stream',
          onProgress: ({ transferredBytes, totalBytes }) => {
            if (totalBytes) setProgress(Math.round((transferredBytes / totalBytes) * 100));
          },
        },
      }).result;

      const result = await client.models.Version.create({
        trackId,
        s3Key,
        versionLabel: label.trim() || undefined,
        notes: notes.trim() || undefined,
        fileSizeBytes: file.size,
        sampleRate: sampleRate ? parseInt(sampleRate, 10) : undefined,
        bitDepth: bitDepth ? parseInt(bitDepth, 10) : undefined,
      });

      if (result.errors) throw new Error(result.errors[0].message);

      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: '520px' }}>
        <h2 className="modal-title">Upload version</h2>

        <div className="form-group">
          <label className="form-label">File *</label>
          <input
            type="file"
            accept={acceptedFormats}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            style={{ padding: '6px 8px', cursor: 'pointer' }}
          />
          {file && (
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
              {file.name} — {(file.size / 1024 / 1024).toFixed(2)} MB
            </div>
          )}
        </div>

        <div className="form-row">
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Version label</label>
            <input
              type="text"
              placeholder="v2_more_reverb"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Notes</label>
          <input
            type="text"
            placeholder="What changed in this version?"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        {!isMidi && (
          <div className="form-row">
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Sample rate</label>
              <select value={sampleRate} onChange={(e) => setSampleRate(e.target.value)}>
                <option value="">Unknown</option>
                <option value="44100">44.1 kHz</option>
                <option value="48000">48 kHz</option>
                <option value="88200">88.2 kHz</option>
                <option value="96000">96 kHz</option>
                <option value="192000">192 kHz</option>
              </select>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Bit depth</label>
              <select value={bitDepth} onChange={(e) => setBitDepth(e.target.value)}>
                <option value="">Unknown</option>
                <option value="16">16-bit</option>
                <option value="24">24-bit</option>
                <option value="32">32-bit float</option>
              </select>
            </div>
          </div>
        )}

        {uploading && (
          <div style={{ marginTop: '8px' }}>
            <div style={{ height: '4px', background: 'var(--border)', borderRadius: '2px', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${progress}%`,
                  height: '100%',
                  background: 'var(--accent)',
                  transition: 'width 0.2s',
                }}
              />
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
              Uploading… {progress}%
            </div>
          </div>
        )}

        {error && (
          <p style={{ color: 'var(--accent-red)', fontSize: '13px', margin: '8px 0 0' }}>{error}</p>
        )}

        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '12px', lineHeight: 1.5 }}>
          After upload, the audio processor Lambda will generate a low-res proxy and waveform data automatically.
        </div>

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose} disabled={uploading}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={handleUpload}
            disabled={uploading || !file}
          >
            {uploading ? `Uploading ${progress}%…` : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
}
