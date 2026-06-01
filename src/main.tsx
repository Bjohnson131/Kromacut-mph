import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

// Apply saved theme preference, default to dark
const savedTheme = localStorage.getItem('theme');
if (savedTheme !== 'light') {
    document.documentElement.classList.add('dark');
}

// Keep browser tabs compact while the static HTML title remains descriptive for crawlers and previews.
document.title = 'Kromacut';

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <App />
    </StrictMode>
);
