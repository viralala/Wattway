/**
 * WattWay · Team Kothimbir 🌿
 * App.tsx — the route table. Home has its own full-bleed hero; every other page
 * shares the backdrop Layout.
 */
import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import Home from './pages/Home';
import ComingSoon from './pages/ComingSoon';
import AlgorithmLab from './pages/AlgorithmLab';
import Stations from './pages/Stations';
import RoutePlanner from './pages/RoutePlanner';
import Queue from './pages/Queue';
import Dashboard from './pages/Dashboard';
import Account from './pages/Account';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout backdrop={false} />}>
        <Route index element={<Home />} />
      </Route>
      <Route element={<Layout />}>
        <Route path="stations" element={<Stations />} />
        <Route path="route" element={<RoutePlanner />} />
        <Route path="queue" element={<Queue />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="account" element={<Account />} />
        <Route path="lab" element={<AlgorithmLab />} />
        <Route path="*" element={<ComingSoon title="Lost on the map" blurb="That page doesn’t exist." />} />
      </Route>
    </Routes>
  );
}
