import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { generateClient } from 'aws-amplify/data';
import { getUrl, uploadData } from 'aws-amplify/storage';
import { proxiesBucketOption } from '../utils/storage';
import { fetchAuthSession } from 'aws-amplify/auth';
import { useAuthenticator } from '@aws-amplify/ui-react';
import type { Schema } from '../../amplify/data/resource';
import { type Snapshot, encodeSnapshot, decodeSnapshot } from './snapshotUtils';
import { BulkUploadModal, STEM_CATEGORIES, type StemCategory } from './BulkUploadModal';
import { KEY_OPTIONS } from './ProjectDetail';
import { MixPlayer, type StemTrack } from './MixPlayer';
import { parseAls, scanFromFiles, matchGroupsToFiles } from '../utils/parseAls';
import type { AlsGroup } from '../utils/parseAls';

const client = generateClient<Schema>();

type Track = Schema['Track']['type'];
type Stem = Schema['Stem']['type'];
type Edit = Schema['Edit']['type'];
type EditRequest = Schema['EditRequest']['type'];
type StemType = 'AUDIO' | 'MIDI' | 'INSTRUMENT' | 'MIX';

type Tab = 'current' | 'edits' | 'edit-requests';

interface AlsImportRow {
  group: AlsGroup;
  category: StemCategory;
  file: File | null;
  targetStemId?: string;
}

interface AlsImportData {
  bpm: string;
  key: string;
  rows: AlsImportRow[];
  noExports: boolean;
}

