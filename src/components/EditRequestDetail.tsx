import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { generateClient } from 'aws-amplify/data';
import { getUrl } from 'aws-amplify/storage';
import type { Schema } from '../../amplify/data/resource';
import { MixPlayer, type StemTrack } from './MixPlayer';
import { type Snapshot, encodeSnapshot, decodeSnapshot } from './snapshotUtils';

const client = generateClient<Schema>();

type EditRequest = Schema['EditRequest']['type'];
type Stem = Schema['Stem']['type'];
type StemVersion = Schema['StemVersion']['type'];

export function EditRequestDetail() {
  const { projectId, trackId, erId } = useParams<{ projectId: string; trackId: string; erId: string }>();
  const navigate = useNavigate();

  const [er, setEr] = useState<EditRequest | null>(null);
  const [stems, setStems] = useState<Stem[]>([]);
  const [versions, setVersions] = useState<Record<string, StemVersion>>({});
  const [mainSnapshot, setMainSnapshot] = useState<Snapshot>({});
  const [mixStems, setMixStems] = useState<StemTrack[] | null>(null);
  const [loadingMix, setLoadingMix] = useState(false);
  const [merging, setMerging] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!erId || !trackId) return;

    client.models.EditRequest.get({ id: erId }).then(async (res) => {
      const erData = res.data;
      setEr(erData);

      const trackRes = await client.models.Track.get({ id: trackId });
      setMainSnapshot(decodeSnapshot(trackRes.data?.mainSnapshot));

      const stemRes = await client.models.Stem.list({ filter: { trackId: { eq: trackId } } });
      setStems((stemRes.data ?? []).filter((s) => s.type !== 'MIX'));

      const proposed = decodeSnapshot(erData?.proposedSnapshot);
      const versionMap: Record<string, StemVersion> = {};
      await Promise.all(
        [...new Set(Object.values(proposed))].map(async (vId) => {
          const vRes = await client.models.StemVersion.get({ id: vId });
          if (vRes.data) versionMap[vId] = vRes.data;
        })
      );
      setVersions(versionMap);
      setLoading(false);
    });
  }, [erId, trackId]);

  const handlePlayProposed = async () => {
    if (!er) return;
    setLoadingMix(true);
    const proposed = decodeSnapshot(er.proposedSnapshot);
    const stemList = await Promise.all(
      Object.entries(proposed).map(async ([stemId, versionId]) => {
        const stem = stems.find((s) => s.id === stemId);
        const version = versions[versionId];
        if (!stem || !version) return null;
        const key = version.proxyS3Key ?? version.s3Key;
        if (!key) return null;
        try {
          const { url } = await getUrl({ path: key, options: { expiresIn: 3600 } });
          return { id: stemId, name: stem.name, category: stem.stemCategory, url: url.toString() } as StemTrack;
        } catch {
          return null;
        }
      })
    );
    setMixStems(stemList.filter(Boolean) as StemTrack[]);
    setLoadingMix(false);
  };

  const handleMerge = async () => {
    if (!er || !trackId) return;
    setMerging(true);
    try {
      const proposed = decodeSnapshot(er.proposedSnapshot);

      // Full replacement — proposed IS the new main, not a patch on top of it.
      // Stems absent from proposed are intentionally removed from the mix.
      await client.models.Track.update({
        id: trackId,
        mainSnapshot: encodeSnapshot(proposed),
      });

      // Sync each stem's activeVersionId to match the new main
      // Also publish any draft StemVersions (clear pendingEditId)
      await Promise.all(
        Object.entries(proposed).map(async ([stemId, versionId]) => {
          await client.models.Stem.update({ id: stemId, activeVersionId: versionId });
          const v = await client.models.StemVersion.get({ id: versionId });
          if (v.data?.pendingEditId) {
            await client.models.StemVersion.update({ id: versionId, pendingEditId: undefined });
          }
        })
      );

      await client.models.EditRequest.update({ id: er.id, status: 'MERGED' });
      navigate(`/project/${projectId}/track/${trackId}`);
    } finally {
      setMerging(false);
    }
  };

  const handleClose = async () => {
    if (!er) return;
    await client.models.EditRequest.update({ id: er.id, status: 'CLOSED' });
    setEr((p) => p ? { ...p, status: 'CLOSED' } : p);
  };

  const handleReopen = async () => {
    if (!er) return;
    await client.models.EditRequest.update({ id: er.id, status: 'OPEN' });
    setEr((p) => p ? { ...p, status: 'OPEN' } : p);
  };

  const handleDelete = async () => {
    if (!er) return;
    if (!confirm('Delete this edit request? This cannot be undone.')) return;
    await client.models.EditRequest.delete({ id: er.id });
    navigate(`/project/${projectId}/track/${trackId}`);
  };

  if (loading) return <div style={{ color: 'var(--text-muted)', padding: '40px 0' }}>Loading…</div>;
  if (!er) return (
    <div className="empty-state">
      <p>Edit request not found.</p>
      <Link to={`/project/${projectId}/track/${trackId}`}>Back</Link>
    </div>
  );

  const proposed = decodeSnapshot(er.proposedSnapshot);
  const isOpen = er.status === 'OPEN';
  const statusColor = er.status === 'MERGED' ? 'var(--accent-green)' : er.status === 'CLOSED' ? 'var(--text-muted)' : 'var(--accent)';

  // Stems removed by this proposal (in current main but absent from proposed)
  const removedStemIds = Object.keys(mainSnapshot).filter((id) => !proposed[id]);

  return (
    <>
      <Link to={`/project/${projectId}/track/${trackId}`} className="back-link">← Track</Link>

      <div className="page-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: statusColor, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {er.status === 'OPEN' ? '● Open' : er.status === 'MERGED' ? '⎇ Merged' : '✕ Closed'}
            </span>
          </div>
          <h1 className="page-title">{er.title}</h1>
          {er.description && (
            <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: '13px' }}>{er.description}</p>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button className="btn-secondary" onClick={handlePlayProposed} disabled={loadingMix || Object.keys(proposed).length === 0}>
            {loadingMix ? 'Loading…' : '▶ Play proposed mix'}
          </button>
          {isOpen && (
            <>
              <button className="btn-ghost btn-sm" onClick={handleClose} style={{ color: 'var(--text-muted)' }}>Close</button>
              <button className="btn-primary" onClick={handleMerge} disabled={merging}>
                {merging ? 'Committing…' : '⎇ Commit to main'}
              </button>
            </>
          )}
          {er.status === 'CLOSED' && (
            <button className="btn-secondary" onClick={handleReopen}>Reopen</button>
          )}
          {er.status !== 'MERGED' && (
            <button className="btn-ghost btn-sm" onClick={handleDelete} style={{ color: 'var(--accent-red)' }}>Delete</button>
          )}
        </div>
      </div>

      {mixStems && (
        <div className="card" style={{ marginBottom: 24 }}>
          <p className="section-title" style={{ margin: '0 0 12px' }}>Proposed mix</p>
          <MixPlayer stems={mixStems} />
        </div>
      )}

      <p className="section-title">
        Changes ({Object.keys(proposed).length} stem{Object.keys(proposed).length !== 1 ? 's' : ''} in proposed mix
        {removedStemIds.length > 0 && `, ${removedStemIds.length} removed`})
      </p>

      {Object.keys(proposed).length === 0 && removedStemIds.length === 0 ? (
        <div className="empty-state"><p>No stem changes in this edit request.</p></div>
      ) : (
        <>
          {/* Stems included in the proposed mix */}
          {stems
            .filter((s) => proposed[s.id])
            .map((stem) => {
              const proposedVersionId = proposed[stem.id];
              const mainVersionId = mainSnapshot[stem.id];
              const proposedVersion = versions[proposedVersionId];
              const isNew = !mainVersionId;
              const isChanged = mainVersionId && mainVersionId !== proposedVersionId;

              return (
                <div key={stem.id} className="version-row" style={{ display: 'flex', flexDirection: 'column', gap: 6, cursor: 'default' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="version-label">{stem.name}</span>
                    {stem.stemCategory && (
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)', background: 'var(--bg-hover)', padding: '1px 6px', borderRadius: '999px', border: '1px solid var(--border)' }}>
                        {stem.stemCategory}
                      </span>
                    )}
                    <span style={{
                      fontSize: '10px', fontWeight: 600, padding: '1px 8px', borderRadius: '999px',
                      background: isNew ? 'rgba(16,185,129,0.15)' : isChanged ? 'rgba(245,158,11,0.15)' : 'rgba(100,100,100,0.15)',
                      color: isNew ? 'var(--accent-green)' : isChanged ? 'var(--accent)' : 'var(--text-muted)',
                    }}>
                      {isNew ? 'new' : isChanged ? 'changed' : 'unchanged'}
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', display: 'flex', gap: 12 }}>
                    {mainVersionId && mainVersionId !== proposedVersionId && (
                      <span style={{ color: 'var(--accent-red)' }}>− {mainVersionId.slice(0, 8)}</span>
                    )}
                    <span style={{ color: 'var(--accent-green)' }}>
                      + {proposedVersionId.slice(0, 8)}
                      {proposedVersion?.versionLabel ? ` · ${proposedVersion.versionLabel}` : ''}
                      {proposedVersion?.notes ? ` — ${proposedVersion.notes}` : ''}
                    </span>
                  </div>
                </div>
              );
            })}

          {/* Stems intentionally removed from the mix */}
          {removedStemIds.map((stemId) => {
            const stem = stems.find((s) => s.id === stemId);
            const mainVersionId = mainSnapshot[stemId];
            return (
              <div key={stemId} className="version-row" style={{ display: 'flex', flexDirection: 'column', gap: 6, cursor: 'default', opacity: 0.6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="version-label">{stem?.name ?? stemId.slice(0, 8)}</span>
                  {stem?.stemCategory && (
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)', background: 'var(--bg-hover)', padding: '1px 6px', borderRadius: '999px', border: '1px solid var(--border)' }}>
                      {stem.stemCategory}
                    </span>
                  )}
                  <span style={{ fontSize: '10px', fontWeight: 600, padding: '1px 8px', borderRadius: '999px', background: 'rgba(239,68,68,0.15)', color: 'var(--accent-red)' }}>
                    removed
                  </span>
                </div>
                {mainVersionId && (
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    <span style={{ color: 'var(--accent-red)' }}>− {mainVersionId.slice(0, 8)}</span>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </>
  );
}
