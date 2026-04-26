import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { generateClient } from 'aws-amplify/data';
import { getUrl } from 'aws-amplify/storage';
import type { Schema } from '../../amplify/data/resource';
import { type Snapshot, encodeSnapshot, decodeSnapshot } from './snapshotUtils';
import { BulkUploadModal } from './BulkUploadModal';
import { MixPlayer, type StemTrack } from './MixPlayer';

const client = generateClient<Schema>();

type Project = Schema['Project']['type'];
type Track = Schema['Track']['type'];
type Branch = Schema['Branch']['type'];
type PullRequest = Schema['PullRequest']['type'];


export function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const [project, setProject] = useState<Project | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [mainBranch, setMainBranch] = useState<Branch | null>(null);
  const [pullRequests, setPullRequests] = useState<PullRequest[]>([]);
  const [showAddTrack, setShowAddTrack] = useState(false);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [showCreatePR, setShowCreatePR] = useState(false);
  // Master mix — persists for the page session, keyed to snapshot
  const [masterMixStems, setMasterMixStems] = useState<StemTrack[] | null>(null);
  const [masterMixSnapshotKey, setMasterMixSnapshotKey] = useState<string | null>(null);
  const [loadingMasterMix, setLoadingMasterMix] = useState(false);
  const [newTrackName, setNewTrackName] = useState('');
  const [newTrackType, setNewTrackType] = useState<'AUDIO' | 'MIDI' | 'INSTRUMENT' | 'MIX'>('AUDIO');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;

    client.models.Project.get({ id: projectId }).then(async (res) => {
      setProject(res.data);
      if (res.data?.mainBranchId) {
        const branchRes = await client.models.Branch.get({ id: res.data.mainBranchId });
        setMainBranch(branchRes.data);
      }
      setLoading(false);
    });

    const trackSub = client.models.Track.observeQuery({
      filter: { projectId: { eq: projectId } },
    }).subscribe({
      next: ({ items }) =>
        setTracks([...items].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))),
    });

    const prSub = client.models.PullRequest.observeQuery({
      filter: { projectId: { eq: projectId } },
    }).subscribe({
      next: ({ items }) =>
        setPullRequests([...items].sort(
          (a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime()
        )),
    });

    return () => { trackSub.unsubscribe(); prSub.unsubscribe(); };
  }, [projectId]);

  // Ensure a main branch exists whenever tracks change
  useEffect(() => {
    if (!projectId || !project || mainBranch) return;
    const stemTracks = tracks.filter((t) => t.type !== 'MIX' && t.activeVersionId);
    if (stemTracks.length === 0) return;

    (async () => {
      const snapshot: Snapshot = {};
      for (const t of stemTracks) if (t.activeVersionId) snapshot[t.id] = t.activeVersionId;

      const branchRes = await client.models.Branch.create({
        projectId,
        name: 'main',
        isMain: true,
        snapshot: encodeSnapshot(snapshot),
      });
      if (branchRes.data) {
        await client.models.Project.update({ id: projectId, mainBranchId: branchRes.data.id });
        setMainBranch(branchRes.data);
        setProject((p) => p ? { ...p, mainBranchId: branchRes.data!.id } : p);
      }
    })();
  }, [projectId, project, mainBranch, tracks]);

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

  const loadMasterMix = async (branch: Branch) => {
    const snapshot = decodeSnapshot(branch.snapshot);
    if (Object.keys(snapshot).length === 0) return;
    setLoadingMasterMix(true);
    const results = await Promise.all(
      Object.entries(snapshot).map(async ([trackId, versionId]) => {
        const track = tracks.find((t) => t.id === trackId);
        if (!track || track.type === 'MIX') return null;
        try {
          const res = await client.models.Version.get({ id: versionId });
          const key = res.data?.proxyS3Key ?? res.data?.s3Key;
          if (!key) return null;
          const { url } = await getUrl({ path: key, options: { expiresIn: 3600 } });
          return { id: trackId, name: track.name, category: track.stemCategory, url: url.toString() } as StemTrack;
        } catch {
          return null;
        }
      })
    );
    setMasterMixStems(results.filter(Boolean) as StemTrack[]);
    setMasterMixSnapshotKey(JSON.stringify(snapshot));
    setLoadingMasterMix(false);
  };

  // Commit current active stem versions to the main branch snapshot
  const handleCommitToMain = async () => {
    if (!projectId || !project) return;
    const stemTracks = tracks.filter((t) => t.type !== 'MIX' && t.activeVersionId);
    const snapshot: Snapshot = {};
    for (const t of stemTracks) if (t.activeVersionId) snapshot[t.id] = t.activeVersionId;

    const encoded = encodeSnapshot(snapshot);
    if (mainBranch) {
      await client.models.Branch.update({ id: mainBranch.id, snapshot: encoded });
      setMainBranch({ ...mainBranch, snapshot: encoded });
      setMasterMixStems(null);
      setMasterMixSnapshotKey(null);
    } else {
      const res = await client.models.Branch.create({ projectId, name: 'main', isMain: true, snapshot: encoded });
      if (res.data) {
        await client.models.Project.update({ id: projectId, mainBranchId: res.data.id });
        setMainBranch(res.data);
        setProject((p) => p ? { ...p, mainBranchId: res.data!.id } : p);
      }
    }
  };

  const stemTracks = tracks.filter((t) => t.type !== 'MIX');
  const activeCount = stemTracks.filter((t) => t.activeVersionId).length;
  const openPRs = pullRequests.filter((p) => p.status === 'OPEN');
  const closedPRs = pullRequests.filter((p) => p.status !== 'OPEN');

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
          <h1 className="page-title">{project.title}</h1>
          <div className="meta-row">
            {project.bpm && <span className="meta-item"><strong>{project.bpm}</strong> BPM</span>}
            {project.keySignature && <span className="meta-item"><strong>{project.keySignature}</strong></span>}
            {project.genre && <span className="meta-item">{project.genre}</span>}
            {mainBranch && (
              <span className="meta-item" style={{ color: 'var(--accent-green)', fontFamily: 'var(--font-mono)' }}>
                ⎇ main
              </span>
            )}
          </div>
          {project.description && (
            <p style={{ margin: '8px 0 0', color: 'var(--text-secondary)', fontSize: '13px' }}>
              {project.description}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button className="btn-secondary" onClick={() => setShowAddTrack(true)}>+ Add track</button>
          <button className="btn-secondary" onClick={() => setShowBulkUpload(true)}>↑ Upload stems</button>
          <button
            className="btn-secondary"
            onClick={handleCommitToMain}
            disabled={activeCount === 0}
            title="Save current active stem versions to main"
          >
            ↑ Commit to main
          </button>
          <button
            className="btn-primary"
            onClick={() => setShowCreatePR(true)}
            disabled={activeCount === 0}
          >
            + Create PR
          </button>
        </div>
      </div>

      {/* Master mix — persistent player for the main branch */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: masterMixStems ? '16px' : 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--accent-green)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              ⎇ Master Mix
            </span>
            {mainBranch && (
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                main · {Object.keys(decodeSnapshot(mainBranch.snapshot)).length} stems
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {!mainBranch ? (
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                Commit stems to main to enable playback
              </span>
            ) : !masterMixStems ? (
              <button
                className="btn-secondary btn-sm"
                onClick={() => loadMasterMix(mainBranch)}
                disabled={loadingMasterMix}
              >
                {loadingMasterMix ? 'Loading…' : '▶ Load mix'}
              </button>
            ) : (
              <>
                {masterMixSnapshotKey !== JSON.stringify(decodeSnapshot(mainBranch.snapshot)) && (
                  <button
                    className="btn-secondary btn-sm"
                    onClick={() => loadMasterMix(mainBranch)}
                    style={{ fontSize: '11px', color: 'var(--accent)' }}
                  >
                    ⟳ Reload
                  </button>
                )}
                <button
                  className="btn-ghost btn-sm"
                  onClick={() => { setMasterMixStems(null); setMasterMixSnapshotKey(null); }}
                  style={{ color: 'var(--text-muted)', fontSize: '11px' }}
                >
                  Unload
                </button>
              </>
            )}
          </div>
        </div>
        {masterMixStems && <MixPlayer stems={masterMixStems} />}
      </div>

      {/* MIX tracks */}
      {tracks.filter((t) => t.type === 'MIX').map((track) => (
        <TrackRow
          key={track.id}
          track={track}
          onClick={() => navigate(`/project/${projectId}/track/${track.id}`)}
          onDelete={(e) => handleDeleteTrack(e, track.id)}
        />
      ))}

      {/* Pull requests */}
      {pullRequests.length > 0 && (
        <>
          <p className="section-title">
            Pull requests
            {openPRs.length > 0 && (
              <span style={{ marginLeft: 8, fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--accent)' }}>
                {openPRs.length} open
              </span>
            )}
          </p>
          {openPRs.map((pr) => (
            <PRRow key={pr.id} pr={pr} onClick={() => navigate(`/project/${projectId}/pr/${pr.id}`)} />
          ))}
          {closedPRs.map((pr) => (
            <PRRow key={pr.id} pr={pr} onClick={() => navigate(`/project/${projectId}/pr/${pr.id}`)} />
          ))}
        </>
      )}

      {/* Stems */}
      <p className="section-title">Stems ({stemTracks.length})</p>

      {stemTracks.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🎚️</div>
          <p>No stems yet. Drop your stems to get started.</p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn-secondary" onClick={() => setShowAddTrack(true)}>Add track</button>
            <button className="btn-secondary" onClick={() => setShowBulkUpload(true)}>Upload stems</button>
          </div>
        </div>
      ) : (
        stemTracks.map((track) => (
          <TrackRow
            key={track.id}
            track={track}
            onClick={() => navigate(`/project/${projectId}/track/${track.id}`)}
            onDelete={(e) => handleDeleteTrack(e, track.id)}
          />
        ))
      )}

      {/* Modals */}
      {showBulkUpload && (
        <BulkUploadModal
          projectId={projectId!}
          existingTrackCount={tracks.length}
          onClose={() => setShowBulkUpload(false)}
        />
      )}

      {showCreatePR && (
        <CreatePRModal
          projectId={projectId!}
          tracks={stemTracks}
          onClose={() => setShowCreatePR(false)}
          onCreated={(pr) => {
            setShowCreatePR(false);
            navigate(`/project/${projectId}/pr/${pr.id}`);
          }}
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
              <button className="btn-secondary" onClick={() => setShowAddTrack(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleAddTrack} disabled={saving || !newTrackName.trim()}>
                {saving ? 'Adding…' : 'Add track'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function PRRow({ pr, onClick }: { pr: PullRequest; onClick: () => void }) {
  const statusColor = pr.status === 'MERGED'
    ? 'var(--accent-green)'
    : pr.status === 'CLOSED'
    ? 'var(--text-muted)'
    : 'var(--accent)';
  const statusLabel = pr.status === 'MERGED' ? '⎇ merged' : pr.status === 'CLOSED' ? '✕ closed' : '● open';

  return (
    <div className="version-row" onClick={onClick} style={{ cursor: 'pointer' }}>
      <span className="version-label">{pr.title}</span>
      {pr.description && <span className="version-notes">{pr.description}</span>}
      <span style={{ fontSize: '11px', color: statusColor, fontWeight: 600 }}>{statusLabel}</span>
      <span className="version-meta">{new Date(pr.createdAt!).toLocaleDateString()}</span>
    </div>
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
      <span className={`badge ${typeClass[track.type ?? 'AUDIO']}`}>{track.type ?? 'AUDIO'}</span>
      {track.stemCategory && (
        <span style={{ fontSize: '11px', color: 'var(--text-secondary)', background: 'var(--bg-hover)', padding: '2px 8px', borderRadius: '999px', border: '1px solid var(--border)' }}>
          {track.stemCategory}
        </span>
      )}
      {track.activeVersionId && (
        <span style={{ fontSize: '10px', color: 'var(--accent-green)', fontFamily: 'var(--font-mono)' }}>● active</span>
      )}
      <div className="track-controls">
        <button className="btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); onClick(); }}>Open →</button>
        <button className="btn-ghost btn-sm" onClick={onDelete} style={{ color: 'var(--text-muted)' }} title="Delete track">✕</button>
      </div>
    </div>
  );
}

interface CreatePRModalProps {
  projectId: string;
  tracks: Track[];
  onClose: () => void;
  onCreated: (pr: PullRequest) => void;
}

function CreatePRModal({ projectId, tracks, onClose, onCreated }: CreatePRModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  // Selected versions per track — defaults to current activeVersionId
  const [selectedVersions, setSelectedVersions] = useState<Snapshot>(
    Object.fromEntries(tracks.filter((t) => t.activeVersionId).map((t) => [t.id, t.activeVersionId!]))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      // Create a feature branch for this PR
      const branchRes = await client.models.Branch.create({
        projectId,
        name: `pr/${title.trim().toLowerCase().replace(/\s+/g, '-')}`,
        isMain: false,
        snapshot: encodeSnapshot(selectedVersions),
      });
      if (branchRes.errors) throw new Error(branchRes.errors[0].message);

      const prRes = await client.models.PullRequest.create({
        projectId,
        fromBranchId: branchRes.data!.id,
        title: title.trim(),
        description: description.trim() || undefined,
        proposedSnapshot: encodeSnapshot(selectedVersions),
        status: 'OPEN',
      });
      if (prRes.errors) throw new Error(prRes.errors[0].message);

      onCreated(prRes.data!);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create PR');
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: '560px' }}>
        <h2 className="modal-title">Create pull request</h2>
        <p style={{ margin: '0 0 16px', fontSize: '13px', color: 'var(--text-secondary)' }}>
          Propose a version of each stem to merge into main.
        </p>

        <div className="form-group">
          <label className="form-label">Title *</label>
          <input
            type="text"
            placeholder="e.g. New chorus drop, Tighter kick, Verse 2 rework"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </div>

        <div className="form-group">
          <label className="form-label">Description</label>
          <textarea
            rows={2}
            placeholder="What did you change and why?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={{ resize: 'vertical' }}
          />
        </div>

        <p className="form-label" style={{ marginBottom: 8 }}>Stem versions to propose</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {tracks.filter((t) => t.activeVersionId).map((t) => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: '12px', color: 'var(--text-primary)', width: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.name}
              </span>
              {t.stemCategory && (
                <span style={{ fontSize: '10px', color: 'var(--text-muted)', background: 'var(--bg-hover)', padding: '1px 6px', borderRadius: '999px', border: '1px solid var(--border)', flexShrink: 0 }}>
                  {t.stemCategory}
                </span>
              )}
              <input
                type="checkbox"
                checked={!!selectedVersions[t.id]}
                onChange={(e) => {
                  if (e.target.checked) {
                    setSelectedVersions((s) => ({ ...s, [t.id]: t.activeVersionId! }));
                  } else {
                    setSelectedVersions((s) => { const n = { ...s }; delete n[t.id]; return n; });
                  }
                }}
                style={{ accentColor: 'var(--accent)', marginLeft: 'auto' }}
              />
            </div>
          ))}
        </div>

        {error && <p style={{ color: 'var(--accent-red)', fontSize: '13px', margin: '0 0 8px' }}>{error}</p>}

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button
            className="btn-primary"
            onClick={handleCreate}
            disabled={saving || !title.trim() || Object.keys(selectedVersions).length === 0}
          >
            {saving ? 'Creating…' : 'Create PR'}
          </button>
        </div>
      </div>
    </div>
  );
}
