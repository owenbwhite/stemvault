import { Routes, Route, Link, useNavigate } from 'react-router-dom';
import { Authenticator, useAuthenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import { ProjectDashboard } from './components/ProjectDashboard';
import { ProjectDetail } from './components/ProjectDetail';
import { TrackDetail } from './components/TrackDetail';
import { StemDetail } from './components/StemDetail';
import { EditRequestDetail } from './components/EditRequestDetail';
import { EditDetail } from './components/EditDetail';
import { JoinProject } from './components/JoinProject';

function Shell() {
  const { user, signOut } = useAuthenticator((ctx) => [ctx.user]);
  const navigate = useNavigate();

  const handleSignOut = () => {
    signOut();
    navigate('/');
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link to="/" className="topbar-logo">
          Stem<span>Vault</span>
        </Link>
        <div className="topbar-spacer" />
        <span className="topbar-user">{user?.signInDetails?.loginId}</span>
        <button className="btn-ghost btn-sm" onClick={handleSignOut}>
          Sign out
        </button>
      </header>
      <main className="page-content">
        <Routes>
          <Route path="/" element={<ProjectDashboard />} />
          <Route path="/project/:projectId" element={<ProjectDetail />} />
          <Route path="/project/:projectId/track/:trackId" element={<TrackDetail />} />
          <Route path="/project/:projectId/track/:trackId/stem/:stemId" element={<StemDetail />} />
          <Route path="/project/:projectId/track/:trackId/edit/:editId" element={<EditDetail />} />
          <Route path="/project/:projectId/track/:trackId/edit-request/:erId" element={<EditRequestDetail />} />
          <Route path="/join/:tokenId" element={<JoinProject />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <Authenticator>
      <Shell />
    </Authenticator>
  );
}
