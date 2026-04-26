import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { generateClient } from 'aws-amplify/data';
import { getUrl } from 'aws-amplify/storage';
import type { Schema } from '../../amplify/data/resource';
import { MixPlayer, type StemTrack } from './MixPlayer';
import { PROJECT_TEMPLATES, type ProjectTemplate } from './templates';
import { decodeSnapshot } from './snapshotUtils';

const client = generateClient<Schema>();

type Project = Schema['Project']['type'];
type Track = Schema['Track']['type'];


interface NewProjectForm {
  title: string;
  description: string;
  bpm: string;
  keySignature: string;
  genre: string;
}

const EMPTY_FORM: NewProjectForm = { title: '', description: '', bpm: '', keySignature: '', genre: '' };

const KEY_OPTIONS = [
  'C major', 'C# major', 'D major', 'D# major', 'E major', 'F major',
  'F# major', 'G major', 'G# major', 'A major', 'A# major', 'B major',
  'C minor', 'C# minor', 'D minor', 'D# minor', 'E minor', 'F minor',
  'F# minor', 'G minor', 'G# minor', 'A minor', 'A# minor', 'B minor',
];

export function ProjectDashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<NewProjectForm>(EMPTY_FORM);
  const [selectedTemplate, setSelectedTemplate] = useState<ProjectTemplate | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const sub = client.models.Project.observeQuery().subscribe({
      next: ({ items }) => setProjects([...items].sort(
        (a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime()
      )),
    });
    return () => sub.unsubscribe();
  }, []);

  const handleCreate = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const result = await client.models.Project.create({
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        bpm: form.bpm ? parseInt(form.bpm, 10) : undefined,
        keySignature: form.keySignature || undefined,
        genre: (form.genre.trim() || selectedTemplate?.genre) || undefined,
      });
      if (result.errors) throw new Error(result.errors[0].message);
      const projectId = result.data?.id;
      if (projectId && selectedTemplate) {
        await Promise.all(
          selectedTemplate.tracks.map((t, i) =>
            client.models.Track.create({
              name: t.name,
              type: t.type,
              stemCategory: t.stemCategory,
              projectId,
              sortOrder: i,
            })
          )
        );
      }
      setShowModal(false);
      setForm(EMPTY_FORM);
      setSelectedTemplate(null);
      if (projectId) navigate(`/project/${projectId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create project');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm('Delete this project? This cannot be undone.')) return;
    await client.models.Project.delete({ id });
  };

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Projects</h1>
        <button className="btn-primary" onClick={() => setShowModal(true)}>+ New project</button>
      </div>

      {projects.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🎛️</div>
          <p>No projects yet. Create one to start versioning your stems.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
          {projects.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              onClick={() => navigate(`/project/${p.id}`)}
              onDelete={(e) => handleDelete(e, p.id)}
            />
          ))}
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => { setShowModal(false); setForm(EMPTY_FORM); setSelectedTemplate(null); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: '560px' }}>
            <h2 className="modal-title">New project</h2>

            {/* Template selector */}
            <div className="form-group">
              <label className="form-label">Template</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 4 }}>
                <button
                  onClick={() => setSelectedTemplate(null)}
                  style={{
                    padding: '8px 10px', borderRadius: 6, cursor: 'pointer', textAlign: 'left',
                    background: !selectedTemplate ? 'var(--bg-hover)' : 'transparent',
                    border: `1px solid ${!selectedTemplate ? 'var(--accent)' : 'var(--border)'}`,
                    color: !selectedTemplate ? 'var(--text-primary)' : 'var(--text-muted)',
                    fontSize: '12px',
                  }}
                >
                  Blank project
                </button>
                {PROJECT_TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setSelectedTemplate(t)}
                    style={{
                      padding: '8px 10px', borderRadius: 6, cursor: 'pointer', textAlign: 'left',
                      background: selectedTemplate?.id === t.id ? 'var(--bg-hover)' : 'transparent',
                      border: `1px solid ${selectedTemplate?.id === t.id ? 'var(--accent)' : 'var(--border)'}`,
                      color: selectedTemplate?.id === t.id ? 'var(--text-primary)' : 'var(--text-muted)',
                      fontSize: '12px',
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: 2 }}>{t.name}</div>
                    <div style={{ fontSize: '10px', opacity: 0.7 }}>{t.tracks.length} stems</div>
                  </button>
                ))}
              </div>
              {selectedTemplate && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
                  {selectedTemplate.tracks.map((t) => (
                    <span key={t.name} style={{ fontSize: '10px', color: 'var(--text-muted)', background: 'var(--bg-hover)', padding: '2px 8px', borderRadius: '999px', border: '1px solid var(--border)' }}>
                      {t.stemCategory}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">Title *</label>
              <input
                type="text"
                placeholder="e.g. Summer EP Track 1"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                autoFocus
              />
            </div>
            <div className="form-group">
              <label className="form-label">Description</label>
              <textarea
                rows={2}
                placeholder="What's this project about?"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                style={{ resize: 'vertical' }}
              />
            </div>
            <div className="form-row">
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">BPM</label>
                <input type="number" placeholder="128" min={20} max={300} value={form.bpm}
                  onChange={(e) => setForm((f) => ({ ...f, bpm: e.target.value }))} />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Key</label>
                <select value={form.keySignature} onChange={(e) => setForm((f) => ({ ...f, keySignature: e.target.value }))}>
                  <option value="">—</option>
                  {KEY_OPTIONS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Genre</label>
                <input
                  type="text"
                  placeholder={selectedTemplate?.genre ?? 'Electronic'}
                  value={form.genre}
                  onChange={(e) => setForm((f) => ({ ...f, genre: e.target.value }))}
                />
              </div>
            </div>

            {error && <p style={{ color: 'var(--accent-red)', fontSize: '13px', margin: '8px 0 0' }}>{error}</p>}

            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => { setShowModal(false); setForm(EMPTY_FORM); setSelectedTemplate(null); }}>Cancel</button>
              <button className="btn-primary" onClick={handleCreate} disabled={saving || !form.title.trim()}>
                {saving ? 'Creating…' : selectedTemplate ? `Create with ${selectedTemplate.name} template` : 'Create project'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ProjectCard({ project, onClick, onDelete }: {
  project: Project;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
}) {
  const created = project.createdAt ? new Date(project.createdAt).toLocaleDateString() : '';
  const [mixStems, setMixStems] = useState<StemTrack[] | null>(null);
  const [loadingMix, setLoadingMix] = useState(false);
  const [showMix, setShowMix] = useState(false);

  const handlePlayMain = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (showMix) { setShowMix(false); return; }
    if (!project.mainBranchId) return;

    if (!mixStems) {
      setLoadingMix(true);
      try {
        const branchRes = await client.models.Branch.get({ id: project.mainBranchId });
        const snapshot = decodeSnapshot(branchRes.data?.snapshot);

        // Load tracks to get names/categories
        const trackRes = await client.models.Track.list({
          filter: { projectId: { eq: project.id } },
        });
        const trackMap = Object.fromEntries((trackRes.data ?? []).map((t: Track) => [t.id, t]));

        const stems = await Promise.all(
          Object.entries(snapshot).map(async ([trackId, versionId]) => {
            const track = trackMap[trackId];
            if (!track || track.type === 'MIX') return null;
            try {
              const vRes = await client.models.Version.get({ id: versionId });
              const key = vRes.data?.proxyS3Key ?? vRes.data?.s3Key;
              if (!key) return null;
              const { url } = await getUrl({ path: key, options: { expiresIn: 3600 } });
              return { id: trackId, name: track.name, category: track.stemCategory, url: url.toString() } as StemTrack;
            } catch {
              return null;
            }
          })
        );
        setMixStems(stems.filter(Boolean) as StemTrack[]);
      } finally {
        setLoadingMix(false);
      }
    }
    setShowMix(true);
  };

  return (
    <div
      className="card"
      onClick={onClick}
      style={{ cursor: 'pointer', transition: 'border-color 0.15s' }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent-dim)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>{project.title}</h3>
        <button
          className="btn-ghost btn-sm"
          onClick={onDelete}
          style={{ flexShrink: 0, padding: '2px 6px', color: 'var(--text-muted)' }}
          title="Delete project"
        >✕</button>
      </div>

      {project.description && (
        <p style={{ margin: '6px 0 0', fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
          {project.description}
        </p>
      )}

      <div className="meta-row" style={{ marginTop: 12 }}>
        {project.bpm && <span className="meta-item"><strong>{project.bpm}</strong> BPM</span>}
        {project.keySignature && <span className="meta-item"><strong>{project.keySignature}</strong></span>}
        {project.genre && <span className="meta-item">{project.genre}</span>}
        <span className="meta-item" style={{ marginLeft: 'auto' }}>{created}</span>
      </div>

      {project.mainBranchId && (
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }} onClick={(e) => e.stopPropagation()}>
          <span style={{ fontSize: '11px', color: 'var(--accent-green)', fontFamily: 'var(--font-mono)' }}>⎇ main</span>
          <button
            className="btn-secondary btn-sm"
            onClick={handlePlayMain}
            disabled={loadingMix}
            style={{ fontSize: '11px' }}
          >
            {loadingMix ? 'Loading…' : showMix ? '▪ Stop' : '▶ Play main'}
          </button>
        </div>
      )}

      {showMix && mixStems && mixStems.length > 0 && (
        <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 14 }} onClick={(e) => e.stopPropagation()}>
          <MixPlayer stems={mixStems} />
        </div>
      )}
    </div>
  );
}
