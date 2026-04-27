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

export const KEY_OPTIONS = [
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

interface EditTrackForm {
  title: string;
  bpm: string;
  keySignature: string;
}

interface AddTrackForm {
  title: string;
  bpm: string;
  keySignature: string;
}

export function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>();
  const { user } = useAuthenticator((ctx) => [ctx.user]);
  const navigate = useNavigate();

  const [project, setProject] = useState<Project | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [showAddTrack, setShowAddTrack] = useState(false);
  const [showEditProject, setShowEditProject] = useState(false);
  const [showEditMarketing, setShowEditMarketing] = useState(false);
  const [addTrackForm, setAddTrackForm] = useState<AddTrackForm>({ title: '', bpm: '', keySignature: '' });
  const [editForm, setEditForm] = useState<EditProjectForm | null>(null);
  const [marketingForm, setMarketingForm] = useState('');
  const [editingTrack, setEditingTrack] = useState<Track | null>(null);
  const [editTrackForm, setEditTrackForm] = useState<EditTrackForm | null>(null);
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

  const openEditMarketing = () => {
    setMarketingForm(project?.marketingNotes ?? '');
    setShowEditMarketing(true);
  };

  const openEditTrack = (track: Track) => {
    setEditingTrack(track);
    setEditTrackForm({
      title: track.title,
      bpm: track.bpm ? String(track.bpm) : '',
      keySignature: track.keySignature ?? '',
    });
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

  const handleUpdateMarketing = async () => {
    if (!projectId) return;
    setSaving(true);
    try {
      const res = await client.models.Project.update({
        id: projectId,
        marketingNotes: marketingForm.trim() || undefined,
      });
      if (res.data) setProject(res.data);
      setShowEditMarketing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateTrack = async () => {
    if (!editingTrack || !editTrackForm || !editTrackForm.title.trim()) return;
    setSaving(true);
    try {
      await client.models.Track.update({
        id: editingTrack.id,
        title: editTrackForm.title.trim(),
        bpm: editTrackForm.bpm ? parseInt(editTrackForm.bpm, 10) : undefined,
        keySignature: editTrackForm.keySignature || undefined,
      });
      setEditingTrack(null);
      setEditTrackForm(null);
    } finally {
      setSaving(false);
    }
  };

  const handleAddTrack = async () => {
    if (!addTrackForm.title.trim() || !projectId) return;
    setSaving(true);
    try {
      await client.models.Track.create({
        title: addTrackForm.title.trim(),
        projectId,
        sortOrder: tracks.length,
        bpm: addTrackForm.bpm ? parseInt(addTrackForm.bpm, 10) : undefined,
        keySignature: addTrackForm.keySignature || undefined,
      });
      setAddTrackForm({ title: '', bpm: '', keySignature: '' });
      setShowAddTrack(false);
    } finally {
      setSaving(false);
    }
  };

  const handleMoveTrack = async (e: React.MouseEvent, trackId: string, dir: 'up' | 'down') => {
    e.stopPropagation();
    const idx = tracks.findIndex((t) => t.id === trackId);
    if (idx < 0) return;
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= tracks.length) return;
    const a = tracks[idx];
    const b = tracks[swapIdx];
    await Promise.all([
      client.models.Track.update({ id: a.id, sortOrder: b.sortOrder ?? swapIdx }),
      client.models.Track.update({ id: b.id, sortOrder: a.sortOrder ?? idx }),
    ]);
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

      {/* ── Track list ─────────────────────────────────────────────────────── */}
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
            {track.bpm && (
              <span className="meta-item" style={{ fontSize: '11px' }}>{track.bpm} BPM</span>
            )}
            {track.keySignature && (
              <span className="meta-item" style={{ fontSize: '11px' }}>{track.keySignature}</span>
            )}
            {track.isRemix && (
              <span style={{ fontSize: '10px', fontWeight: 600, color: '#a78bfa', border: '1px solid #a78bfa', padding: '1px 6px', borderRadius: '4px' }}>
                REMIX
              </span>
            )}
            <div className="track-controls">
              {isOwner && (
                <>
                  <button
                    className="btn-ghost btn-sm"
                    title="Move up"
                    onClick={(e) => handleMoveTrack(e, track.id, 'up')}
                    disabled={idx === 0}
                    style={{ padding: '1px 6px', color: 'var(--text-muted)', opacity: idx === 0 ? 0.3 : 1 }}
                  >↑</button>
                  <button
                    className="btn-ghost btn-sm"
                    title="Move down"
                    onClick={(e) => handleMoveTrack(e, track.id, 'down')}
                    disabled={idx === tracks.length - 1}
                    style={{ padding: '1px 6px', color: 'var(--text-muted)', opacity: idx === tracks.length - 1 ? 0.3 : 1 }}
                  >↓</button>
                  <button
                    className="btn-ghost btn-sm"
                    onClick={(e) => { e.stopPropagation(); openEditTrack(track); }}
                    style={{ color: 'var(--text-muted)' }}
                  >Edit</button>
                </>
              )}
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

      {/* ── Marketing ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 40, marginBottom: 8 }}>
        <p className="section-title" style={{ margin: 0 }}>Marketing</p>
        {isOwner && (
          <button className="btn-ghost btn-sm" onClick={openEditMarketing} style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
            Edit
          </button>
        )}
      </div>

      {project.marketingNotes ? (
        <div className="card">
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
            {project.marketingNotes}
          </p>
        </div>
      ) : (
        <div className="empty-state" style={{ padding: '24px 0' }}>
          <p style={{ margin: 0 }}>No marketing notes yet.{isOwner ? ' Click Edit to add release info, links, and promo notes.' : ''}</p>
        </div>
      )}

      {/* ── Modals ─────────────────────────────────────────────────────────── */}

      {showAddTrack && (
        <div className="modal-overlay" onClick={() => setShowAddTrack(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: '480px' }}>
            <h2 className="modal-title">Add track</h2>
            <div className="form-group">
              <label className="form-label">Title *</label>
              <input
                type="text"
                placeholder="e.g. Track 1, Intro, Verse"
                value={addTrackForm.title}
                onChange={(e) => setAddTrackForm((f) => ({ ...f, title: e.target.value }))}
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleAddTrack()}
              />
            </div>
            <div className="form-row">
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">BPM</label>
                <input
                  type="number" min={20} max={300}
                  value={addTrackForm.bpm}
                  onChange={(e) => setAddTrackForm((f) => ({ ...f, bpm: e.target.value }))}
                />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Key</label>
                <select value={addTrackForm.keySignature} onChange={(e) => setAddTrackForm((f) => ({ ...f, keySignature: e.target.value }))}>
                  <option value="">—</option>
                  {KEY_OPTIONS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setShowAddTrack(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleAddTrack} disabled={saving || !addTrackForm.title.trim()}>
                {saving ? 'Adding…' : 'Add track'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editingTrack && editTrackForm && (
        <div className="modal-overlay" onClick={() => { setEditingTrack(null); setEditTrackForm(null); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: '480px' }}>
            <h2 className="modal-title">Edit track</h2>
            <div className="form-group">
              <label className="form-label">Title *</label>
              <input
                type="text"
                value={editTrackForm.title}
                onChange={(e) => setEditTrackForm((f) => f ? { ...f, title: e.target.value } : f)}
                autoFocus
              />
            </div>
            <div className="form-row">
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">BPM</label>
                <input
                  type="number" min={20} max={300}
                  value={editTrackForm.bpm}
                  onChange={(e) => setEditTrackForm((f) => f ? { ...f, bpm: e.target.value } : f)}
                />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Key</label>
                <select value={editTrackForm.keySignature} onChange={(e) => setEditTrackForm((f) => f ? { ...f, keySignature: e.target.value } : f)}>
                  <option value="">—</option>
                  {KEY_OPTIONS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => { setEditingTrack(null); setEditTrackForm(null); }} disabled={saving}>Cancel</button>
              <button className="btn-primary" onClick={handleUpdateTrack} disabled={saving || !editTrackForm.title.trim()}>
                {saving ? 'Saving…' : 'Save changes'}
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

      {showEditMarketing && (
        <div className="modal-overlay" onClick={() => setShowEditMarketing(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: '520px' }}>
            <h2 className="modal-title">Marketing notes</h2>
            <p style={{ margin: '0 0 16px', fontSize: '13px', color: 'var(--text-secondary)' }}>
              Release info, DSP links, promo notes, press contacts — anything relevant.
            </p>
            <div className="form-group">
              <textarea
                rows={8}
                placeholder="Release date: 2026-XX-XX&#10;Platforms: Spotify, Apple Music, Bandcamp&#10;Press kit: https://...&#10;&#10;Notes..."
                value={marketingForm}
                onChange={(e) => setMarketingForm(e.target.value)}
                style={{ resize: 'vertical', fontFamily: 'var(--font-mono)', fontSize: '12px' }}
                autoFocus
              />
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setShowEditMarketing(false)} disabled={saving}>Cancel</button>
              <button className="btn-primary" onClick={handleUpdateMarketing} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
