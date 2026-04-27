import { useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { generateClient } from 'aws-amplify/data';
import { uploadData, getUrl } from 'aws-amplify/storage';
import { fetchAuthSession } from 'aws-amplify/auth';
import type { Schema } from '../../amplify/data/resource';
import { MixPlayer, type StemTrack } from './MixPlayer';
import { type Snapshot, encodeSnapshot, decodeSnapshot } from './snapshotUtils';
import { STEM_CATEGORIES, classifyStem, type StemCategory } from './BulkUploadModal';

const client = generateClient<Schema>();

type Edit = Schema['Edit']['type'];
type Stem = Schema['Stem']['type'];
type EditRequest = Schema['EditRequest']['type'];


export function EditDetail() {
  const { projectId, trackId, editId } = useParams<{ projectId: string; trackId: string; editId: string }>();
  const navigate = useNavigate();

  const [edit, setEdit] = useState<Edit | null>(null);
  const [stems, setStems] = useState<Stem[]>([]);
  const [editSnapshot, setEditSnapshot] = useState<Snapshot>({});
  const [mixStems, setMixStems] = useState<StemTrack[] | null>(null);
  const [loadingMix, setLoadingMix] = useState(false);
  const [loading, setLoading] = useState(true);
  const autoLoadRef = useRef(false);

  // Per-stem upload state
  const [uploadStemId, setUploadStemId] = useState<string | null>(null);

  // Open ER state
  const [showOpenER, setShowOpenER] = useState(false);

  // Add new stem state
  const [showAddStem, setShowAddStem] = useState(false);
  const [showBulkUpload, setShowBulkUpload] = useState(false);

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
    setMixStems(null);
    // Reload mix with updated snapshot
    if (Object.keys(newSnapshot).length > 0) {
      setLoadingMix(true);
      const results = await Promise.all(
        Object.entries(newSnapshot).map(async ([stemId, versionId]) => {
          const stem = stems.find((s) => s.id === stemId);
          if (!stem) return null;
          try {
            const res = await client.models.StemVersion.get({ id: versionId });
            const key = res.data?.proxyS3Key ?? res.data?.s3Key;
            if (!key) return null;
            const { url } = await getUrl({ path: key, options: { expiresIn: 3600 } });
            return { id: stemId, name: stem.name, fileType: stem.type === 'MIDI' ? 'MIDI' : 'AUDIO', url: url.toString(), onNameClick: () => navigate(`/project/${projectId}/track/${trackId}/stem/${stemId}`) } as StemTrack;
          } catch { return null; }
        })
      );
      setMixStems(results.filter(Boolean) as StemTrack[]);
      setLoadingMix(false);
    }
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
          return { id: stemId, name: stem.name, category: stem.stemCategory, fileType: stem.type === 'MIDI' ? 'MIDI' : 'AUDIO', url: url.toString(), onNameClick: () => navigate(`/project/${projectId}/track/${trackId}/stem/${stemId}`) } as StemTrack;
        } catch { return null; }
      })
    );
    setMixStems(results.filter(Boolean) as StemTrack[]);
    setLoadingMix(false);
  };

  // Auto-load mix once edit + stems are ready
  useEffect(() => {
    if (autoLoadRef.current || loading || stems.length === 0) return;
    if (Object.keys(editSnapshot).length === 0) return;
    autoLoadRef.current = true;
    handleLoadMix();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, editSnapshot, stems]);

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
          <button className="btn-secondary" onClick={() => setShowAddStem(true)}>
            + Add stem
          </button>
          <button className="btn-secondary" onClick={() => setShowBulkUpload(true)}>
            ↑ Bulk upload
          </button>
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
      {includedCount > 0 && (
        <div className="card" style={{ marginBottom: 24 }}>
          {loadingMix || !mixStems ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-muted)', fontSize: '13px', padding: '4px 0' }}>
              <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span>
              Loading mix…
            </div>
          ) : (
            <MixPlayer
              stems={mixStems}
              renderStemExtra={(s) => (
                <>
                  <EditVersionSelect
                    stemId={s.id}
                    editId={editId!}
                    currentVersionId={editSnapshot[s.id]}
                    onSwap={handleHotswap}
                  />
                  <button
                    className="btn-ghost btn-sm"
                    title="Upload new version"
                    onClick={(e) => { e.stopPropagation(); setUploadStemId(s.id); }}
                    style={{ fontSize: '11px', flexShrink: 0, padding: '1px 6px' }}
                  >
                    ↑
                  </button>
                </>
              )}
            />
          )}
        </div>
      )}

      {/* Not in mix — stems excluded from this edit */}
      {stems.filter((s) => !editSnapshot[s.id]).length > 0 && (
        <>
          <p className="section-title" style={{ marginTop: 8, color: 'var(--text-muted)' }}>
            Not in mix ({stems.filter((s) => !editSnapshot[s.id]).length})
          </p>
          {stems.filter((s) => !editSnapshot[s.id]).map((stem) => (
            <div key={stem.id} className="version-row" style={{ cursor: 'default', opacity: 0.5 }}>
              <span className="version-label">{stem.name}</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button className="btn-secondary btn-sm" onClick={() => handleToggleStem(stem.id, true)}>
                  Add to mix
                </button>
                <button className="btn-ghost btn-sm" onClick={() => navigate(`/project/${projectId}/track/${trackId}/stem/${stem.id}`)}>
                  History →
                </button>
              </div>
            </div>
          ))}
        </>
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

      {/* Add new stem modal */}
      {showAddStem && (
        <AddStemToEditModal
          trackId={trackId!}
          editId={editId!}
          existingStemCount={stems.length}
          onClose={() => setShowAddStem(false)}
          onCreated={async (stemId, versionId) => {
            const next = { ...editSnapshot, [stemId]: versionId };
            await updateSnapshot(next);
            setShowAddStem(false);
          }}
        />
      )}

      {showBulkUpload && (
        <EditBulkUploadModal
          trackId={trackId!}
          editId={editId!}
          stems={stems}
          editSnapshot={editSnapshot}
          existingStemCount={stems.length}
          onClose={() => setShowBulkUpload(false)}
          onComplete={async (snap) => {
            await updateSnapshot(snap);
          }}
        />
      )}
    </>
  );
}

