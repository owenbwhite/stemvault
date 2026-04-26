import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { generateClient } from 'aws-amplify/data';
import { useAuthenticator } from '@aws-amplify/ui-react';
import type { Schema } from '../../amplify/data/resource';
import { PROJECT_TEMPLATES, type ProjectTemplate } from './templates';

const client = generateClient<Schema>();

type Project = Schema['Project']['type'];

interface NewProjectForm {
  title: string;
  description: string;
  bpm: string;
  keySignature: string;
  genre: string;
  type: 'SINGLE' | 'EP' | 'LP';
}

const EMPTY_FORM: NewProjectForm = {
  title: '', description: '', bpm: '', keySignature: '', genre: '', type: 'SINGLE',
};

const KEY_OPTIONS = [
  'C major', 'C# major', 'D major', 'D# major', 'E major', 'F major',
  'F# major', 'G major', 'G# major', 'A major', 'A# major', 'B major',
  'C minor', 'C# minor', 'D minor', 'D# minor', 'E minor', 'F minor',
  'F# minor', 'G minor', 'G# minor', 'A minor', 'A# minor', 'B minor',
];

const TYPE_COLORS: Record<string, string> = {
  SINGLE: 'var(--accent)',
  EP: 'var(--accent-green)',
  LP: '#a78bfa',
};

export function ProjectDashboard() {
  const { user } = useAuthenticator((ctx) => [ctx.user]);
  const [myProjects, setMyProjects] = useState<Project[]>([]);
  const [collabProjects, setCollabProjects] = useState<Project[]>([]);
  const [tab, setTab] = useState<'library' | 'collabs'>('library');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<NewProjectForm>(EMPTY_FORM);
  const [selectedTemplate, setSelectedTemplate] = useState<ProjectTemplate | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!user?.userId) return;
    const sub = client.models.Project.observeQuery({
      filter: { ownerId: { eq: user.userId } },
    }).subscribe({
      next: ({ items }) => setMyProjects(
        [...items].sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime())
      ),
    });
    return () => sub.unsubscribe();
  }, [user?.userId]);

  useEffect(() => {
    if (!user?.userId) return;
    const sub = client.models.Collaborator.observeQuery({
      filter: { userId: { eq: user.userId } },
    }).subscribe({
      next: async ({ items }: { items: Schema['Collaborator']['type'][] }) => {
        if (items.length === 0) { setCollabProjects([]); return; }
        const results = await Promise.all(items.map((c) => client.models.Project.get({ id: c.projectId })));
        const loaded: Project[] = [];
        for (const r of results) {
          if (r.data) loaded.push(r.data as unknown as Project);
        }
        setCollabProjects(loaded.sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime()));
      },
    });
    return () => sub.unsubscribe();
  }, [user?.userId]);

  const handleCreate = async () => {
    if (!form.title.trim() || !user?.userId) return;
    setSaving(true);
    setError(null);
    try {
      const result = await client.models.Project.create({
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        bpm: form.bpm ? parseInt(form.bpm, 10) : undefined,
        keySignature: form.keySignature || undefined,
        genre: (form.genre.trim() || selectedTemplate?.genre) || undefined,
        type: form.type,
        ownerId: user.userId,
      });
      if (result.errors) throw new Error(result.errors[0].message);
      const projectId = result.data?.id;

      if (projectId && selectedTemplate) {
        const trackRes = await client.models.Track.create({
          title: form.title.trim(),
          projectId,
          sortOrder: 0,
        });
        if (trackRes.data) {
          await Promise.all(
            selectedTemplate.tracks.map((t, i) =>
              client.models.Stem.create({
                trackId: trackRes.data!.id,
                name: t.name,
                type: t.type,
                stemCategory: t.stemCategory,
                sortOrder: i,
              })
            )
          );
        }
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

  const projects = tab === 'library' ? myProjects : collabProjects;

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Projects</h1>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              className={tab === 'library' ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'}
              onClick={() => setTab('library')}
            >
              Library{myProjects.length > 0 ? ` (${myProjects.length})` : ''}
            </button>
            <button
              className={tab === 'collabs' ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'}
              onClick={() => setTab('collabs')}
            >
              Collabs{collabProjects.length > 0 ? ` (${collabProjects.length})` : ''}
            </button>
          </div>
        </div>
        <button className="btn-primary" onClick={() => setShowModal(true)}>+ New project</button>
      </div>

      {projects.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🎛️</div>
          <p>{tab === 'library' ? 'No projects yet. Create one to start versioning your stems.' : 'No collaborations yet.'}</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
          {projects.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              showDelete={tab === 'library'}
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

            <div className="form-group">
              <label className="form-label">Type</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['SINGLE', 'EP', 'LP'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setForm((f) => ({ ...f, type: t }))}
                    style={{
                      padding: '6px 16px', borderRadius: 6, cursor: 'pointer',
                      background: form.type === t ? 'var(--bg-hover)' : 'transparent',
                      border: `1px solid ${form.type === t ? (TYPE_COLORS[t] ?? 'var(--accent)') : 'var(--border)'}`,
                      color: form.type === t ? 'var(--text-primary)' : 'var(--text-muted)',
                      fontSize: '12px', fontWeight: 600,
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

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

function ProjectCard({ project, showDelete, onClick, onDelete }: {
  project: Project;
  showDelete: boolean;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
}) {
  const created = project.createdAt ? new Date(project.createdAt).toLocaleDateString() : '';

  return (
    <div
      className="card"
      onClick={onClick}
      style={{ cursor: 'pointer', transition: 'border-color 0.15s' }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent-dim)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
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
          <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>{project.title}</h3>
        </div>
        {showDelete && (
          <button
            className="btn-ghost btn-sm"
            onClick={onDelete}
            style={{ flexShrink: 0, padding: '2px 6px', color: 'var(--text-muted)' }}
            title="Delete project"
          >✕</button>
        )}
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
    </div>
  );
}
