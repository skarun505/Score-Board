import { Navigate, Route, Routes } from 'react-router-dom';
import TVPage from './pages/TVPage.jsx';
import TLPage from './pages/TLPage.jsx';
import CounselorPage from './pages/CounselorPage.jsx';
import AdminPage from './pages/AdminPage.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/tv" element={<TVPage />} />
      <Route path="/tl" element={<TLPage />} />
      <Route path="/counselor" element={<CounselorPage />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="*" element={<Navigate to="/tl" replace />} />
    </Routes>
  );
}