// ── Edit Version Select ───────────────────────────────────────────────────────

function EditVersionSelect({ stemId, editId, currentVersionId, onSwap }: {
  stemId: string;
  editId: string;
  currentVersionId: string;
  onSwap: (stemId: string, versionId: string) => void;
}) {
  const [versions, setVersions] = useState<Array<{ id: string; label: string; isDraft: boolean }> | null>(null);

  const load = async () => {
    if (versions) return;
    const res = await client.models.StemVersion.list({ filter: { stemId: { eq: stemId } } });
    const filtered = (res.data ?? []).filter((v) => !v.pendingEditId || v.pendingEditId === editId);
    const sorted = [...filtered].sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime());
    setVersions(sorted.map((v, idx) => ({
      id: v.id,
      label: v.versionLabel ?? `v${sorted.length - idx}`,
      isDraft: !!v.pendingEditId,
    })));
  };

  return (
    <select
      value={currentVersionId}
      onFocus={load}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => { if (e.target.value !== currentVersionId) onSwap(stemId, e.target.value); }}
      style={{ fontSize: '11px', padding: '2px 6px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-secondary)', cursor: 'pointer', flexShrink: 0, maxWidth: 100 }}
    >
      {versions === null ? (
        <option value={currentVersionId}>{currentVersionId.slice(0, 8)}</option>
      ) : (
        versions.map((v) => (
          <option key={v.id} value={v.id}>{v.label}{v.isDraft ? ' · draft' : ''}</option>
        ))
      )}
    </select>
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

