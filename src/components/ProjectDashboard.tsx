import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';

const client = generateClient<Schema>();

type Project = Schema['Project']['type'];

interface NewProjectForm {
  title: string;
  description: string;
  bpm: string;
  keySignature: string;
  genre: string;
}

const EMPTY_FORM: NewProjectForm = {
  title: '',
  description: '',
  bpm: '',
  keySignature: '',
  genre: '',
};

const KEY_OPTIONS = [
  'C major', 'C# major', 'D major', 'D# major', 'E major', 'F major',
  'F# major', 'G major', 'G# major', 'A major', 'A# major', 'B major',
  'C minor', 'C# minor', 'D minor', 'D# minor', 'E minor', 'F minor',
  'F# minor', 'G minor', 'G# minor', 'A minor', 'A# minor', 'B minor',
];

export function ProjectDashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeStemCounts, setActiveStemCounts] = useState<Record<string, number>>({});
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<NewProjectForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const projectSub = client.models.Project.observeQuery().subscribe({
      next: ({ items }) => setProjects([...items].sort(
        (a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime()
      )),
    });

    const trackSub = client.models.Track.observeQuery().subscribe({
      next: ({ items }) => {
        const counts: Record<string, number> = {};
        for (const t of items) {
          if (t.activeVersionId) {
            counts[t.projectId] = (counts[t.projectId] ?? 0) + 1;
          }
        }
        setActiveStemCounts(counts);
      },
    });

    return () => { projectSub.unsubscribe(); trackSub.unsubscribe(); };
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
        genre: form.genre.trim() || undefined,
      });
      if (result.errors) throw new Error(result.errors[0].message);
      setShowModal(false);
      setForm(EMPTY_FORM);
      if (result.data?.id) navigate(`/project/${result.data.id}`);
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
        <button className="btn-primary" onClick={() => setShowModal(true)}>
          + New project
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🎛️</div>
          <p>No projects yet. Create one to start versioning your stems.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
          {projects.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              activeStems={activeStemCounts[p.id] ?? 0}
              onClick={() => navigate(`/project/${p.id}`)}
              onDelete={(e) => handleDelete(e, p.id)}
            />
          ))}
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">New project</h2>

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
                <input
                  type="number"
                  placeholder="128"
                  min={20}
                  max={300}
                  value={form.bpm}
                  onChange={(e) => setForm((f) => ({ ...f, bpm: e.target.value }))}
                />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Key</label>
                <select
                  value={form.keySignature}
                  onChange={(e) => setForm((f) => ({ ...f, keySignature: e.target.value }))}
                >
                  <option value="">—</option>
                  {KEY_OPTIONS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Genre</label>
                <input
                  type="text"
                  placeholder="Electronic"
                  value={form.genre}
                  onChange={(e) => setForm((f) => ({ ...f, genre: e.target.value }))}
                />
              </div>
            </div>

            {error && (
              <p style={{ color: 'var(--accent-red)', fontSize: '13px', margin: '8px 0 0' }}>
                {error}
              </p>
            )}

            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => { setShowModal(false); setForm(EMPTY_FORM); }}>
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={handleCreate}
                disabled={saving || !form.title.trim()}
              >
                {saving ? 'Creating…' : 'Create project'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ProjectCard({ project, activeStems, onClick, onDelete }: {
  project: Project;
  activeStems: number;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
}) {
  const created = project.createdAt
    ? new Date(project.createdAt).toLocaleDateString()
    : '';

  return (
    <div
      className="card"
      onClick={onClick}
      style={{ cursor: 'pointer', transition: 'border-color 0.15s', position: 'relative' }}
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
        >
          ✕
        </button>
      </div>
      {project.description && (
        <p style={{ margin: '6px 0 0', fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
          {project.description}
        </p>
      )}
      <div className="meta-row" style={{ marginTop: 12 }}>
        {project.bpm && (
          <span className="meta-item"><strong>{project.bpm}</strong> BPM</span>
        )}
        {project.keySignature && (
          <span className="meta-item"><strong>{project.keySignature}</strong></span>
        )}
        {project.genre && (
          <span className="meta-item">{project.genre}</span>
        )}
        {activeStems > 0 && (
          <span className="meta-item"><strong>{activeStems}</strong> active stem{activeStems !== 1 ? 's' : ''}</span>
        )}
        <span className="meta-item" style={{ marginLeft: 'auto' }}>{created}</span>
      </div>
    </div>
  );
}
