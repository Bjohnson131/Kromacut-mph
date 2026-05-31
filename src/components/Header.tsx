import React from 'react';
import { Button } from '@/components/ui/button';
import { ArrowLeft, BookOpen, Image, Github, Heart, Moon, Sun, MessageCircle } from 'lucide-react';
import logo from '../assets/logo.png';

interface Props {
    onLoadTest: () => void;
    docsOpen: boolean;
    onToggleDocs: () => void;
}

export const Header: React.FC<Props> = ({ onLoadTest, docsOpen, onToggleDocs }) => {
    const [isDark, setIsDark] = React.useState(() => {
        return document.documentElement.classList.contains('dark');
    });

    const toggleTheme = () => {
        const root = document.documentElement;
        if (isDark) {
            root.classList.remove('dark');
            localStorage.setItem('theme', 'light');
            setIsDark(false);
        } else {
            root.classList.add('dark');
            localStorage.setItem('theme', 'dark');
            setIsDark(true);
        }
    };

    return (
        <header className="h-12 flex items-center justify-between px-4 border-b border-border bg-card">
            <div className="flex items-center gap-2">
                <img src={logo} alt="Kromacut" className="h-7 w-auto" />
                <span className="font-extrabold text-base text-foreground tracking-wide ml-1 select-none max-md:hidden">
                    Kromacut
                </span>
            </div>
            <div className="flex gap-2.5 items-center">
                <Button
                    size="sm"
                    onClick={onToggleDocs}
                    title={docsOpen ? 'Back to app' : 'Open docs'}
                    className="bg-secondary hover:bg-secondary/80 text-secondary-foreground font-semibold transition-all duration-200 shadow-md hover:shadow-lg hover:scale-105 active:scale-95 gap-1.5"
                >
                    {docsOpen ? (
                        <ArrowLeft className="w-4 h-4" />
                    ) : (
                        <BookOpen className="w-4 h-4" />
                    )}
                    <span className="max-sm:hidden">{docsOpen ? 'Back to app' : 'Docs'}</span>
                </Button>
                <Button
                    size="sm"
                    onClick={onLoadTest}
                    title="Load TD Test"
                    className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold transition-all duration-200 shadow-md hover:shadow-lg hover:scale-105 active:scale-95 gap-1.5"
                >
                    <Image className="w-4 h-4" />
                    <span className="max-sm:hidden">Load TD Test</span>
                </Button>
                <Button
                    size="sm"
                    asChild
                    className="bg-gradient-to-r from-indigo-500 to-blue-600 hover:from-indigo-600 hover:to-blue-700 text-white font-semibold transition-all duration-200 shadow-md hover:shadow-lg hover:scale-105 active:scale-95 gap-1.5"
                >
                    <a
                        href="https://discord.gg/nU63sFMcnX"
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Discord"
                        title="Discord"
                    >
                        <MessageCircle className="w-4 h-4" />
                        <span className="max-sm:hidden">Discord</span>
                    </a>
                </Button>
                <Button
                    size="sm"
                    asChild
                    className="bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white font-semibold transition-all duration-200 shadow-md hover:shadow-lg hover:scale-105 active:scale-95 gap-1.5"
                >
                    <a
                        href="https://github.com/vycdev/Kromacut"
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="GitHub"
                        title="GitHub"
                    >
                        <Github className="w-4 h-4" />
                        <span className="max-sm:hidden">GitHub</span>
                    </a>
                </Button>
                <Button
                    size="sm"
                    className="bg-gradient-to-r from-rose-500 to-orange-500 hover:from-rose-600 hover:to-orange-600 text-white font-semibold transition-all duration-200 shadow-md hover:shadow-lg hover:scale-105 active:scale-95 gap-1.5"
                    asChild
                >
                    <a
                        href="https://www.patreon.com/cw/vycdev"
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Support me"
                        title="Support me"
                    >
                        <Heart className="w-4 h-4 fill-current" />
                        <span className="max-sm:hidden">Support me</span>
                    </a>
                </Button>
                <Button
                    size="icon"
                    onClick={toggleTheme}
                    title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
                    className="h-8 w-8 bg-secondary hover:bg-secondary/80 text-secondary-foreground font-semibold transition-all duration-200 shadow-md hover:shadow-lg hover:scale-105 active:scale-95 shadow-black/20 dark:shadow-white/30 dark:border dark:border-white/20"
                >
                    {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                </Button>
            </div>
        </header>
    );
};

export default Header;