// ── Edit Bulk Upload Modal ────────────────────────────────────────────────────

interface EditBulkRow {
  file: File;
  fileType: 'AUDIO' | 'MIDI';
  detectedCategory: StemCategory;
  targetStemId: string | null;
  newCategory: StemCategory;
  status: 'idle' | 'uploading' | 'done' | 'error';
  progress: number;
  error?: string;
}

interface EditBulkUploadModalProps {
  trackId: string;
  editId: string;
  stems: Stem[];
  editSnapshot: Snapshot;
  existingStemCount: number;
  onClose: () => void;
  onComplete: (updatedSnapshot: Snapshot) => void;
}

function EditBulkUploadModal({ trackId, editId, stems, editSnapshot, existingStemCount, onClose, onComplete }: EditBulkUploadModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<EditBulkRow[]>([]);
  const [uploading, setUploading] = useState(false);

  const addFiles = (files: FileList | File[]) => {
    const accepted = Array.from(files).filter((f) => /\.(wav|aiff?|flac|mp3|ogg|mid|midi)$/i.test(f.name));
    setRows((prev) => {
      const existing = new Set(prev.map((r) => r.file.name));
      const next = accepted
        .filter((f) => !existing.has(f.name))
        .map((f) => ({
          file: f,
          fileType: /\.midi?$/i.test(f.name) ? 'MIDI' as const : 'AUDIO' as const,
          detectedCategory: classifyStem(f.name),
          targetStemId: null,
          newCategory: classifyStem(f.name),
          status: 'idle' as const,
          progress: 0,
        }));
      return [...prev, ...next];
    });
  };

  const updateRow = <K extends keyof EditBulkRow>(idx: number, key: K, val: EditBulkRow[K]) =>
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [key]: val } : r)));

  const removeRow = (idx: number) => setRows((prev) => prev.filter((_, i) => i !== idx));

  const handleUploadAll = async () => {
    if (!rows.filter((r) => r.status === 'idle').length) return;
    setUploading(true);
    const snapshotUpdates: Record<string, string> = {};
    let newStemOffset = existingStemCount;

    await Promise.all(
      rows.map(async (row, idx) => {
        if (row.status !== 'idle') return;
        try {
          const { identityId } = await fetchAuthSession();
          const entityId = identityId ?? 'unknown';

          let stemId: string;
          if (row.targetStemId) {
            stemId = row.targetStemId;
          } else {
            const stemRes = await client.models.Stem.create({
              trackId,
              name: row.newCategory,
              type: row.fileType,
              stemCategory: row.newCategory,
              sortOrder: newStemOffset++,
              isActive: true,
            });
            if (stemRes.errors || !stemRes.data) throw new Error(stemRes.errors?.[0]?.message ?? 'Stem create failed');
            stemId = stemRes.data.id;
          }

          const existingVersions = await client.models.StemVersion.list({ filter: { stemId: { eq: stemId } } });
          const versionLabel = `v${(existingVersions.data ?? []).length + 1}`;

          const ext = row.file.name.split('.').pop() ?? 'wav';
          const s3Key = `stems/${entityId}/stems/${stemId}/${Date.now()}.${ext}`;

          updateRow(idx, 'status', 'uploading');
          await uploadData({
            path: s3Key,
            data: row.file,
            options: {
              contentType: row.file.type || 'application/octet-stream',
              onProgress: ({ transferredBytes, totalBytes }) => {
                if (totalBytes) updateRow(idx, 'progress', Math.round((transferredBytes / totalBytes) * 100));
              },
            },
          }).result;

          const vRes = await client.models.StemVersion.create({
            stemId,
            s3Key,
            versionLabel,
            fileSizeBytes: row.file.size,
            pendingEditId: editId,
          });
          if (vRes.errors || !vRes.data) throw new Error(vRes.errors?.[0]?.message ?? 'Version create failed');

          snapshotUpdates[stemId] = vRes.data.id;
          updateRow(idx, 'status', 'done');
        } catch (e) {
          updateRow(idx, 'status', 'error');
          updateRow(idx, 'error', e instanceof Error ? e.message : 'Upload failed');
        }
      })
    );

    setUploading(false);
    if (Object.keys(snapshotUpdates).length > 0) {
      onComplete({ ...editSnapshot, ...snapshotUpdates });
    }
  };

  const doneCount = rows.filter((r) => r.status === 'done').length;
  const errorCount = rows.filter((r) => r.status === 'error').length;
  const allDone = rows.length > 0 && rows.every((r) => r.status === 'done' || r.status === 'error');
  const idleCount = rows.filter((r) => r.status === 'idle').length;

  return (
    <div className="modal-overlay" onClick={!uploading ? onClose : undefined}>
      <div className="modal" style={{ width: '720px', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title" style={{ margin: '0 0 16px' }}>Bulk upload to edit</h2>

        <div
          onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files) addFiles(e.dataTransfer.files); }}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
          style={{ border: '2px dashed var(--border)', borderRadius: 10, padding: '24px', textAlign: 'center', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '13px', flexShrink: 0 }}
        >
          Drop audio files or <span style={{ color: 'var(--accent)' }}>browse</span>
          <div style={{ marginTop: 4, fontSize: '11px' }}>WAV · AIFF · FLAC · MP3 · MIDI</div>
          <input ref={fileInputRef} type="file" multiple accept=".wav,.aiff,.aif,.flac,.mp3,.ogg,.mid,.midi" style={{ display: 'none' }}
            onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
        </div>

        {rows.length > 0 && (
          <div style={{ flex: 1, overflowY: 'auto', marginTop: 16 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  <th style={{ textAlign: 'left', padding: '4px 6px', width: '30%' }}>File</th>
                  <th style={{ textAlign: 'left', padding: '4px 6px', width: '40%' }}>Target stem</th>
                  <th style={{ textAlign: 'left', padding: '4px 6px', width: '24%' }}>Status</th>
                  <th style={{ padding: '4px 6px', width: '6%' }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <tr key={row.file.name} style={{ borderTop: '1px solid var(--border-subtle)', background: row.status === 'error' ? 'rgba(239,68,68,0.05)' : row.status === 'done' ? 'rgba(16,185,129,0.05)' : undefined }}>
                    <td style={{ padding: '8px 6px' }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{row.file.name}</div>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: 1 }}>{(row.file.size / 1024 / 1024).toFixed(1)} MB</div>
                    </td>
                    <td style={{ padding: '8px 6px' }}>
                      <select
                        value={row.targetStemId ?? ''}
                        onChange={(e) => updateRow(idx, 'targetStemId', e.target.value || null)}
                        disabled={row.status !== 'idle'}
                        style={{ fontSize: '12px', padding: '3px 6px', width: '100%' }}
                      >
                        <option value="">— New stem —</option>
                        {stems.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}{s.stemCategory ? ` (${s.stemCategory})` : ''}</option>
                        ))}
                      </select>
                      {!row.targetStemId && (
                        <select
                          value={row.newCategory}
                          onChange={(e) => updateRow(idx, 'newCategory', e.target.value as StemCategory)}
                          disabled={row.status !== 'idle'}
                          style={{ fontSize: '12px', padding: '3px 6px', width: '100%', marginTop: 4 }}
                        >
                          {STEM_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      )}
                    </td>
                    <td style={{ padding: '8px 6px' }}>
                      {row.status === 'idle' && <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      {row.status === 'uploading' && (
                        <div>
                          <div style={{ height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                            <div style={{ width: `${row.progress}%`, height: '100%', background: 'var(--accent)', transition: 'width 0.2s' }} />
                          </div>
                          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: 2 }}>{row.progress}%</div>
                        </div>
                      )}
                      {row.status === 'done' && <span style={{ color: 'var(--accent-green)' }}>✓ Done</span>}
                      {row.status === 'error' && <span style={{ color: 'var(--accent-red)', fontSize: '11px' }} title={row.error}>✗ Error</span>}
                    </td>
                    <td style={{ padding: '8px 4px', textAlign: 'center' }}>
                      {row.status === 'idle' && (
                        <button className="btn-ghost btn-sm" onClick={() => removeRow(idx)} style={{ padding: '1px 5px', color: 'var(--text-muted)' }}>✕</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, flexShrink: 0 }}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            {rows.length > 0 && !uploading && !allDone && `${idleCount} file${idleCount !== 1 ? 's' : ''} ready — select a stem type or map to an existing stem`}
            {uploading && `${doneCount} / ${rows.length} uploaded…`}
            {allDone && <span style={{ color: errorCount ? 'var(--accent)' : 'var(--accent-green)' }}>{doneCount} uploaded{errorCount ? `, ${errorCount} failed` : ''}</span>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-secondary" onClick={onClose} disabled={uploading}>{allDone ? 'Close' : 'Cancel'}</button>
            {!allDone && (
              <button className="btn-primary" onClick={handleUploadAll} disabled={uploading || idleCount === 0}>
                {uploading ? `Uploading… ${doneCount}/${rows.length}` : `Upload ${idleCount} stem${idleCount !== 1 ? 's' : ''}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Add New Stem to Edit Modal ────────────────────────────────────────────────

interface AddStemToEditModalProps {
  trackId: string;
  editId: string;
  existingStemCount: number;
  onClose: () => void;
  onCreated: (stemId: string, versionId: string) => void;
}

function AddStemToEditModal({ trackId, editId, existingStemCount, onClose, onCreated }: AddStemToEditModalProps) {
  const [category, setCategory] = useState<StemCategory>(STEM_CATEGORIES[0]);
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    if (f) setCategory(classifyStem(f.name));
  };

  const handleCreate = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      // Create the Stem record
      const stemRes = await client.models.Stem.create({
        trackId,
        name: category,
        type: 'AUDIO',
        stemCategory: category || undefined,
        sortOrder: existingStemCount,
        isActive: true,
      });
      if (stemRes.errors) throw new Error(stemRes.errors[0].message);
      const stemId = stemRes.data!.id;

      // Upload file
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

      // Create StemVersion as a draft
      const vRes = await client.models.StemVersion.create({
        stemId,
        s3Key,
        versionLabel: 'v1',
        notes: notes.trim() || undefined,
        fileSizeBytes: file.size,
        pendingEditId: editId,
      });
      if (vRes.errors) throw new Error(vRes.errors[0].message);

      onCreated(stemId, vRes.data!.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create stem');
      setUploading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: '480px' }}>
        <h2 className="modal-title">Add new stem</h2>
        <p style={{ margin: '0 0 16px', fontSize: '13px', color: 'var(--text-secondary)' }}>
          Creates a new stem on this track, with the uploaded file as a draft version scoped to this edit.
        </p>

        <div className="form-group">
          <label className="form-label">File *</label>
          <input
            type="file"
            accept=".wav,.aiff,.aif,.flac,.mp3,.ogg"
            onChange={handleFileChange}
            style={{ padding: '6px 8px', cursor: 'pointer' }}
          />
          {file && (
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: 4 }}>
              {file.name} — {(file.size / 1024 / 1024).toFixed(2)} MB
            </div>
          )}
        </div>

        <div className="form-group">
          <label className="form-label">Type *</label>
          <select value={category} onChange={(e) => setCategory(e.target.value as StemCategory)}>
            {STEM_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Notes</label>
          <input
            type="text"
            placeholder="Optional notes about this version"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
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
          <button className="btn-primary" onClick={handleCreate} disabled={uploading || !file}>
            {uploading ? `Uploading ${progress}%…` : 'Create stem'}
          </button>
        </div>
      </div>
    </div>
  );
}
