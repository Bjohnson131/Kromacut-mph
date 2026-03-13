import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

// Apply saved theme preference, default to dark
const savedTheme = localStorage.getItem('theme');
if (savedTheme !== 'light') {
    document.documentElement.classList.add('dark');
}

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <App />
    </StrictMode>
);
