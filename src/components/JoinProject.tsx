import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { generateClient } from 'aws-amplify/data';
import { useAuthenticator } from '@aws-amplify/ui-react';
import type { Schema } from '../../amplify/data/resource';

const client = generateClient<Schema>();

export function JoinProject() {
  const { tokenId } = useParams<{ tokenId: string }>();
  const { user } = useAuthenticator((ctx) => [ctx.user]);
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tokenId || !user?.userId) return;

    async function join() {
      try {
        const tokenRes = await client.models.InviteToken.get({ id: tokenId! });
        if (!tokenRes.data) {
          setError('Invalid or expired invite link.');
          return;
        }

        const { projectId, role } = tokenRes.data;

        const projectRes = await client.models.Project.get({ id: projectId });
        if (projectRes.data?.ownerId === user.userId) {
          navigate(`/project/${projectId}`, { replace: true });
          return;
        }

        const existing = await client.models.Collaborator.list({
          filter: { projectId: { eq: projectId }, userId: { eq: user.userId } },
        });

        if (!existing.data || existing.data.length === 0) {
          const email = user.signInDetails?.loginId ?? '';
          await client.models.Collaborator.create({
            projectId,
            userId: user.userId,
            email,
            role: role ?? 'VIEWER',
          });
        }

        navigate(`/project/${projectId}`, { replace: true });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to join project.');
      }
    }

    join();
  }, [tokenId, user?.userId]);

  if (error) {
    return (
      <div className="empty-state">
        <p>{error}</p>
        <button className="btn-primary" onClick={() => navigate('/')}>Go home</button>
      </div>
    );
  }

  return (
    <div style={{ color: 'var(--text-muted)', padding: '40px 0' }}>Joining project…</div>
  );
}
