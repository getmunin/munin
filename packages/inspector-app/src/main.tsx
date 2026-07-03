import { createRoot } from 'react-dom/client';
import '@getmunin/ui/styles/tokens.css';
import '@getmunin/ui/styles/fonts.css';
import './tailwind.css';
import './styles.css';
import { InspectorApp } from './app';

createRoot(document.getElementById('root')!).render(<InspectorApp />);
