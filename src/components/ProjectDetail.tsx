import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { generateClient } from 'aws-amplify/data';
import { getUrl } from 'aws-amplify/storage';
import type { Schema } from '../../amplify/data/resource';
import { BulkUploadModal } from './BulkUploadModal';
import { MixPlayer, type StemTrack } from './MixPlayer';

const client = generateClient<Schema>();

type Project = Schema['Project']['type'];
type Track = Schema['Track']['type'];

export function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const [project, setProject] = useState<Project | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [showAddTrack, setShowAddTrack] = useState(false);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [showMixer, setShowMixer] = useState(false);
  const [mixStems, setMixStems] = useState<StemTrack[] | null>(null);
  const [loadingMix, setLoadingMix] = useState(false);
  const [newTrackName, setNewTrackName] = useState('');
  const [newTrackType, setNewTrackType] = useState<'AUDIO' | 'MIDI' | 'INSTRUMENT' | 'MIX'>('AUDIO');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;

    client.models.Project.get({ id: projectId }).then((res) => {
      setProject(res.data);
      setLoading(false);
    });

    const sub = client.models.Track.observeQuery({
      filter: { projectId: { eq: projectId } },
    }).subscribe({
      next: ({ items }) =>
        setTracks(
          [...items].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        ),
    });

    return () => sub.unsubscribe();
  }, [projectId]);

  const handleAddTrack = async () => {
    if (!newTrackName.trim() || !projectId) return;
    setSaving(true);
    try {
      await client.models.Track.create({
        name: newTrackName.trim(),
        type: newTrackType,
        projectId,
        sortOrder: tracks.length,
      });
      setNewTrackName('');
      setNewTrackType('AUDIO');
      setShowAddTrack(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTrack = async (e: React.MouseEvent, trackId: string) => {
    e.stopPropagation();
    if (!confirm('Delete this track and all its versions?')) return;
    await client.models.Track.delete({ id: trackId });
  };

  const handleMixStems = async () => {
    const stemTracks = tracks.filter((t) => t.activeVersionId && t.type !== 'MIX');
    if (stemTracks.length === 0) return;
    setLoadingMix(true);
    setShowMixer(false);
    const results = await Promise.all(
      stemTracks.map(async (t) => {
        try {
          const res = await client.models.Version.get({ id: t.activeVersionId! });
          const key = res.data?.proxyS3Key ?? res.data?.s3Key;
          if (!key) return null;
          const { url } = await getUrl({ path: key, options: { expiresIn: 3600 } });
          return { id: t.id, name: t.name, category: t.stemCategory, url: url.toString() } as StemTrack;
        } catch {
          return null;
        }
      })
    );
    setMixStems(results.filter(Boolean) as StemTrack[]);
    setLoadingMix(false);
    setShowMixer(true);
  };

  if (loading) {
    return <div style={{ color: 'var(--text-muted)', padding: '40px 0' }}>Loading…</div>;
  }

  if (!project) {
    return (
      <div className="empty-state">
        <p>Project not found.</p>
        <Link to="/">Back to projects</Link>
      </div>
    );
  }

  return (
    <>
      <Link to="/" className="back-link">← Projects</Link>

      <div className="page-header">
        <div>
          <h1 className="page-title">{project.title}</h1>
          <div className="meta-row">
            {project.bpm && <span className="meta-item"><strong>{project.bpm}</strong> BPM</span>}
            {project.keySignature && <span className="meta-item"><strong>{project.keySignature}</strong></span>}
            {project.genre && <span className="meta-item">{project.genre}</span>}
          </div>
          {project.description && (
            <p style={{ margin: '8px 0 0', color: 'var(--text-secondary)', fontSize: '13px' }}>
              {project.description}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn-secondary" onClick={() => setShowAddTrack(true)}>
            + Add track
          </button>
          <button className="btn-secondary" onClick={() => setShowBulkUpload(true)}>
            ↑ Upload stems
          </button>
          <button
            className="btn-primary"
            onClick={handleMixStems}
            disabled={loadingMix || tracks.filter((t) => t.activeVersionId && t.type !== 'MIX').length === 0}
            title="Mix all active stems"
          >
            {loadingMix ? 'Loading…' : '⚡ Mix stems'}
          </button>
        </div>
      </div>

      {/* Live mixer */}
      {showMixer && mixStems && (
        <div className="card" style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              ⚡ Live mix — {mixStems.length} stems
            </span>
            <button className="btn-ghost btn-sm" onClick={() => setShowMixer(false)} style={{ color: 'var(--text-muted)' }}>
              ✕
            </button>
          </div>
          <MixPlayer stems={mixStems} />
        </div>
      )}

      {/* MIX tracks */}
      {tracks.filter((t) => t.type === 'MIX').map((track) => (
        <TrackRow
          key={track.id}
          track={track}
          onClick={() => navigate(`/project/${projectId}/track/${track.id}`)}
          onDelete={(e) => handleDeleteTrack(e, track.id)}
        />
      ))}

      <p className="section-title">
        Stems ({tracks.filter((t) => t.type !== 'MIX').length})
      </p>

      {tracks.filter((t) => t.type !== 'MIX').length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🎚️</div>
          <p>No stems yet. Drop your stems to get started.</p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn-secondary" onClick={() => setShowAddTrack(true)}>Add track</button>
            <button className="btn-secondary" onClick={() => setShowBulkUpload(true)}>Upload stems</button>
          </div>
        </div>
      ) : (
        tracks.filter((t) => t.type !== 'MIX').map((track) => (
          <TrackRow
            key={track.id}
            track={track}
            onClick={() => navigate(`/project/${projectId}/track/${track.id}`)}
            onDelete={(e) => handleDeleteTrack(e, track.id)}
          />
        ))
      )}

      {showBulkUpload && (
        <BulkUploadModal
          projectId={projectId!}
          existingTrackCount={tracks.length}
          onClose={() => setShowBulkUpload(false)}
        />
      )}

      {showAddTrack && (
        <div className="modal-overlay" onClick={() => setShowAddTrack(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">Add track</h2>

            <div className="form-group">
              <label className="form-label">Track name *</label>
              <input
                type="text"
                placeholder="e.g. Kick Drum, Lead Synth, Bass Guitar"
                value={newTrackName}
                onChange={(e) => setNewTrackName(e.target.value)}
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleAddTrack()}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Type</label>
              <select
                value={newTrackType}
                onChange={(e) => setNewTrackType(e.target.value as typeof newTrackType)}
              >
                <option value="AUDIO">Audio (WAV, AIFF, FLAC)</option>
                <option value="MIDI">MIDI</option>
                <option value="INSTRUMENT">Instrument / Synth Patch</option>
                <option value="MIX">Mix / Master</option>
              </select>
            </div>

            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setShowAddTrack(false)}>
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={handleAddTrack}
                disabled={saving || !newTrackName.trim()}
              >
                {saving ? 'Adding…' : 'Add track'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function TrackRow({ track, onClick, onDelete }: {
  track: Track;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
}) {
  const typeClass: Record<string, string> = {
    AUDIO: 'badge-audio',
    MIDI: 'badge-midi',
    INSTRUMENT: 'badge-instrument',
    MIX: 'badge-mix',
  };

  return (
    <div className="track-row" onClick={onClick} style={{ cursor: 'pointer' }}>
      <div className="track-name">{track.name}</div>
      <span className={`badge ${typeClass[track.type ?? 'AUDIO']}`}>
        {track.type ?? 'AUDIO'}
      </span>
      {track.stemCategory && (
        <span style={{
          fontSize: '11px',
          color: 'var(--text-secondary)',
          background: 'var(--bg-hover)',
          padding: '2px 8px',
          borderRadius: '999px',
          border: '1px solid var(--border)',
        }}>
          {track.stemCategory}
        </span>
      )}
      <div className="track-controls">
        <button
          className="btn-secondary btn-sm"
          onClick={(e) => { e.stopPropagation(); onClick(); }}
        >
          Open →
        </button>
        <button
          className="btn-ghost btn-sm"
          onClick={onDelete}
          style={{ color: 'var(--text-muted)' }}
          title="Delete track"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
