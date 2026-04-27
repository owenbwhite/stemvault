import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { generateClient } from 'aws-amplify/data';
import { uploadData, getUrl } from 'aws-amplify/storage';
import { fetchAuthSession } from 'aws-amplify/auth';
import type { Schema } from '../../amplify/data/resource';
import { MixPlayer, type StemTrack } from './MixPlayer';
import { type Snapshot, encodeSnapshot, decodeSnapshot } from './snapshotUtils';

const client = generateClient<Schema>();

type Edit = Schema['Edit']['type'];
type Stem = Schema['Stem']['type'];
type StemVersion = Schema['StemVersion']['type'];
type EditRequest = Schema['EditRequest']['type'];

interface VersionWithUrl extends StemVersion {
  playbackUrl?: string;
}

export function EditDetail() {
  const { projectId, trackId, editId } = useParams<{ projectId: string; trackId: string; editId: string }>();
  const navigate = useNavigate();

  const [edit, setEdit] = useState<Edit | null>(null);
  const [stems, setStems] = useState<Stem[]>([]);
  const [editSnapshot, setEditSnapshot] = useState<Snapshot>({});
  const [versionsByStem, setVersionsByStem] = useState<Record<string, VersionWithUrl[]>>({});
  const [mixStems, setMixStems] = useState<StemTrack[] | null>(null);
  const [loadingMix, setLoadingMix] = useState(false);
  const [loading, setLoading] = useState(true);

  // Per-stem upload state
  const [uploadStemId, setUploadStemId] = useState<string | null>(null);

  // Version picker state
  const [pickerStemId, setPickerStemId] = useState<string | null>(null);
  const [pickerVersions, setPickerVersions] = useState<VersionWithUrl[]>([]);
  const [loadingPicker, setLoadingPicker] = useState(false);

  // Open ER state
  const [showOpenER, setShowOpenER] = useState(false);

  useEffect(() => {
    if (!editId || !trackId) return;

    client.models.Edit.get({ id: editId }).then((res) => {
      setEdit(res.data);
      setEditSnapshot(decodeSnapshot(res.data?.snapshot));
      setLoading(false);
    });

    const stemSub = client.models.Stem.observeQuery({
      filter: { trackId: { eq: trackId } },
    }).subscribe({
      next: ({ items }) => setStems([...items].filter((s) => s.type !== 'MIX').sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))),
    });

    return () => stemSub.unsubscribe();
  }, [editId, trackId]);

  const updateSnapshot = async (newSnapshot: Snapshot) => {
    if (!editId) return;
    await client.models.Edit.update({ id: editId, snapshot: encodeSnapshot(newSnapshot) });
    setEditSnapshot(newSnapshot);
    setMixStems(null); // invalidate mix
  };

  const handleToggleStem = async (stemId: string, include: boolean) => {
    const next = { ...editSnapshot };
    if (!include) {
      delete next[stemId];
    } else {
      // Re-include: use the version already in the snapshot if it was there before,
      // or fall back to the stem's activeVersionId
      const stem = stems.find((s) => s.id === stemId);
      const fallback = stem?.activeVersionId;
      if (!fallback) return; // no version to include
      next[stemId] = fallback;
    }
    await updateSnapshot(next);
  };

  const handleHotswap = async (stemId: string, versionId: string) => {
    const next = { ...editSnapshot, [stemId]: versionId };
    await updateSnapshot(next);
    setPickerStemId(null);
  };

  const openPicker = async (stemId: string) => {
    setPickerStemId(stemId);
    setLoadingPicker(true);
    // Load all published versions + this edit's draft versions
    const res = await client.models.StemVersion.list({
      filter: { stemId: { eq: stemId } },
    });
    const all = (res.data ?? []).filter(
      (v) => !v.pendingEditId || v.pendingEditId === editId
    );
    const sorted = [...all].sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime());
    const withUrls = await Promise.all(
      sorted.map(async (v) => {
        if (!v.proxyS3Key && !v.s3Key) return v as VersionWithUrl;
        try {
          const key = v.proxyS3Key ?? v.s3Key;
          const { url } = await getUrl({ path: key!, options: { expiresIn: 3600 } });
          return { ...v, playbackUrl: url.toString() } as VersionWithUrl;
        } catch { return v as VersionWithUrl; }
      })
    );
    setPickerVersions(withUrls);
    setLoadingPicker(false);
  };

  const handleLoadMix = async () => {
    if (Object.keys(editSnapshot).length === 0) return;
    setLoadingMix(true);
    const results = await Promise.all(
      Object.entries(editSnapshot).map(async ([stemId, versionId]) => {
        const stem = stems.find((s) => s.id === stemId);
        if (!stem) return null;
        try {
          const res = await client.models.StemVersion.get({ id: versionId });
          const key = res.data?.proxyS3Key ?? res.data?.s3Key;
          if (!key) return null;
          const { url } = await getUrl({ path: key, options: { expiresIn: 3600 } });
          return { id: stemId, name: stem.name, category: stem.stemCategory, url: url.toString() } as StemTrack;
        } catch { return null; }
      })
    );
    setMixStems(results.filter(Boolean) as StemTrack[]);
    setLoadingMix(false);
  };

  // Resolve version labels for the snapshot display
  useEffect(() => {
    const versionIds = Object.values(editSnapshot);
    if (versionIds.length === 0) return;
    Promise.all(
      versionIds.map(async (vId) => {
        if (versionsByStem[vId]) return;
        const res = await client.models.StemVersion.get({ id: vId });
        if (res.data) {
          setVersionsByStem((prev) => ({ ...prev, [vId]: [res.data as VersionWithUrl] }));
        }
      })
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editSnapshot]);

  if (loading) return <div style={{ color: 'var(--text-muted)', padding: '40px 0' }}>Loading…</div>;
  if (!edit) return (
    <div className="empty-state">
      <p>Edit not found.</p>
      <Link to={`/project/${projectId}/track/${trackId}`}>Back to track</Link>
    </div>
  );

  const includedCount = Object.keys(editSnapshot).length;

  return (
    <>
      <Link to={`/project/${projectId}/track/${trackId}`} className="back-link">← Track</Link>

      <div className="page-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              ⎇ Edit
            </span>
          </div>
          <h1 className="page-title">{edit.name}</h1>
          {edit.description && (
            <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: '13px' }}>{edit.description}</p>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button
            className="btn-primary"
            onClick={() => setShowOpenER(true)}
            disabled={includedCount === 0}
          >
            Open edit request →
          </button>
        </div>
      </div>

      {/* Mix player */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: mixStems ? 16 : 0 }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Edit mix · {includedCount} stem{includedCount !== 1 ? 's' : ''}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            {includedCount === 0 ? (
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Add stems to the mix to enable playback</span>
            ) : !mixStems ? (
              <button className="btn-secondary btn-sm" onClick={handleLoadMix} disabled={loadingMix}>
                {loadingMix ? 'Loading…' : '▶ Load mix'}
              </button>
            ) : (
              <button className="btn-ghost btn-sm" onClick={() => setMixStems(null)} style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                Unload
              </button>
            )}
          </div>
        </div>
        {mixStems && <MixPlayer stems={mixStems} />}
      </div>

      {/* Stem list */}
      <p className="section-title">Stems</p>

      {stems.length === 0 ? (
        <div className="empty-state"><p>No stems on this track yet.</p></div>
      ) : (
        stems.map((stem) => {
          const versionId = editSnapshot[stem.id];
          const included = !!versionId;
          const versionRecord = versionId ? (versionsByStem[versionId]?.[0] ?? null) : null;
          const isDraft = !!versionRecord?.pendingEditId;
          const versionLabel = versionRecord?.versionLabel ?? (versionId ? versionId.slice(0, 8) : null);

          return (
            <div key={stem.id} className="track-row" style={{ cursor: 'default', opacity: included ? 1 : 0.45 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                <input
                  type="checkbox"
                  checked={included}
                  onChange={(e) => handleToggleStem(stem.id, e.target.checked)}
                  style={{ accentColor: 'var(--accent)', flexShrink: 0 }}
                  title={included ? 'Remove from edit mix' : 'Include in edit mix'}
                />
                <div className="track-name">{stem.name}</div>
                {stem.stemCategory && (
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', background: 'var(--bg-hover)', padding: '1px 6px', borderRadius: '999px', border: '1px solid var(--border)', flexShrink: 0 }}>
                    {stem.stemCategory}
                  </span>
                )}
                {included && versionLabel && (
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                    {versionLabel}
                    {isDraft && <span style={{ color: 'var(--accent)', marginLeft: 4 }}>· draft</span>}
                  </span>
                )}
              </div>
              <div className="track-controls">
                {included && (
                  <button
                    className="btn-ghost btn-sm"
                    onClick={() => openPicker(stem.id)}
                    style={{ fontSize: '11px' }}
                  >
                    Change version
                  </button>
                )}
                <button
                  className="btn-secondary btn-sm"
                  onClick={() => setUploadStemId(stem.id)}
                  style={{ fontSize: '11px' }}
                >
                  ↑ Upload
                </button>
              </div>
            </div>
          );
        })
      )}

      {/* Version picker modal */}
      {pickerStemId && (
        <div className="modal-overlay" onClick={() => setPickerStemId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: '480px' }}>
            <h2 className="modal-title">
              Change version — {stems.find((s) => s.id === pickerStemId)?.name}
            </h2>
            {loadingPicker ? (
              <div style={{ color: 'var(--text-muted)', padding: '20px 0' }}>Loading versions…</div>
            ) : pickerVersions.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', padding: '20px 0' }}>No versions available.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {pickerVersions.map((v, idx) => {
                  const label = v.versionLabel ?? `v${pickerVersions.length - idx}`;
                  const isCurrent = editSnapshot[pickerStemId] === v.id;
                  const isDraft = !!v.pendingEditId;
                  return (
                    <div
                      key={v.id}
                      onClick={() => !isCurrent && handleHotswap(pickerStemId, v.id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '10px 12px', borderRadius: 8, cursor: isCurrent ? 'default' : 'pointer',
                        background: isCurrent ? 'var(--bg-hover)' : 'transparent',
                        border: `1px solid ${isCurrent ? 'var(--accent-dim)' : 'var(--border)'}`,
                      }}
                    >
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 600 }}>{label}</span>
                      {isDraft && <span style={{ fontSize: '10px', color: 'var(--accent)', fontWeight: 600 }}>draft</span>}
                      {v.notes && <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{v.notes}</span>}
                      <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--text-muted)' }}>
                        {new Date(v.createdAt!).toLocaleDateString()}
                      </span>
                      {isCurrent && <span style={{ fontSize: '11px', color: 'var(--accent-green)', fontWeight: 600 }}>current</span>}
                    </div>
                  );
                })}
              </div>
            )}
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setPickerStemId(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Upload modal */}
      {uploadStemId && (
        <EditUploadModal
          stemId={uploadStemId}
          editId={editId!}
          stemName={stems.find((s) => s.id === uploadStemId)?.name ?? ''}
          stemType={stems.find((s) => s.id === uploadStemId)?.type ?? 'AUDIO'}
          onClose={() => setUploadStemId(null)}
          onUploaded={async (versionId) => {
            const next = { ...editSnapshot, [uploadStemId]: versionId };
            await updateSnapshot(next);
            setUploadStemId(null);
          }}
        />
      )}

      {/* Open ER modal */}
      {showOpenER && edit && (
        <OpenERModal
          trackId={trackId!}
          editId={editId!}
          editSnapshot={editSnapshot}
          onClose={() => setShowOpenER(false)}
          onCreated={(er: EditRequest) => {
            setShowOpenER(false);
            navigate(`/project/${projectId}/track/${trackId}/edit-request/${er.id}`);
          }}
        />
      )}
    </>
  );
}

