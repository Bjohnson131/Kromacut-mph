import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { applyThemeMode, getStoredThemeMode } from './lib/theme';

// Apply the saved theme preference before React paints.
applyThemeMode(getStoredThemeMode());

// Keep browser tabs compact while the static HTML title remains descriptive for crawlers and previews.
document.title = 'Kromacut';

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <App />
    </StrictMode>
);
