import { useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { TitleBar } from './components/TitleBar';
import { Downloader } from './components/Downloader';
import { Onboarding } from './components/Onboarding';

function App() {
    const [settingsLoaded, setSettingsLoaded] = useState(false);
    const [onboardingOpen, setOnboardingOpen] = useState(false);
    const [extStatus, setExtStatus] = useState<any>(null);

    const isPreview = () => {
        const params = new URLSearchParams(window.location.search);
        const v = params.get('onboarding');
        return v === '1' || v === 'preview';
    };

    useEffect(() => {
        // Dev preview: ?onboarding=1 (or =preview) shows the welcome screen.
        if (isPreview()) {
            setOnboardingOpen(true);
            setSettingsLoaded(true);
            window.electron.getExtensionStatus?.().then(setExtStatus).catch(() => null);
            return;
        }

        Promise.all([
            window.electron.getSettings?.(),
            window.electron.getExtensionStatus?.().catch(() => null),
        ]).then(([settings, status]) => {
            setExtStatus(status);
            setSettingsLoaded(true);
            // First run only — show the welcome screen until onboarding is completed.
            if (!settings?.onboardingCompleted) setOnboardingOpen(true);
        });
    }, []);

    const completeOnboarding = async () => {
        // In preview mode we don't persist anything, so the real first-run
        // flow still works when the user installs the app.
        if (!isPreview()) {
            const settings = await window.electron.getSettings?.();
            await window.electron.saveSettings?.({ ...(settings || {}), onboardingCompleted: true });
        }
        setOnboardingOpen(false);
    };

    if (!settingsLoaded && !onboardingOpen) {
        return <div className="w-full h-full bg-[#0a0a0b]" />;
    }

    return (
        <>
            <TitleBar />
            <Downloader />
            <AnimatePresence>
                {onboardingOpen && (
                    <Onboarding
                        initialStatus={extStatus}
                        preview={isPreview()}
                        onComplete={completeOnboarding}
                    />
                )}
            </AnimatePresence>
        </>
    );
}

export default App;