// ── Edit Upload Modal ─────────────────────────────────────────────────────────

interface EditUploadModalProps {
  stemId: string;
  editId: string;
  stemName: string;
  stemType: string;
  onClose: () => void;
  onUploaded: (versionId: string) => void;
}

function EditUploadModal({ stemId, editId, stemName, stemType, onClose, onUploaded }: EditUploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const isMidi = stemType === 'MIDI';

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      // Determine auto-increment label
      const existingRes = await client.models.StemVersion.list({ filter: { stemId: { eq: stemId } } });
      const versionCount = (existingRes.data ?? []).length;
      const versionLabel = `v${versionCount + 1}`;

      const ext = file.name.split('.').pop() ?? 'wav';
      const { identityId } = await fetchAuthSession();
      const entityId = identityId ?? 'unknown';
      const s3Key = `stems/${entityId}/stems/${stemId}/${Date.now()}.${ext}`;

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

      const res = await client.models.StemVersion.create({
        stemId,
        s3Key,
        versionLabel,
        notes: notes.trim() || undefined,
        fileSizeBytes: file.size,
        pendingEditId: editId,
      });
      if (res.errors) throw new Error(res.errors[0].message);
      onUploaded(res.data!.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
      setUploading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: '480px' }}>
        <h2 className="modal-title">Upload version — {stemName}</h2>
        <p style={{ margin: '0 0 16px', fontSize: '13px', color: 'var(--text-secondary)' }}>
          This version is a draft — it will be published when the edit request is merged.
        </p>

        <div className="form-group">
          <label className="form-label">File *</label>
          <input
            type="file"
            accept={isMidi ? '.mid,.midi' : '.wav,.aiff,.aif,.flac,.mp3,.ogg'}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            style={{ padding: '6px 8px', cursor: 'pointer' }}
          />
          {file && (
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: 4 }}>
              {file.name} — {(file.size / 1024 / 1024).toFixed(2)} MB
            </div>
          )}
        </div>

        <div className="form-group">
          <label className="form-label">Notes</label>
          <input type="text" placeholder="What changed in this version?" value={notes}
            onChange={(e) => setNotes(e.target.value)} />
        </div>

        {uploading && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ width: `${progress}%`, height: '100%', background: 'var(--accent)', transition: 'width 0.2s' }} />
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: 4 }}>Uploading… {progress}%</div>
          </div>
        )}
        {error && <p style={{ color: 'var(--accent-red)', fontSize: '13px', margin: '0 0 8px' }}>{error}</p>}

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose} disabled={uploading}>Cancel</button>
          <button className="btn-primary" onClick={handleUpload} disabled={uploading || !file}>
            {uploading ? `Uploading ${progress}%…` : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Open Edit Request Modal ───────────────────────────────────────────────────

interface OpenERModalProps {
  trackId: string;
  editId: string;
  editSnapshot: Snapshot;
  onClose: () => void;
  onCreated: (er: EditRequest) => void;
}

function OpenERModal({ trackId, editId, editSnapshot, onClose, onCreated }: OpenERModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await client.models.EditRequest.create({
        trackId,
        fromEditId: editId,
        title: title.trim(),
        description: description.trim() || undefined,
        proposedSnapshot: encodeSnapshot(editSnapshot),
        status: 'OPEN',
      });
      if (res.errors) throw new Error(res.errors[0].message);
      onCreated(res.data!);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to open edit request');
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: '480px' }}>
        <h2 className="modal-title">Open edit request</h2>
        <p style={{ margin: '0 0 16px', fontSize: '13px', color: 'var(--text-secondary)' }}>
          Propose this edit's mix to the track owner for review and merge into main.
        </p>

        <div className="form-group">
          <label className="form-label">Title *</label>
          <input type="text" placeholder="e.g. New kick, Verse rework, Mix v2"
            value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </div>
        <div className="form-group">
          <label className="form-label">Description</label>
          <textarea rows={2} placeholder="What did you change and why?"
            value={description} onChange={(e) => setDescription(e.target.value)} style={{ resize: 'vertical' }} />
        </div>

        {error && <p style={{ color: 'var(--accent-red)', fontSize: '13px', margin: '0 0 8px' }}>{error}</p>}

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary" onClick={handleCreate} disabled={saving || !title.trim()}>
            {saving ? 'Opening…' : 'Open edit request'}
          </button>
        </div>
      </div>
    </div>
  );
}
