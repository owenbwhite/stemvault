import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { generateClient } from 'aws-amplify/data';
import { useAuthenticator } from '@aws-amplify/ui-react';
import type { Schema } from '../../amplify/data/resource';

const client = generateClient<Schema>();

type Project = Schema['Project']['type'];
type Track = Schema['Track']['type'];

const TYPE_COLORS: Record<string, string> = {
  SINGLE: 'var(--accent)',
  EP: 'var(--accent-green)',
  LP: '#a78bfa',
};

const KEY_OPTIONS = [
  'C major', 'C# major', 'D major', 'D# major', 'E major', 'F major',
  'F# major', 'G major', 'G# major', 'A major', 'A# major', 'B major',
  'C minor', 'C# minor', 'D minor', 'D# minor', 'E minor', 'F minor',
  'F# minor', 'G minor', 'G# minor', 'A minor', 'A# minor', 'B minor',
];

interface EditProjectForm {
  title: string;
  description: string;
  bpm: string;
  keySignature: string;
  genre: string;
  type: 'SINGLE' | 'EP' | 'LP';
}

export function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>();
  const { user } = useAuthenticator((ctx) => [ctx.user]);
  const navigate = useNavigate();

  const [project, setProject] = useState<Project | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [showAddTrack, setShowAddTrack] = useState(false);
  const [showEditProject, setShowEditProject] = useState(false);
  const [newTrackTitle, setNewTrackTitle] = useState('');
  const [editForm, setEditForm] = useState<EditProjectForm | null>(null);
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

  const isOwner = !!user?.userId && user.userId === project?.ownerId;

  const openEditModal = () => {
    if (!project) return;
    setEditForm({
      title: project.title,
      description: project.description ?? '',
      bpm: project.bpm ? String(project.bpm) : '',
      keySignature: project.keySignature ?? '',
      genre: project.genre ?? '',
      type: (project.type as EditProjectForm['type']) ?? 'SINGLE',
    });
    setShowEditProject(true);
  };

  const handleUpdateProject = async () => {
    if (!editForm || !projectId || !editForm.title.trim()) return;
    setSaving(true);
    try {
      const res = await client.models.Project.update({
        id: projectId,
        title: editForm.title.trim(),
        description: editForm.description.trim() || undefined,
        bpm: editForm.bpm ? parseInt(editForm.bpm, 10) : undefined,
        keySignature: editForm.keySignature || undefined,
        genre: editForm.genre.trim() || undefined,
        type: editForm.type,
      });
      if (res.data) setProject(res.data);
      setShowEditProject(false);
    } finally {
      setSaving(false);
    }
  };

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
          {isOwner && (
            <button className="btn-ghost btn-sm" onClick={openEditModal} style={{ color: 'var(--text-muted)' }}>
              Edit project
            </button>
          )}
          {isOwner && (
            <button className="btn-primary" onClick={() => setShowAddTrack(true)}>+ Add track</button>
          )}
        </div>
      </div>

      <p className="section-title">Tracks ({tracks.length})</p>

      {tracks.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🎵</div>
          <p>No tracks yet. Add your first track to get started.</p>
          {isOwner && (
            <button className="btn-primary" onClick={() => setShowAddTrack(true)}>Add track</button>
          )}
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
              {isOwner && (
                <button
                  className="btn-ghost btn-sm"
                  onClick={(e) => handleDeleteTrack(e, track.id)}
                  style={{ color: 'var(--text-muted)' }}
                  title="Delete track"
                >✕</button>
              )}
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

      {showEditProject && editForm && (
        <div className="modal-overlay" onClick={() => setShowEditProject(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: '520px' }}>
            <h2 className="modal-title">Edit project</h2>

            <div className="form-group">
              <label className="form-label">Type</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['SINGLE', 'EP', 'LP'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setEditForm((f) => f ? { ...f, type: t } : f)}
                    style={{
                      padding: '6px 16px', borderRadius: 6, cursor: 'pointer',
                      background: editForm.type === t ? 'var(--bg-hover)' : 'transparent',
                      border: `1px solid ${editForm.type === t ? (TYPE_COLORS[t] ?? 'var(--accent)') : 'var(--border)'}`,
                      color: editForm.type === t ? 'var(--text-primary)' : 'var(--text-muted)',
                      fontSize: '12px', fontWeight: 600,
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Title *</label>
              <input
                type="text"
                value={editForm.title}
                onChange={(e) => setEditForm((f) => f ? { ...f, title: e.target.value } : f)}
                autoFocus
              />
            </div>
            <div className="form-group">
              <label className="form-label">Description</label>
              <textarea
                rows={2}
                value={editForm.description}
                onChange={(e) => setEditForm((f) => f ? { ...f, description: e.target.value } : f)}
                style={{ resize: 'vertical' }}
              />
            </div>
            <div className="form-row">
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">BPM</label>
                <input type="number" min={20} max={300} value={editForm.bpm}
                  onChange={(e) => setEditForm((f) => f ? { ...f, bpm: e.target.value } : f)} />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Key</label>
                <select value={editForm.keySignature} onChange={(e) => setEditForm((f) => f ? { ...f, keySignature: e.target.value } : f)}>
                  <option value="">—</option>
                  {KEY_OPTIONS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Genre</label>
                <input
                  type="text"
                  value={editForm.genre}
                  onChange={(e) => setEditForm((f) => f ? { ...f, genre: e.target.value } : f)}
                />
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setShowEditProject(false)} disabled={saving}>Cancel</button>
              <button className="btn-primary" onClick={handleUpdateProject} disabled={saving || !editForm.title.trim()}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
