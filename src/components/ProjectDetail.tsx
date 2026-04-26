import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';

const client = generateClient<Schema>();

type Project = Schema['Project']['type'];
type Track = Schema['Track']['type'];

const TYPE_COLORS: Record<string, string> = {
  SINGLE: 'var(--accent)',
  EP: 'var(--accent-green)',
  LP: '#a78bfa',
};

export function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const [project, setProject] = useState<Project | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [showAddTrack, setShowAddTrack] = useState(false);
  const [newTrackTitle, setNewTrackTitle] = useState('');
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
      next: ({ items }) => setTracks([...items].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))),
    });
    return () => sub.unsubscribe();
  }, [projectId]);

  const handleAddTrack = async () => {
    if (!newTrackTitle.trim() || !projectId) return;
    setSaving(true);
    try {
      await client.models.Track.create({
        title: newTrackTitle.trim(),
        projectId,
        sortOrder: tracks.length,
      });
      setNewTrackTitle('');
      setShowAddTrack(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTrack = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm('Delete this track? This cannot be undone.')) return;
    await client.models.Track.delete({ id });
  };

  if (loading) return <div style={{ color: 'var(--text-muted)', padding: '40px 0' }}>Loading…</div>;
  if (!project) return (
    <div className="empty-state">
      <p>Project not found.</p>
      <Link to="/">Back to projects</Link>
    </div>
  );

  return (
    <>
      <Link to="/" className="back-link">← Projects</Link>

      <div className="page-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            {project.type && (
              <span style={{
                fontSize: '9px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase',
                color: TYPE_COLORS[project.type] ?? 'var(--text-muted)',
                border: `1px solid ${TYPE_COLORS[project.type] ?? 'var(--border)'}`,
                padding: '1px 6px', borderRadius: '4px',
              }}>
                {project.type}
              </span>
            )}
            <h1 className="page-title">{project.title}</h1>
          </div>
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
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button className="btn-secondary" disabled title="Coming soon">
            Publish
          </button>
          <button className="btn-primary" onClick={() => setShowAddTrack(true)}>+ Add track</button>
        </div>
      </div>

      <p className="section-title">Tracks ({tracks.length})</p>

      {tracks.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🎵</div>
          <p>No tracks yet. Add your first track to get started.</p>
          <button className="btn-primary" onClick={() => setShowAddTrack(true)}>Add track</button>
        </div>
      ) : (
        tracks.map((track, idx) => (
          <div
            key={track.id}
            className="track-row"
            onClick={() => navigate(`/project/${projectId}/track/${track.id}`)}
            style={{ cursor: 'pointer' }}
          >
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', minWidth: 20 }}>
              {String(idx + 1).padStart(2, '0')}
            </span>
            <div className="track-name">{track.title}</div>
            {track.isRemix && (
              <span style={{ fontSize: '10px', fontWeight: 600, color: '#a78bfa', border: '1px solid #a78bfa', padding: '1px 6px', borderRadius: '4px' }}>
                REMIX
              </span>
            )}
            <div className="track-controls">
              <button
                className="btn-secondary btn-sm"
                onClick={(e) => { e.stopPropagation(); navigate(`/project/${projectId}/track/${track.id}`); }}
              >
                Open →
              </button>
              <button
                className="btn-ghost btn-sm"
                onClick={(e) => handleDeleteTrack(e, track.id)}
                style={{ color: 'var(--text-muted)' }}
                title="Delete track"
              >✕</button>
            </div>
          </div>
        ))
      )}

      {showAddTrack && (
        <div className="modal-overlay" onClick={() => setShowAddTrack(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">Add track</h2>
            <div className="form-group">
              <label className="form-label">Title *</label>
              <input
                type="text"
                placeholder="e.g. Track 1, Chorus, Verse 2"
                value={newTrackTitle}
                onChange={(e) => setNewTrackTitle(e.target.value)}
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleAddTrack()}
              />
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setShowAddTrack(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleAddTrack} disabled={saving || !newTrackTitle.trim()}>
                {saving ? 'Adding…' : 'Add track'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