export function TrackDetail() {
  const { projectId, trackId } = useParams<{ projectId: string; trackId: string }>();
  const { user } = useAuthenticator((ctx) => [ctx.user]);
  const navigate = useNavigate();

  const [track, setTrack] = useState<Track | null>(null);
  const [stems, setStems] = useState<Stem[]>([]);
  const [edits, setEdits] = useState<Edit[]>([]);
  const [editRequests, setEditRequests] = useState<EditRequest[]>([]);
  const [projectOwnerId, setProjectOwnerId] = useState<string | null>(null);
  const [collaborators, setCollaborators] = useState<Schema['Collaborator']['type'][]>([]);
  const [tab, setTab] = useState<Tab>('current');
  const [masterMixStems, setMasterMixStems] = useState<StemTrack[] | null>(null);
  const [loadingMasterMix, setLoadingMasterMix] = useState(false);
  const autoLoadRef = useRef(false);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [showAddStem, setShowAddStem] = useState(false);
  const [showCreateEdit, setShowCreateEdit] = useState(false);
  const [showEditTrack, setShowEditTrack] = useState(false);
  const [editTrackForm, setEditTrackForm] = useState<{ title: string; bpm: string; keySignature: string } | null>(null);
  const [newStemName, setNewStemName] = useState('');
  const [newStemType, setNewStemType] = useState<StemType>('AUDIO');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const [alsScanning, setAlsScanning] = useState(false);
  const [alsImportData, setAlsImportData] = useState<AlsImportData | null>(null);
  const [alsImporting, setAlsImporting] = useState(false);
  const [alsImportProgress, setAlsImportProgress] = useState({ current: 0, total: 0 });
  const alsDirInputRef = useRef<HTMLInputElement>(null);

  const isOwner = !!user?.userId && !!projectOwnerId && user.userId === projectOwnerId;
  const isEditor = isOwner || collaborators.some((c) => c.userId === user?.userId && c.role === 'EDITOR');

  useEffect(() => {
    if (!trackId) return;
    client.models.Track.get({ id: trackId }).then((res) => {
      setTrack(res.data);
      setLoading(false);
    });
    let colSub: { unsubscribe: () => void } | undefined;
    if (projectId) {
      client.models.Project.get({ id: projectId }).then((res) => {
        setProjectOwnerId(res.data?.ownerId ?? null);
      });
      colSub = client.models.Collaborator.observeQuery({
        filter: { projectId: { eq: projectId } },
      }).subscribe({
        next: ({ items }) => setCollaborators([...items]),
      });
    }

    const stemSub = client.models.Stem.observeQuery({
      filter: { trackId: { eq: trackId } },
    }).subscribe({
      next: ({ items }) => setStems([...items].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))),
    });

    const editSub = client.models.Edit.observeQuery({
      filter: { trackId: { eq: trackId } },
    }).subscribe({
      next: ({ items }) => setEdits(
        [...items].sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime())
      ),
    });

    const erSub = client.models.EditRequest.observeQuery({
      filter: { trackId: { eq: trackId } },
    }).subscribe({
      next: ({ items }) => setEditRequests(
        [...items].sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime())
      ),
    });

    return () => { stemSub.unsubscribe(); editSub.unsubscribe(); erSub.unsubscribe(); colSub?.unsubscribe(); };
  }, [trackId, projectId]);

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
          const { url } = await getUrl({ path: key, options: { ...(res.data?.proxyS3Key ? { bucket: proxiesBucketOption } : {}), expiresIn: 3600 } });
          return {
            id: stemId,
            name: stem.name,
            fileType: stem.type === 'MIDI' ? 'MIDI' : 'AUDIO',
            url: url.toString(),
            onNameClick: () => navigate(`/project/${projectId}/track/${trackId}/stem/${stemId}`),
          } as StemTrack;
        } catch {
          return null;
        }
      })
    );
    setMasterMixStems(results.filter(Boolean) as StemTrack[]);
    setLoadingMasterMix(false);
  };

  // Auto-load the mix once track + stems are ready.
  // Falls back to stems' activeVersionId when mainSnapshot is empty (e.g. fresh als import).
  useEffect(() => {
    if (autoLoadRef.current || loading || !track || stems.length === 0) return;
    const snapshot = decodeSnapshot(track.mainSnapshot);
    const effectiveSnapshot: Snapshot = Object.keys(snapshot).length > 0
      ? snapshot
      : Object.fromEntries(stems.filter(s => s.activeVersionId).map(s => [s.id, s.activeVersionId!]));
    if (Object.keys(effectiveSnapshot).length === 0) return;
    autoLoadRef.current = true;
    loadMasterMix(effectiveSnapshot);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, track, stems]);

  const handleHotswapInMain = async (stemId: string, versionId: string) => {
    if (!trackId || !track) return;
    const current = decodeSnapshot(track.mainSnapshot);
    const next = { ...current, [stemId]: versionId };
    const encoded = encodeSnapshot(next);
    await client.models.Track.update({ id: trackId, mainSnapshot: encoded });
    await client.models.Stem.update({ id: stemId, activeVersionId: versionId });
    setTrack((t) => t ? { ...t, mainSnapshot: encoded } : t);
    await loadMasterMix(next);
  };

  const handleConfirmAlsImport = async () => {
    if (!alsImportData || !trackId) return;
    const filesCount = alsImportData.rows.filter(r => r.file != null).length;
    setAlsImportProgress({ current: 0, total: filesCount });
    setAlsImporting(true);
    try {
      // Optionally back-fill BPM/key onto the track if it doesn't have them
      if (track && (alsImportData.bpm || alsImportData.key)) {
        const needsBpm = !track.bpm && alsImportData.bpm;
        const needsKey = !track.keySignature && alsImportData.key;
        if (needsBpm || needsKey) {
          const res = await client.models.Track.update({
            id: trackId,
            ...(needsBpm ? { bpm: parseInt(alsImportData.bpm, 10) } : {}),
            ...(needsKey ? { keySignature: alsImportData.key } : {}),
          });
          if (res.data) setTrack(res.data);
        }
      }

      const { identityId } = await fetchAuthSession();
      const entityId = identityId ?? 'unknown';

      const snapshotEntries = (await Promise.all(
        alsImportData.rows.map(async (row, idx) => {
          let stemId: string;
          if (row.targetStemId) {
            stemId = row.targetStemId;
          } else {
            const stemRes = await client.models.Stem.create({
              trackId,
              name: row.group.name,
              stemCategory: row.category,
              type: 'AUDIO',
              sortOrder: stems.length + idx,
              isActive: true,
            });
            if (stemRes.errors || !stemRes.data) return null;
            stemId = stemRes.data.id;
          }

          if (!row.file) return null;

          const ext = row.file.name.split('.').pop() ?? 'wav';
          const versionId = crypto.randomUUID();
          const s3Key = `stems/${entityId}/stems/${stemId}/${versionId}.${ext}`;
          await uploadData({
            path: s3Key,
            data: row.file,
            options: { contentType: row.file.type || 'application/octet-stream' },
          }).result;

          const existingVersions = await client.models.StemVersion.list({ filter: { stemId: { eq: stemId } } });
          const nextLabel = `v${(existingVersions.data?.length ?? 0) + 1}`;
          const versionRes = await client.models.StemVersion.create({
            id: versionId,
            stemId,
            s3Key,
            versionLabel: nextLabel,
            fileSizeBytes: row.file.size,
          });
          if (versionRes.errors || !versionRes.data) return null;
          await client.models.Stem.update({ id: stemId, activeVersionId: versionRes.data.id });

          setAlsImportProgress(p => ({ ...p, current: p.current + 1 }));
          return [stemId, versionRes.data.id] as [string, string];
        })
      )).filter((e): e is [string, string] => e !== null);

      if (snapshotEntries.length > 0) {
        const current = decodeSnapshot(track?.mainSnapshot);
        const next = { ...current, ...Object.fromEntries(snapshotEntries) };
        const encoded = encodeSnapshot(next);
        await client.models.Track.update({ id: trackId, mainSnapshot: encoded });
        setTrack(t => t ? { ...t, mainSnapshot: encoded } : t);
        autoLoadRef.current = false;
      }

      setAlsImportData(null);
    } finally {
      setAlsImporting(false);
    }
  };

  const updateAlsRow = (idx: number, category: StemCategory) => {
    setAlsImportData(d => d ? { ...d, rows: d.rows.map((r, i) => i === idx ? { ...r, category } : r) } : d);
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


  const handleUpdateTrack = async () => {
    if (!editTrackForm || !trackId || !editTrackForm.title.trim()) return;
    setSaving(true);
    try {
      const res = await client.models.Track.update({
        id: trackId,
        title: editTrackForm.title.trim(),
        bpm: editTrackForm.bpm ? parseInt(editTrackForm.bpm, 10) : undefined,
        keySignature: editTrackForm.keySignature || undefined,
      });
      if (res.data) setTrack(res.data);
      setShowEditTrack(false);
      setEditTrackForm(null);
    } finally {
      setSaving(false);
    }
  };

  const stemItems = stems.filter((s) => s.type !== 'MIX');
  const mainSnapshot = track ? decodeSnapshot(track.mainSnapshot) : {};
  const untrackedStems = stemItems.filter((s) => !mainSnapshot[s.id] && s.activeVersionId);
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
          <div className="meta-row">
            {track.bpm && <span className="meta-item"><strong>{track.bpm}</strong> BPM</span>}
            {track.keySignature && <span className="meta-item"><strong>{track.keySignature}</strong></span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {isEditor && (
            <button
              className="btn-ghost btn-sm"
              style={{ color: 'var(--text-muted)' }}
              onClick={() => {
                setEditTrackForm({ title: track.title, bpm: track.bpm ? String(track.bpm) : '', keySignature: track.keySignature ?? '' });
                setShowEditTrack(true);
              }}
            >
              Edit track
            </button>
          )}
          {tab === 'current' && isEditor && (
            <>
              <button className="btn-secondary" onClick={() => setShowAddStem(true)}>+ Add stem</button>
              <button className="btn-secondary" onClick={() => setShowBulkUpload(true)}>↑ Upload stems</button>
              <button
                className="btn-secondary"
                disabled={alsScanning}
                onClick={() => alsDirInputRef.current?.click()}
              >
                {alsScanning ? 'Scanning…' : '↓ Import from .als'}
              </button>
              <input
                ref={alsDirInputRef}
                type="file"
                multiple
                style={{ display: 'none' }}
                {...{ webkitdirectory: '' }}
                onChange={async (e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = '';
                  if (!files.length) return;
                  setAlsScanning(true);
                  try {
                    const { alsFile, audioFiles, hasAudio } = scanFromFiles(files);
                    if (!alsFile) { alert('No .als file found. Select the Ableton project folder.'); return; }
                    const als = await parseAls(alsFile);
                    const matches = matchGroupsToFiles(audioFiles, als.groups);
                    setAlsImportData({
                      bpm: als.bpm != null ? String(Math.round(als.bpm)) : '',
                      key: als.key ?? '',
                      rows: matches.map(m => {
                        const existing = stems.find(s => s.stemCategory === m.group.category);
                        return { group: m.group, category: m.group.category, file: m.file, targetStemId: existing?.id };
                      }),
                      noExports: !hasAudio,
                    });
                  } finally {
                    setAlsScanning(false);
                  }
                }}
              />
            </>
          )}
          {tab === 'edits' && (
            <button className="btn-primary" onClick={() => setShowCreateEdit(true)}>+ New edit</button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
        {(['current', 'edits', 'edit-requests'] as Tab[]).map((t) => {
          const labels: Record<Tab, string> = {
            current: 'Current',
            edits: `Edits${edits.filter((e) => !e.isArchived).length > 0 ? ` (${edits.filter((e) => !e.isArchived).length})` : ''}`,
            'edit-requests': `Edit Requests${openERs.length > 0 ? ` (${openERs.length} open)` : editRequests.length > 0 ? ` (${editRequests.length})` : ''}`,
          };
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: '8px 16px',
                fontSize: '13px', fontWeight: tab === t ? 600 : 400,
                color: tab === t ? 'var(--text-primary)' : 'var(--text-muted)',
                borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
                marginBottom: '-1px',
              }}
            >
              {labels[t]}
            </button>
          );
        })}
      </div>

      {/* ── Current tab ─────────────────────────────────────────────────────── */}
      {tab === 'current' && (
        <>
          {Object.keys(mainSnapshot).length === 0 && !loadingMasterMix ? (
            <div className="empty-state">
              <div className="empty-state-icon">🎚️</div>
              <p>No main mix yet.{isEditor ? ' Upload stems to get started.' : ' The owner has not added stems yet.'}</p>
              {isEditor && (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="btn-secondary" onClick={() => setShowAddStem(true)}>Add stem</button>
                  <button className="btn-secondary" onClick={() => setShowBulkUpload(true)}>Upload stems</button>
                </div>
              )}
            </div>
          ) : loadingMasterMix || !masterMixStems ? (
            <div className="card" style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-muted)', fontSize: '13px', padding: '4px 0' }}>
                <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span>
                Loading mix…
              </div>
            </div>
          ) : (
            <div className="card" style={{ marginBottom: 24 }}>
              <MixPlayer
                stems={masterMixStems}
                renderStemExtra={(s) => (
                  <StemVersionSelect
                    stemId={s.id}
                    currentVersionId={mainSnapshot[s.id]}
                    onSwap={handleHotswapInMain}
                  />
                )}
              />
            </div>
          )}

          {/* Stems added but not yet in the main mix — editors only */}
          {isEditor && untrackedStems.length > 0 && (
            <>
              <p className="section-title" style={{ marginTop: 8, color: 'var(--text-muted)' }}>
                Not in mix ({untrackedStems.length})
              </p>
              {untrackedStems.map((stem) => (
                <div key={stem.id} className="version-row" style={{ cursor: 'default', opacity: 0.6 }}>
                  <span className="version-label">{stem.name}</span>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                    <button
                      className="btn-secondary btn-sm"
                      onClick={() => handleHotswapInMain(stem.id, stem.activeVersionId!)}
                    >
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
        </>
      )}

      {/* ── Edits tab ────────────────────────────────────────────────────────── */}
      {tab === 'edits' && (
        <>
          {edits.filter((e) => !e.isArchived).length === 0 && edits.filter((e) => e.isArchived).length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">⎇</div>
              <p>No edits yet. Create an edit to propose changes to this track.</p>
              <button className="btn-primary" onClick={() => setShowCreateEdit(true)}>New edit</button>
            </div>
          ) : (
            <>
              {edits.filter((e) => !e.isArchived).map((edit) => (
                <EditRow
                  key={edit.id}
                  edit={edit}
                  onClick={() => navigate(`/project/${projectId}/track/${trackId}/edit/${edit.id}`)}
                />
              ))}
              {edits.filter((e) => e.isArchived).length > 0 && (
                <>
                  <p className="section-title" style={{ marginTop: 24, opacity: 0.5 }}>Archived</p>
                  {edits.filter((e) => e.isArchived).map((edit) => (
                    <EditRow
                      key={edit.id}
                      edit={edit}
                      onClick={() => navigate(`/project/${projectId}/track/${trackId}/edit/${edit.id}`)}
                    />
                  ))}
                </>
              )}
            </>
          )}
        </>
      )}

      {/* ── Edit Requests tab ────────────────────────────────────────────────── */}
      {tab === 'edit-requests' && (
        <>
          {editRequests.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">↑</div>
              <p>No edit requests yet. Open an edit request from within an edit.</p>
            </div>
          ) : (
            <>
              {openERs.map((er) => (
                <EditRequestRow key={er.id} er={er} onClick={() => navigate(`/project/${projectId}/track/${trackId}/edit-request/${er.id}`)} />
              ))}
              {closedERs.map((er) => (
                <EditRequestRow key={er.id} er={er} onClick={() => navigate(`/project/${projectId}/track/${trackId}/edit-request/${er.id}`)} />
              ))}
            </>
          )}
        </>
      )}

      {/* ── Modals ───────────────────────────────────────────────────────────── */}

      {alsImportData && (
        <div className="modal-overlay">
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ width: '620px', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
          >
            <h2 className="modal-title">Import from Ableton</h2>

            {alsImportData.noExports && (
              <div style={{
                background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.4)',
                borderRadius: 8, padding: '10px 14px', marginBottom: 12,
                fontSize: '12px', color: '#f59e0b',
              }}>
                No audio files found in this folder. Stems will be created empty — attach files later via "Upload stems".
              </div>
            )}

            {(alsImportData.bpm || alsImportData.key) && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                {alsImportData.bpm && !track?.bpm && (
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">BPM (from .als — will update track)</label>
                    <input
                      type="number" min={20} max={300}
                      value={alsImportData.bpm}
                      onChange={(e) => setAlsImportData(d => d ? { ...d, bpm: e.target.value } : d)}
                    />
                  </div>
                )}
                {alsImportData.key && !track?.keySignature && (
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Key (from .als — will update track)</label>
                    <select
                      value={alsImportData.key}
                      onChange={(e) => setAlsImportData(d => d ? { ...d, key: e.target.value } : d)}
                    >
                      <option value="">—</option>
                      {KEY_OPTIONS.map((k) => <option key={k} value={k}>{k}</option>)}
                    </select>
                  </div>
                )}
              </div>
            )}

            <div style={{ flex: 1, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    <th style={{ textAlign: 'left', padding: '4px 6px', width: '28%' }}>Group</th>
                    <th style={{ textAlign: 'left', padding: '4px 6px', width: '32%' }}>Category</th>
                    <th style={{ textAlign: 'left', padding: '4px 6px' }}>Audio file</th>
                  </tr>
                </thead>
                <tbody>
                  {alsImportData.rows.map((row, idx) => (
                    <tr key={row.group.alsId} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '6px 6px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                        {row.group.name}
                      </td>
                      <td style={{ padding: '6px 6px' }}>
                        <select
                          value={row.category}
                          onChange={(e) => updateAlsRow(idx, e.target.value as StemCategory)}
                          disabled={alsImporting}
                          style={{ fontSize: '12px', padding: '3px 6px' }}
                        >
                          {STEM_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: '6px 6px', color: row.file ? 'var(--text-secondary)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
                        {row.file ? row.file.name : <span style={{ fontStyle: 'italic' }}>— no match</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, flexShrink: 0 }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {alsImportData.rows.filter(r => r.file).length} of {alsImportData.rows.length} stems matched to audio
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-secondary" onClick={() => setAlsImportData(null)} disabled={alsImporting}>
                  Cancel
                </button>
                <button
                  className="btn-primary"
                  onClick={handleConfirmAlsImport}
                  disabled={alsImporting}
                >
                  {alsImporting
                    ? alsImportProgress.total > 0
                      ? `Uploading ${alsImportProgress.current}/${alsImportProgress.total}…`
                      : 'Creating…'
                    : `Import ${alsImportData.rows.length} stem${alsImportData.rows.length !== 1 ? 's' : ''}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showBulkUpload && (
        <BulkUploadModal
          trackId={trackId!}
          existingStemCount={stems.length}
          existingCategories={stems.filter((s) => s.stemCategory).map((s) => s.stemCategory as StemCategory)}
          existingStems={stems
            .filter((s) => s.stemCategory && s.id)
            .map((s) => ({ id: s.id, stemCategory: s.stemCategory!, name: s.name }))}
          onClose={() => setShowBulkUpload(false)}
        />
      )}

      {showCreateEdit && (
        <CreateEditModal
          trackId={trackId!}
          createdBy={user?.userId ?? 'unknown'}
          mainSnapshot={mainSnapshot}
          onClose={() => setShowCreateEdit(false)}
          onCreated={(edit) => {
            setShowCreateEdit(false);
            navigate(`/project/${projectId}/track/${trackId}/edit/${edit.id}`);
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

      {showEditTrack && editTrackForm && (
        <div className="modal-overlay" onClick={() => { setShowEditTrack(false); setEditTrackForm(null); }}>
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
              <button className="btn-secondary" onClick={() => { setShowEditTrack(false); setEditTrackForm(null); }} disabled={saving}>Cancel</button>
              <button className="btn-primary" onClick={handleUpdateTrack} disabled={saving || !editTrackForm.title.trim()}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function EditRow({ edit, onClick }: { edit: Edit; onClick: () => void }) {
  return (
    <div className="version-row" onClick={onClick} style={{ cursor: 'pointer', opacity: edit.isArchived ? 0.45 : 1 }}>
      <span className="version-label">{edit.name}</span>
      {edit.description && <span className="version-notes">{edit.description}</span>}
      <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
        {Object.keys(edit.snapshot ? JSON.parse(edit.snapshot as string) : {}).length} stems
      </span>
      {edit.isArchived && (
        <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', border: '1px solid var(--border)', padding: '1px 6px', borderRadius: '4px' }}>archived</span>
      )}
      <span className="version-meta">{new Date(edit.createdAt!).toLocaleDateString()}</span>
    </div>
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

function StemVersionSelect({ stemId, currentVersionId, onSwap }: {
  stemId: string;
  currentVersionId: string | undefined;
  onSwap: (stemId: string, versionId: string) => void;
}) {
  const [versions, setVersions] = useState<Array<{ id: string; label: string }> | null>(null);

  useEffect(() => {
    client.models.StemVersion.list({ filter: { stemId: { eq: stemId } } }).then((res) => {
      const published = (res.data ?? [])
        .filter((v) => !v.pendingEditId)
        .sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime());
      setVersions(published.map((v, idx) => ({
        id: v.id,
        label: v.versionLabel ?? `v${published.length - idx}`,
      })));
    });
  }, [stemId]);

  if (!currentVersionId) return null;

  return (
    <select
      value={currentVersionId}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => { e.stopPropagation(); if (e.target.value !== currentVersionId) onSwap(stemId, e.target.value); }}
      style={{ fontSize: '11px', padding: '2px 6px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-secondary)', cursor: 'pointer', flexShrink: 0, maxWidth: 100 }}
    >
      {versions === null ? (
        <option value={currentVersionId}>…</option>
      ) : (
        versions.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)
      )}
    </select>
  );
}

// ── Create Edit Modal ─────────────────────────────────────────────────────────

function nanoid6() {
  return Math.random().toString(36).slice(2, 8);
}

interface CreateEditModalProps {
  trackId: string;
  createdBy: string;
  mainSnapshot: Snapshot;
  onClose: () => void;
  onCreated: (edit: Edit) => void;
}

function CreateEditModal({ trackId, createdBy, mainSnapshot, onClose, onCreated }: CreateEditModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slug = title.trim()
    ? `${title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${nanoid6()}`
    : '';

  const handleCreate = async () => {
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await client.models.Edit.create({
        trackId,
        name: slug,
        description: description.trim() || undefined,
        createdBy,
        snapshot: encodeSnapshot(mainSnapshot),
      });
      if (res.errors) throw new Error(res.errors[0].message);
      onCreated(res.data!);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create edit');
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: '480px' }}>
        <h2 className="modal-title">New edit</h2>
        <p style={{ margin: '0 0 16px', fontSize: '13px', color: 'var(--text-secondary)' }}>
          An edit is a branch of the current main mix. Make your changes, then open an edit request when ready.
        </p>

        <div className="form-group">
          <label className="form-label">Title *</label>
          <input
            type="text"
            placeholder="e.g. Verse rework, New kick, Mix v2"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
          {slug && (
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
              id: {slug}
            </div>
          )}
        </div>
        <div className="form-group">
          <label className="form-label">Description</label>
          <textarea rows={2} placeholder="What are you changing and why?" value={description}
            onChange={(e) => setDescription(e.target.value)} style={{ resize: 'vertical' }} />
        </div>

        {error && <p style={{ color: 'var(--accent-red)', fontSize: '13px', margin: '0 0 8px' }}>{error}</p>}

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary" onClick={handleCreate} disabled={saving || !title.trim()}>
            {saving ? 'Creating…' : 'Create edit'}
          </button>
        </div>
      </div>
    </div>
  );
}
