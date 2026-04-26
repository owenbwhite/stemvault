import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { generateClient } from 'aws-amplify/data';
import { getUrl } from 'aws-amplify/storage';
import { useAuthenticator } from '@aws-amplify/ui-react';
import type { Schema } from '../../amplify/data/resource';
import { type Snapshot, encodeSnapshot, decodeSnapshot } from './snapshotUtils';
import { BulkUploadModal } from './BulkUploadModal';
import { MixPlayer, type StemTrack } from './MixPlayer';

const client = generateClient<Schema>();

type Track = Schema['Track']['type'];
type Stem = Schema['Stem']['type'];
type EditRequest = Schema['EditRequest']['type'];
type StemType = 'AUDIO' | 'MIDI' | 'INSTRUMENT' | 'MIX';

export function TrackDetail() {
  const { projectId, trackId } = useParams<{ projectId: string; trackId: string }>();
  const { user } = useAuthenticator((ctx) => [ctx.user]);
  const navigate = useNavigate();

  const [track, setTrack] = useState<Track | null>(null);
  const [stems, setStems] = useState<Stem[]>([]);
  const [editRequests, setEditRequests] = useState<EditRequest[]>([]);
  const [projectOwnerId, setProjectOwnerId] = useState<string | null>(null);
  const [masterMixStems, setMasterMixStems] = useState<StemTrack[] | null>(null);
  const [masterMixSnapshotKey, setMasterMixSnapshotKey] = useState<string | null>(null);
  const [loadingMasterMix, setLoadingMasterMix] = useState(false);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [showAddStem, setShowAddStem] = useState(false);
  const [showCreateEdit, setShowCreateEdit] = useState(false);
  const [newStemName, setNewStemName] = useState('');
  const [newStemType, setNewStemType] = useState<StemType>('AUDIO');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const isOwner = !!user?.userId && !!projectOwnerId && user.userId === projectOwnerId;

  useEffect(() => {
    if (!trackId) return;
    client.models.Track.get({ id: trackId }).then((res) => {
      setTrack(res.data);
      setLoading(false);
    });
    if (projectId) {
      client.models.Project.get({ id: projectId }).then((res) => {
        setProjectOwnerId(res.data?.ownerId ?? null);
      });
    }

    const stemSub = client.models.Stem.observeQuery({
      filter: { trackId: { eq: trackId } },
    }).subscribe({
      next: ({ items }) => setStems([...items].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))),
    });

    const erSub = client.models.EditRequest.observeQuery({
      filter: { trackId: { eq: trackId } },
    }).subscribe({
      next: ({ items }) => setEditRequests(
        [...items].sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime())
      ),
    });

    return () => { stemSub.unsubscribe(); erSub.unsubscribe(); };
  }, [trackId]);

  const loadMasterMix = async (snapshot: Snapshot) => {
    if (Object.keys(snapshot).length === 0) return;
    setLoadingMasterMix(true);
    const results = await Promise.all(
      Object.entries(snapshot).map(async ([stemId, versionId]) => {
        const stem = stems.find((s) => s.id === stemId);
        if (!stem || stem.type === 'MIX') return null;
        try {
          const res = await client.models.StemVersion.get({ id: versionId });
          const key = res.data?.proxyS3Key ?? res.data?.s3Key;
          if (!key) return null;
          const { url } = await getUrl({ path: key, options: { expiresIn: 3600 } });
          return { id: stemId, name: stem.name, category: stem.stemCategory, url: url.toString() } as StemTrack;
        } catch {
          return null;
        }
      })
    );
    setMasterMixStems(results.filter(Boolean) as StemTrack[]);
    setMasterMixSnapshotKey(JSON.stringify(snapshot));
    setLoadingMasterMix(false);
  };

  const handleCommitToMain = async () => {
    if (!trackId) return;
    const activeStemsList = stems.filter((s) => s.type !== 'MIX' && s.activeVersionId && s.isActive !== false);
    const snapshot: Snapshot = {};
    for (const s of activeStemsList) if (s.activeVersionId) snapshot[s.id] = s.activeVersionId;
    const encoded = encodeSnapshot(snapshot);
    await client.models.Track.update({ id: trackId, mainSnapshot: encoded });
    setTrack((t) => t ? { ...t, mainSnapshot: encoded } : t);
    setMasterMixStems(null);
    setMasterMixSnapshotKey(null);
  };

  const handleToggleStemActive = async (e: React.MouseEvent, stem: Stem) => {
    e.stopPropagation();
    await client.models.Stem.update({ id: stem.id, isActive: stem.isActive === false ? true : false });
  };

  const handleAddStem = async () => {
    if (!newStemName.trim() || !trackId) return;
    setSaving(true);
    try {
      await client.models.Stem.create({
        name: newStemName.trim(),
        type: newStemType,
        trackId,
        sortOrder: stems.length,
        isActive: true,
      });
      setNewStemName('');
      setNewStemType('AUDIO');
      setShowAddStem(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteStem = async (e: React.MouseEvent, stemId: string) => {
    e.stopPropagation();
    if (!confirm('Delete this stem and all its versions?')) return;
    await client.models.Stem.delete({ id: stemId });
  };

  const stemItems = stems.filter((s) => s.type !== 'MIX');
  const activeCount = stemItems.filter((s) => s.activeVersionId).length;
  const mainSnapshot = track ? decodeSnapshot(track.mainSnapshot) : {};
  const openERs = editRequests.filter((er) => er.status === 'OPEN');
  const closedERs = editRequests.filter((er) => er.status !== 'OPEN');

  if (loading) return <div style={{ color: 'var(--text-muted)', padding: '40px 0' }}>Loading…</div>;
  if (!track) return (
    <div className="empty-state">
      <p>Track not found.</p>
      <Link to={`/project/${projectId}`}>Back</Link>
    </div>
  );

  return (
    <>
      <Link to={`/project/${projectId}`} className="back-link">← Project</Link>

      <div className="page-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h1 className="page-title">{track.title}</h1>
            {track.isRemix && (
              <span style={{ fontSize: '10px', fontWeight: 600, color: '#a78bfa', border: '1px solid #a78bfa', padding: '1px 8px', borderRadius: '4px' }}>
                REMIX
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {isOwner && (
            <>
              <button className="btn-secondary" onClick={() => setShowAddStem(true)}>+ Add stem</button>
              <button className="btn-secondary" onClick={() => setShowBulkUpload(true)}>↑ Upload stems</button>
              <button
                className="btn-secondary"
                onClick={handleCommitToMain}
                disabled={activeCount === 0}
                title="Save current active stem versions to main"
              >
                ↑ Commit to main
              </button>
            </>
          )}
          <button
            className="btn-primary"
            onClick={() => setShowCreateEdit(true)}
            disabled={activeCount === 0}
          >
            + Create edit request
          </button>
        </div>
      </div>

      {/* Master mix */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: masterMixStems ? '16px' : 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--accent-green)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              ⎇ Master Mix
            </span>
            {Object.keys(mainSnapshot).length > 0 && (
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                main · {Object.keys(mainSnapshot).length} stems
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {Object.keys(mainSnapshot).length === 0 ? (
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Commit stems to main to enable playback</span>
            ) : !masterMixStems ? (
              <button className="btn-secondary btn-sm" onClick={() => loadMasterMix(mainSnapshot)} disabled={loadingMasterMix}>
                {loadingMasterMix ? 'Loading…' : '▶ Load mix'}
              </button>
            ) : (
              <>
                {masterMixSnapshotKey !== JSON.stringify(mainSnapshot) && (
                  <button className="btn-secondary btn-sm" onClick={() => loadMasterMix(mainSnapshot)} style={{ fontSize: '11px', color: 'var(--accent)' }}>
                    ⟳ Reload
                  </button>
                )}
                <button className="btn-ghost btn-sm" onClick={() => { setMasterMixStems(null); setMasterMixSnapshotKey(null); }} style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                  Unload
                </button>
              </>
            )}
          </div>
        </div>
        {masterMixStems && <MixPlayer stems={masterMixStems} />}
      </div>

      {/* Edit requests */}
      {editRequests.length > 0 && (
        <>
          <p className="section-title">
            Edit requests
            {openERs.length > 0 && (
              <span style={{ marginLeft: 8, fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--accent)' }}>
                {openERs.length} open
              </span>
            )}
          </p>
          {openERs.map((er) => (
            <EditRequestRow key={er.id} er={er} onClick={() => navigate(`/project/${projectId}/track/${trackId}/edit-request/${er.id}`)} />
          ))}
          {closedERs.map((er) => (
            <EditRequestRow key={er.id} er={er} onClick={() => navigate(`/project/${projectId}/track/${trackId}/edit-request/${er.id}`)} />
          ))}
        </>
      )}

      {/* Stems */}
      <p className="section-title">Stems ({stemItems.length})</p>

      {stemItems.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🎚️</div>
          <p>No stems yet. Upload stems to get started.</p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn-secondary" onClick={() => setShowAddStem(true)}>Add stem</button>
            <button className="btn-secondary" onClick={() => setShowBulkUpload(true)}>Upload stems</button>
          </div>
        </div>
      ) : (
        stemItems.map((stem) => (
          <StemRow
            key={stem.id}
            stem={stem}
            isOwner={isOwner}
            onClick={() => navigate(`/project/${projectId}/track/${trackId}/stem/${stem.id}`)}
            onDelete={(e) => handleDeleteStem(e, stem.id)}
            onToggleActive={(e) => handleToggleStemActive(e, stem)}
          />
        ))
      )}

      {showBulkUpload && (
        <BulkUploadModal
          trackId={trackId!}
          existingStemCount={stems.length}
          onClose={() => setShowBulkUpload(false)}
        />
      )}

      {showCreateEdit && (
        <CreateEditModal
          trackId={trackId!}
          createdBy={user?.userId ?? 'unknown'}
          stems={stemItems}
          mainSnapshot={mainSnapshot}
          onClose={() => setShowCreateEdit(false)}
          onCreated={(er) => {
            setShowCreateEdit(false);
            navigate(`/project/${projectId}/track/${trackId}/edit-request/${er.id}`);
          }}
        />
      )}

      {showAddStem && (
        <div className="modal-overlay" onClick={() => setShowAddStem(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">Add stem</h2>
            <div className="form-group">
              <label className="form-label">Name *</label>
              <input
                type="text"
                placeholder="e.g. Kick Drum, Lead Synth, Bass Guitar"
                value={newStemName}
                onChange={(e) => setNewStemName(e.target.value)}
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleAddStem()}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Type</label>
              <select value={newStemType} onChange={(e) => setNewStemType(e.target.value as typeof newStemType)}>
                <option value="AUDIO">Audio (WAV, AIFF, FLAC)</option>
                <option value="MIDI">MIDI</option>
                <option value="INSTRUMENT">Instrument / Synth Patch</option>
                <option value="MIX">Mix / Master</option>
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setShowAddStem(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleAddStem} disabled={saving || !newStemName.trim()}>
                {saving ? 'Adding…' : 'Add stem'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function EditRequestRow({ er, onClick }: { er: EditRequest; onClick: () => void }) {
  const statusColor = er.status === 'MERGED' ? 'var(--accent-green)' : er.status === 'CLOSED' ? 'var(--text-muted)' : 'var(--accent)';
  const statusLabel = er.status === 'MERGED' ? '⎇ merged' : er.status === 'CLOSED' ? '✕ closed' : '● open';

  return (
    <div className="version-row" onClick={onClick} style={{ cursor: 'pointer' }}>
      <span className="version-label">{er.title}</span>
      {er.description && <span className="version-notes">{er.description}</span>}
      <span style={{ fontSize: '11px', color: statusColor, fontWeight: 600 }}>{statusLabel}</span>
      <span className="version-meta">{new Date(er.createdAt!).toLocaleDateString()}</span>
    </div>
  );
}

function StemRow({ stem, isOwner, onClick, onDelete, onToggleActive }: {
  stem: Stem;
  isOwner: boolean;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
  onToggleActive: (e: React.MouseEvent) => void;
}) {
  const typeClass: Record<string, string> = {
    AUDIO: 'badge-audio', MIDI: 'badge-midi', INSTRUMENT: 'badge-instrument', MIX: 'badge-mix',
  };
  const inactive = stem.isActive === false;

  return (
    <div className="track-row" onClick={onClick} style={{ cursor: 'pointer', opacity: inactive ? 0.5 : 1 }}>
      <div className="track-name">{stem.name}</div>
      <span className={`badge ${typeClass[stem.type ?? 'AUDIO']}`}>{stem.type ?? 'AUDIO'}</span>
      {stem.stemCategory && (
        <span style={{ fontSize: '11px', color: 'var(--text-secondary)', background: 'var(--bg-hover)', padding: '2px 8px', borderRadius: '999px', border: '1px solid var(--border)' }}>
          {stem.stemCategory}
        </span>
      )}
      {inactive ? (
        <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>⊘ inactive</span>
      ) : stem.activeVersionId ? (
        <span style={{ fontSize: '10px', color: 'var(--accent-green)', fontFamily: 'var(--font-mono)' }}>● active</span>
      ) : null}
      <div className="track-controls">
        <button className="btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); onClick(); }}>Open →</button>
        {isOwner && (
          <>
            <button
              className="btn-ghost btn-sm"
              onClick={onToggleActive}
              style={{ color: inactive ? 'var(--accent-green)' : 'var(--text-muted)', fontSize: '11px' }}
              title={inactive ? 'Reactivate stem' : 'Deactivate stem'}
            >
              {inactive ? 'Reactivate' : 'Deactivate'}
            </button>
            <button className="btn-ghost btn-sm" onClick={onDelete} style={{ color: 'var(--text-muted)' }} title="Delete stem">✕</button>
          </>
        )}
      </div>
    </div>
  );
}

interface CreateEditModalProps {
  trackId: string;
  createdBy: string;
  stems: Stem[];
  mainSnapshot: Snapshot;
  onClose: () => void;
  onCreated: (er: EditRequest) => void;
}

function CreateEditModal({ trackId, createdBy, stems, mainSnapshot, onClose, onCreated }: CreateEditModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  // Pre-populate from mainSnapshot. Stems in main start selected with their main version.
  // Stems with a newer activeVersionId (changed) use the active version.
  // New stems (activeVersionId but not in main) start unchecked.
  const [selectedVersions, setSelectedVersions] = useState<Snapshot>(() => {
    const init: Snapshot = {};
    for (const s of stems) {
      if (mainSnapshot[s.id]) {
        // In main: use activeVersionId if available (may be a new version), else main version
        init[s.id] = s.activeVersionId ?? mainSnapshot[s.id];
      }
      // Not in main: leave unchecked (user must explicitly add)
    }
    return init;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // All stems relevant to this modal: in main OR has an active version
  const relevantStems = stems.filter((s) => mainSnapshot[s.id] || s.activeVersionId);

  const handleCreate = async () => {
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const editRes = await client.models.Edit.create({
        trackId,
        name: title.trim().toLowerCase().replace(/\s+/g, '-'),
        description: description.trim() || undefined,
        createdBy,
        snapshot: encodeSnapshot(selectedVersions),
      });
      if (editRes.errors) throw new Error(editRes.errors[0].message);

      const erRes = await client.models.EditRequest.create({
        trackId,
        fromEditId: editRes.data!.id,
        title: title.trim(),
        description: description.trim() || undefined,
        proposedSnapshot: encodeSnapshot(selectedVersions),
        status: 'OPEN',
      });
      if (erRes.errors) throw new Error(erRes.errors[0].message);

      onCreated(erRes.data!);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create edit request');
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: '560px' }}>
        <h2 className="modal-title">Create edit request</h2>
        <p style={{ margin: '0 0 16px', fontSize: '13px', color: 'var(--text-secondary)' }}>
          Propose stem versions to merge into this track's main mix.
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
          <textarea rows={2} placeholder="What did you change and why?" value={description}
            onChange={(e) => setDescription(e.target.value)} style={{ resize: 'vertical' }} />
        </div>

        <p className="form-label" style={{ marginBottom: 8 }}>Proposed mix</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {relevantStems.map((s) => {
            const inMain = !!mainSnapshot[s.id];
            const isNew = !inMain && !!s.activeVersionId;
            const isChanged = inMain && s.activeVersionId && s.activeVersionId !== mainSnapshot[s.id];
            const versionForProposal = s.activeVersionId ?? mainSnapshot[s.id];

            return (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: '12px', color: 'var(--text-primary)', width: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.name}
                </span>
                {s.stemCategory && (
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', background: 'var(--bg-hover)', padding: '1px 6px', borderRadius: '999px', border: '1px solid var(--border)', flexShrink: 0 }}>
                    {s.stemCategory}
                  </span>
                )}
                {isNew && (
                  <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--accent-green)', flexShrink: 0 }}>new</span>
                )}
                {isChanged && (
                  <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--accent)', flexShrink: 0 }}>updated</span>
                )}
                <input
                  type="checkbox"
                  checked={!!selectedVersions[s.id]}
                  onChange={(e) => {
                    if (e.target.checked && versionForProposal) {
                      setSelectedVersions((prev) => ({ ...prev, [s.id]: versionForProposal }));
                    } else {
                      setSelectedVersions((prev) => { const n = { ...prev }; delete n[s.id]; return n; });
                    }
                  }}
                  disabled={!versionForProposal}
                  style={{ accentColor: 'var(--accent)', marginLeft: 'auto', flexShrink: 0 }}
                />
              </div>
            );
          })}
        </div>

        {error && <p style={{ color: 'var(--accent-red)', fontSize: '13px', margin: '0 0 8px' }}>{error}</p>}

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary" onClick={handleCreate}
            disabled={saving || !title.trim() || Object.keys(selectedVersions).length === 0}>
            {saving ? 'Creating…' : 'Create edit request'}
          </button>
        </div>
      </div>
    </div>
  );
}
