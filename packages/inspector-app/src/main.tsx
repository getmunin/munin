import { createRoot } from 'react-dom/client';
import '@getmunin/ui/styles/tokens.css';
import './fonts.css';
import './styles.css';
import { InspectorApp } from './app';

createRoot(document.getElementById('root')!).render(<InspectorApp />);
