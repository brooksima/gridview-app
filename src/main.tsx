import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import 'leaflet/dist/leaflet.css';
import './styles.css';
import App from './App';
import DemoView from './components/DemoView';
import { isDemoRoute } from './lib/supabase';

function Root() {
  const [demo, setDemo] = useState(isDemoRoute);
  useEffect(() => {
    const on = () => setDemo(isDemoRoute());
    window.addEventListener('hashchange', on); window.addEventListener('popstate', on);
    return () => { window.removeEventListener('hashchange', on); window.removeEventListener('popstate', on); };
  }, []);
  return demo ? <DemoView /> : <App />;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Root /></StrictMode>);
