import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { generateClient } from 'aws-amplify/data';
import { getUrl } from 'aws-amplify/storage';
import type { Schema } from '../../amplify/data/resource';
import { MixPlayer, type StemTrack } from './MixPlayer';
import { type Snapshot, encodeSnapshot, decodeSnapshot } from './snapshotUtils';

const client = generateClient<Schema>();

type PullRequest = Schema['PullRequest']['type'];
type Track = Schema['Track']['type'];
type Version = Schema['Version']['type'];

export function PullRequestDetail() {
  const { projectId, prId } = useParams<{ projectId: string; prId: string }>();
  const navigate = useNavigate();

  const [pr, setPr] = useState<PullRequest | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [versions, setVersions] = useState<Record<string, Version>>({});
  const [mainSnapshot, setMainSnapshot] = useState<Snapshot>({});
  const [mixStems, setMixStems] = useState<StemTrack[] | null>(null);
  const [loadingMix, setLoadingMix] = useState(false);
  const [merging, setMerging] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!prId || !projectId) return;

    client.models.PullRequest.get({ id: prId }).then(async (res) => {
      const prData = res.data;
      setPr(prData);

      // Load project main branch snapshot
      const projRes = await client.models.Project.get({ id: projectId });
      const mainBranchId = projRes.data?.mainBranchId;
      if (mainBranchId) {
        const branchRes = await client.models.Branch.get({ id: mainBranchId });
        setMainSnapshot(decodeSnapshot(branchRes.data?.snapshot));
      }

      // Load all tracks for this project
      const trackRes = await client.models.Track.list({
        filter: { projectId: { eq: projectId } },
      });
      const stemTracks = (trackRes.data ?? []).filter((t) => t.type !== 'MIX');
      setTracks(stemTracks);

      // Collect all version IDs from both main and proposed snapshots
      const proposed = decodeSnapshot(prData?.proposedSnapshot);
      const allVersionIds = new Set([
        ...Object.values(proposed),
      ]);

      const versionMap: Record<string, Version> = {};
      await Promise.all(
        [...allVersionIds].map(async (vId) => {
          const vRes = await client.models.Version.get({ id: vId });
          if (vRes.data) versionMap[vId] = vRes.data;
        })
      );
      setVersions(versionMap);
      setLoading(false);
    });
  }, [prId, projectId]);

  const handlePlayProposed = async () => {
    if (!pr) return;
    setLoadingMix(true);
    const proposed = decodeSnapshot(pr.proposedSnapshot);
    const stems = await Promise.all(
      Object.entries(proposed).map(async ([trackId, versionId]) => {
        const track = tracks.find((t) => t.id === trackId);
        const version = versions[versionId];
        if (!track || !version) return null;
        const key = version.proxyS3Key ?? version.s3Key;
        if (!key) return null;
        try {
          const { url } = await getUrl({ path: key, options: { expiresIn: 3600 } });
          return { id: trackId, name: track.name, category: track.stemCategory, url: url.toString() } as StemTrack;
        } catch {
          return null;
        }
      })
    );
    setMixStems(stems.filter(Boolean) as StemTrack[]);
    setLoadingMix(false);
  };

  const handleMerge = async () => {
    if (!pr || !projectId) return;
    setMerging(true);
    try {
      const proposed = decodeSnapshot(pr.proposedSnapshot);

      // Update each track's activeVersionId
      await Promise.all(
        Object.entries(proposed).map(([trackId, versionId]) =>
          client.models.Track.update({ id: trackId, activeVersionId: versionId })
        )
      );

      // Update the main branch snapshot
      const projRes = await client.models.Project.get({ id: projectId });
      const mainBranchId = projRes.data?.mainBranchId;
      if (mainBranchId) {
        const branchRes = await client.models.Branch.get({ id: mainBranchId });
        const currentSnapshot = decodeSnapshot(branchRes.data?.snapshot);
        await client.models.Branch.update({
          id: mainBranchId,
          snapshot: encodeSnapshot({ ...currentSnapshot, ...proposed }),
        });
      }

      // Close the PR as merged
      await client.models.PullRequest.update({ id: pr.id, status: 'MERGED' });
      navigate(`/project/${projectId}`);
    } finally {
      setMerging(false);
    }
  };

  const handleClose = async () => {
    if (!pr) return;
    await client.models.PullRequest.update({ id: pr.id, status: 'CLOSED' });
    setPr((p) => p ? { ...p, status: 'CLOSED' } : p);
  };

  const handleReopen = async () => {
    if (!pr) return;
    await client.models.PullRequest.update({ id: pr.id, status: 'OPEN' });
    setPr((p) => p ? { ...p, status: 'OPEN' } : p);
  };

  if (loading) return <div style={{ color: 'var(--text-muted)', padding: '40px 0' }}>Loading…</div>;
  if (!pr) return <div className="empty-state"><p>PR not found.</p><Link to={`/project/${projectId}`}>Back</Link></div>;

  const proposed = decodeSnapshot(pr.proposedSnapshot);
  const isOpen = pr.status === 'OPEN';

  const statusColor = pr.status === 'MERGED'
    ? 'var(--accent-green)'
    : pr.status === 'CLOSED'
    ? 'var(--text-muted)'
    : 'var(--accent)';

  return (
    <>
      <Link to={`/project/${projectId}`} className="back-link">← Project</Link>

      <div className="page-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: statusColor, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {pr.status === 'OPEN' ? '● Open' : pr.status === 'MERGED' ? '⎇ Merged' : '✕ Closed'}
            </span>
          </div>
          <h1 className="page-title">{pr.title}</h1>
          {pr.description && (
            <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: '13px' }}>{pr.description}</p>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn-secondary"
            onClick={handlePlayProposed}
            disabled={loadingMix || Object.keys(proposed).length === 0}
          >
            {loadingMix ? 'Loading…' : '▶ Play proposed mix'}
          </button>
          {isOpen && (
            <>
              <button className="btn-ghost btn-sm" onClick={handleClose} style={{ color: 'var(--text-muted)' }}>
                Close PR
              </button>
              <button className="btn-primary" onClick={handleMerge} disabled={merging}>
                {merging ? 'Merging…' : '⎇ Merge to main'}
              </button>
            </>
          )}
          {pr.status === 'CLOSED' && (
            <button className="btn-secondary" onClick={handleReopen}>Reopen</button>
          )}
        </div>
      </div>

      {/* Proposed mix player */}
      {mixStems && (
        <div className="card" style={{ marginBottom: 24 }}>
          <p className="section-title" style={{ margin: '0 0 12px' }}>Proposed mix</p>
          <MixPlayer stems={mixStems} />
        </div>
      )}

      {/* Changes table */}
      <p className="section-title">Changes ({Object.keys(proposed).length} stem{Object.keys(proposed).length !== 1 ? 's' : ''})</p>

      {Object.keys(proposed).length === 0 ? (
        <div className="empty-state"><p>No stem changes in this PR.</p></div>
      ) : (
        tracks
          .filter((t) => proposed[t.id])
          .map((track) => {
            const proposedVersionId = proposed[track.id];
            const mainVersionId = mainSnapshot[track.id];
            const proposedVersion = versions[proposedVersionId];
            const isNew = !mainVersionId;
            const isChanged = mainVersionId && mainVersionId !== proposedVersionId;

            return (
              <div key={track.id} className="version-row" style={{ display: 'flex', flexDirection: 'column', gap: 6, cursor: 'default' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="version-label">{track.name}</span>
                  {track.stemCategory && (
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)', background: 'var(--bg-hover)', padding: '1px 6px', borderRadius: '999px', border: '1px solid var(--border)' }}>
                      {track.stemCategory}
                    </span>
                  )}
                  <span style={{
                    fontSize: '10px', fontWeight: 600, padding: '1px 8px', borderRadius: '999px',
                    background: isNew ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)',
                    color: isNew ? 'var(--accent-green)' : 'var(--accent)',
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
          })
      )}
    </>
  );
}
